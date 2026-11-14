#!/usr/bin/env python3
"""
Stage 3 of the v2 contemporary collection: download one 5-minute clip per
manifest row.

Reads:  runs/contemporary-v2/manifest-share-<k>.tsv  (59_split_manifest.py)
Writes: --clips-dir/<video_id>.mp4
        --clips-dir/../download-log-v2.tsv   append-only, one row per attempt

Capture parameters are v1's, unchanged, per plan §2.1.3: 30 s offset, 5 minutes,
360p, **source frame rate**. Changing any of them invalidates comparison with v1
and with the historical track.

**Resume is the filesystem.** A row is done when its mp4 exists and exceeds
MIN_CLIP_BYTES. That is the same floor the success check uses, so a file this run
calls `ok` is one the next run calls `skipped` -- yt-dlp can exit 0 having
written a 262-byte stub, and the floor is what catches it.

**One manifest per instance.** Partitioning is the manifest's job -- the shares
are explicit files cut by 59_split_manifest.py -- so there is no hash sharding
here. The log is named for the manifest it came from, which makes a log returned
from another machine self-identifying.

**Anti-ban.** Randomised order, jittered delays, few workers, three player
clients tried in turn, and an abort after --max-consecutive-errors. Every error
advances to the next client rather than being judged: what the default client
reports as a property of the video is routinely a property of the client asking.
"""

import argparse
import csv
import os
import random
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

PLAYER_CLIENTS = [None, "mweb", "android"]
MIN_CLIP_BYTES = 10000
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

_lock = threading.Lock()
_consecutive = 0


def attempt(video_id, out_path, start_s, dur_s, fmt, cookies, client):
    cmd = ["yt-dlp", "--verbose",
           "-f", fmt,
           "--download-sections", f"*{start_s}-{start_s + dur_s}",
           "--merge-output-format", "mp4",
           "--output", out_path,
           "--no-playlist", "--retries", "3", "--socket-timeout", "30",
           "--sleep-requests", "1",
           "--remote-components", "ejs:github",
           "--user-agent", UA]
    if cookies == "__browser__firefox":
        cmd += ["--cookies-from-browser", "firefox"]
    elif cookies and os.path.exists(cookies):
        cmd += ["--cookies", cookies]
    if client:
        cmd += ["--extractor-args", f"youtube:player_client={client}"]
    cmd.append(f"https://www.youtube.com/watch?v={video_id}")
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if r.returncode == 0 and os.path.exists(out_path):
            size = os.path.getsize(out_path)
            if size <= MIN_CLIP_BYTES:
                keep_log(out_path, client, cmd, r.stdout, r.stderr)
                return "error", f"exit 0 but wrote {size} B"
            return "ok", f"{size/1048576:.1f}MB"
        keep_log(out_path, client, cmd, r.stdout, r.stderr)
        return "error", last_error(r.stderr) or "unknown"
    except subprocess.TimeoutExpired as e:
        keep_log(out_path, client, cmd, e.stdout, e.stderr)
        return "timeout", "exceeded 5 min"
    except Exception as e:
        return "error", str(e)[:180]


def last_error(stderr):
    """The last ERROR: line (--verbose fills stderr with debug lines), cut to 180 chars."""
    lines = (stderr or "").strip().splitlines()
    errors = [line for line in lines if line.startswith("ERROR:")]
    return (errors or lines or [""])[-1][-180:]


def keep_log(out_path, client, cmd, stdout, stderr):
    """yt-dlp's full output for a failed try (with ffmpeg's), next to the clip:
    <video_id>.<client>.log. A website change (plan 013): only the message's last 180
    characters were kept, which couldn't explain a failure."""
    def text(s):
        return s.decode(errors="replace") if isinstance(s, bytes) else (s or "")
    path = f"{os.path.splitext(out_path)[0]}.{client or 'default'}.log"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f"$ {' '.join(cmd)}\n\n--- stdout ---\n{text(stdout)}"
                 f"\n--- stderr ---\n{text(stderr)}")


def download(row, a, logw, logf, total, counter):
    global _consecutive
    vid = row["video_id"]
    out = os.path.join(a.clips_dir, f"{vid}.mp4")
    if os.path.exists(out) and os.path.getsize(out) > MIN_CLIP_BYTES:
        with _lock:
            counter["skip"] += 1
        return
    time.sleep(random.uniform(a.delay_min, a.delay_max))
    status, msg = "error", "no client tried"
    for client in PLAYER_CLIENTS:
        status, msg = attempt(vid, out, a.offset, a.duration, a.fmt,
                              a.cookies, client)
        if status == "ok":
            break
        if os.path.exists(out):
            try:
                os.remove(out)
            except OSError:
                pass
    with _lock:
        counter["done"] += 1
        counter[status] = counter.get(status, 0) + 1
        logw.writerow([vid, status, msg, time.strftime("%Y-%m-%dT%H:%M:%S")])
        logf.flush()
        if status == "ok":
            _consecutive = 0
        else:
            _consecutive += 1
        n = counter["done"] + counter["skip"]
        el = time.time() - counter["t0"]
        rate = counter["done"] / max(el, 1) * 3600
        eta = (total - n) / max(rate, 1e-9)
        print(f"  [{n}/{total}] {vid} {status:<8} {msg[:44]:<46} "
              f"{rate:.0f}/h eta {eta:.1f}h", file=sys.stderr)
    if _consecutive >= a.max_consecutive_errors:
        raise SystemExit(f"aborting: {_consecutive} consecutive errors "
                         f"(likely rate-limited or IP-blocked)")


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", required=True,
                    help="a share manifest, e.g. runs/contemporary-v2/manifest-share-1.tsv. "
                         "Required: the corpus is held as five cumulative shares, not as "
                         "one standing manifest file.")
    ap.add_argument("--clips-dir", required=True)
    ap.add_argument("--offset", type=int, default=30)
    ap.add_argument("--duration", type=int, default=300)
    ap.add_argument("--fmt", default="18/bestvideo[height<=360]+bestaudio/best")
    ap.add_argument("--cookies", default="")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--delay-min", type=float, default=5.0)
    ap.add_argument("--delay-max", type=float, default=10.0)
    ap.add_argument("--max-consecutive-errors", type=int, default=50)
    ap.add_argument("--limit", type=int, default=0, help="stop after N downloads (pilot)")
    a = ap.parse_args()

    ensure_ytdlp_on_path()
    os.makedirs(a.clips_dir, exist_ok=True)

    rows = list(csv.DictReader(open(a.manifest), delimiter="\t"))
    random.shuffle(rows)
    if a.limit:
        rows = rows[:a.limit]

    stem = os.path.splitext(os.path.basename(a.manifest))[0]
    logp = os.path.join(os.path.dirname(a.clips_dir.rstrip("/")),
                        f"download-log-{stem}.tsv")
    new = not os.path.exists(logp)
    logf = open(logp, "a", newline="")
    logw = csv.writer(logf, delimiter="\t")
    if new:
        logw.writerow(["video_id", "status", "message", "timestamp"])

    counter = {"done": 0, "skip": 0, "t0": time.time()}
    print(f"  {stem}: {len(rows)} rows -> {a.clips_dir}", file=sys.stderr)
    print(f"  log: {logp}", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        list(ex.map(lambda r: download(r, a, logw, logf, len(rows), counter), rows))
    logf.close()
    el = (time.time() - counter["t0"]) / 3600
    print(f"\n  done {counter['done']} (ok {counter.get('ok',0)}, "
          f"error {counter.get('error',0)}, timeout {counter.get('timeout',0)}), "
          f"skipped {counter['skip']}, {el:.1f} h", file=sys.stderr)


def ensure_ytdlp_on_path():
    """Put yt-dlp on PATH, or say exactly where to look.

    Lifted from 03_download_clips.py, whose comment records why it exists: yt-dlp
    lives in a venv, subprocess.run() searches PATH and nothing else, and an
    un-activated shell wrote 238 identical FileNotFoundError rows to the v1 log
    before anyone noticed. Resolve once, fail loudly.
    """
    from shutil import which
    if which("yt-dlp"):
        return
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [os.path.join(here, ".venv", "bin"),
                  os.path.expanduser("~/.local/ytdlp-venv/bin"),
                  os.path.expanduser("~/.local/bin")]
    for d in candidates:
        if os.path.isfile(os.path.join(d, "yt-dlp")):
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
            print(f"  using yt-dlp: {os.path.join(d, 'yt-dlp')}", file=sys.stderr)
            return
    sys.exit("yt-dlp not on PATH and not in any known venv:\n  "
             + "\n  ".join(candidates))


if __name__ == "__main__":
    main()
