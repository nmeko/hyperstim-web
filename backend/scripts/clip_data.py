"""Measures the stretches a blog post's clip comparisons play (plan 018, Clip comparison).

Usage: uv run python scripts/clip_data.py <slug> [--content-dir DIR] [--media-dir DIR]

Reads every `::::clips` block of the post <content-dir>/<date>-<slug>.md, in order:

    ::::clips[Caption]{a=<video id> b=<video id>}
    ::cuts[Tab label]{a=0:14.5-0:30.5 b=0:03-0:21.6}
    ::motion[Tab label]{a=0:36-0:51.5 b=0:21.6-0:39.6}
    ::::

For each tab and video it downloads only that stretch with yt-dlp (the pipeline's format),
into a temporary folder that is always deleted, and measures it with the pipeline at the
dataset's settings: the cuts behind `cuts_per_min` and the optical flow behind `motion_frac`.
Writes <media-dir>/<slug>/clips.json with each video's title and channel and, per tab:
  cuts    cut times, in seconds from the tab's start
  motion  the average motion (% of frame width per second) per 0.2 s step from the tab's
          start; flow intervals straddling a cut are left out, and a step with none left
          is null

yt-dlp cuts a section without re-encoding, from the keyframe before the start, and ffmpeg
marks the lead-in to be skipped (an MP4 edit list), so the decoded clip starts at the
requested time; the clip's duration is checked to confirm it. Needs ffmpeg/ffprobe and deno,
like the pipeline (README.md).

Also adds the videos to data/blog-videos.txt, so the API serves their thumbnails like a
dataset video's (plan 009, Thumbnails).
"""

import argparse
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

import numpy as np
import numpy.typing as npt

BACKEND = Path(__file__).resolve().parents[1]
BLOG_VIDEOS = BACKEND / "data/blog-videos.txt"
BLOG_VIDEOS_HEADER = (
    "# The YouTube videos the blog's posts embed (plan 018); "
    "the API serves their thumbnails (plan 009)."
)
EXTRACTOR = BACKEND / "pipeline" / "04_extract_features_v2.py"
FORMAT = "18/bestvideo[height<=360]+bestaudio/best"  # pipeline/58_download_clips_v2.py
MIN_CLIP_S = 10.0  # the pipeline measures no clip shorter than this
END_MARGIN_S = 0.5  # downloaded past the end, so the last flow intervals are there
STEP_S = 0.2
KINDS = ("cuts", "motion")

TIME = r"(\d+):([0-5]\d(?:\.\d+)?)"
BLOCK_START = re.compile(r"^::::clips\[(.*)\]\{(.*)\}\s*$")
BLOCK_END = re.compile(r"^::::\s*$")
TAB = re.compile(r"^::(\w+)\[(.*)\]\{(.*)\}\s*$")
ATTR = re.compile(r"""(\w+)=(?:"([^"]*)"|'([^']*)'|([^\s"']+))""")
RANGE = re.compile(rf"^{TIME}-{TIME}$")

Floats = npt.NDArray[np.float64]


class ClipError(Exception):
    pass


@dataclass
class Tab:
    kind: str
    a: tuple[float, float]
    b: tuple[float, float]


@dataclass
class Block:
    a: str
    b: str
    tabs: list[Tab]


def parse_attrs(text: str, line_no: int) -> dict[str, str]:
    attrs = {m[1]: next(v for v in m.groups()[1:] if v is not None) for m in ATTR.finditer(text)}
    if set(attrs) != {"a", "b"} or ATTR.sub("", text).strip():
        raise ClipError(f"line {line_no}: expected exactly the attributes a and b: {{{text}}}")
    return attrs


def parse_range(text: str, line_no: int) -> tuple[float, float]:
    m = RANGE.match(text)
    if not m:
        raise ClipError(f"line {line_no}: {text!r} is not a time range like 0:14.5-0:30.5")
    start = int(m[1]) * 60 + float(m[2])
    end = int(m[3]) * 60 + float(m[4])
    if end <= start:
        raise ClipError(f"line {line_no}: {text!r} ends before it starts")
    return start, end


def parse_blocks(markdown: str) -> list[Block]:
    """Every clips block in the post, in order."""
    blocks: list[Block] = []
    block: Block | None = None
    for line_no, line in enumerate(markdown.splitlines(), 1):
        if block is None:
            if m := BLOCK_START.match(line):
                attrs = parse_attrs(m[2], line_no)
                block = Block(attrs["a"], attrs["b"], [])
            elif line.startswith("::::clips"):
                raise ClipError(f"line {line_no}: malformed clips block: {line!r}")
        elif BLOCK_END.match(line):
            if not block.tabs:
                raise ClipError(f"line {line_no}: a clips block needs at least one tab")
            blocks.append(block)
            block = None
        elif m := TAB.match(line):
            if m[1] not in KINDS:
                raise ClipError(f"line {line_no}: unknown tab {m[1]!r} (expected cuts or motion)")
            attrs = parse_attrs(m[3], line_no)
            a, b = (parse_range(attrs[k], line_no) for k in ("a", "b"))
            block.tabs.append(Tab(m[1], a, b))
        elif line.strip():
            raise ClipError(f"line {line_no}: unexpected line in a clips block: {line!r}")
    if block is not None:
        raise ClipError("a clips block is not closed with ::::")
    if not blocks:
        raise ClipError("the post has no clips block")
    return blocks


def download(video_id: str, start: float, end: float, out_dir: Path) -> tuple[Path, str, str]:
    """Downloads [start, end] of a video (no shorter than the pipeline measures)
    → clip, title, channel name."""
    end = max(end, start + MIN_CLIP_S) + END_MARGIN_S
    out = out_dir / f"{video_id}-{start:g}.mp4"
    cmd = [sys.executable, "-m", "yt_dlp", "--no-warnings", "--no-playlist", "-f", FORMAT]
    cmd += ["--download-sections", f"*{start:g}-{end:g}", "--merge-output-format", "mp4"]
    cmd += ["--remote-components", "ejs:github", "--no-simulate"]
    cmd += ["--print", "%(title)s", "--print", "%(channel)s"]
    cmd += ["--output", str(out), f"https://www.youtube.com/watch?v={video_id}"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0 or not out.exists():
        raise ClipError(f"{video_id}: download failed: {r.stderr.strip()[-300:]}")
    duration = probe_duration(out)
    # Longer: the lead-in from the keyframe was kept, so times would be shifted.
    if duration > end - start + END_MARGIN_S:
        raise ClipError(f"{video_id}: got {duration:.2f} s for a {end - start:g} s section")
    title, channel = r.stdout.strip().splitlines()[:2]
    return out, title, channel


def probe_duration(clip: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clip],
        capture_output=True,
        text=True,
    ).stdout
    return float(out.strip())


def load_extractor() -> ModuleType:
    spec = importlib.util.spec_from_file_location("extract_features_v2", EXTRACTOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def extract(x: ModuleType, clip: Path, work: Path) -> tuple[Floats, Floats, float]:
    """The pipeline's cut times (s) and flow (% of frame width per second, per interval)."""
    _, error, _ = x.extract_one((clip.stem, str(clip), str(work), 0, True, None))
    if error:
        raise ClipError(f"{clip.stem}: the pipeline could not measure it: {error}")
    c: dict[str, Any] = dict(np.load(work / f"{clip.stem}.npz", allow_pickle=True))
    cuts, _ = x._cuts_from_cache(c, x.DEF_CUT_THR, x.DEF_MERGE_S, x.DEF_CUT_GRID)
    grid = float(c.get("flow_fps", x.FLOW_FPS))
    width = float(c.get("flow_w", x.FLOW_W))
    flow = np.asarray(c["flow_mag"], float) * grid / width * 100
    return np.asarray(x._cut_seconds(c, cuts), float), flow, grid


def cuts_within(cut_s: Floats, length: float) -> list[float]:
    return [round(float(t), 2) for t in cut_s if t < length]


def motion_steps(flow: Floats, grid: float, cut_s: Floats, length: float) -> list[float | None]:
    """Mean flow per STEP_S step; intervals with a cut left out, as in `motion_frac`.

    Cuts mostly fall exactly on an interval's start or end, where `motion_frac`'s exact
    comparison counts them or not by rounding noise; here a cut on either end counts
    (t0 <= cut <= t1), which also drops the frame just after a cut.
    """
    t0 = np.arange(flow.size) / grid
    t1 = t0 + 1 / grid
    eps = 1e-6
    keep = np.searchsorted(cut_s, t0 - eps) == np.searchsorted(cut_s, t1 + eps)
    step = np.floor(t0 / STEP_S + 1e-6).astype(int)
    values: list[float | None] = []
    for k in range(int(length / STEP_S + 1e-6)):
        sel = flow[(step == k) & keep]
        values.append(round(float(sel.mean()), 2) if sel.size else None)
    return values


def measure_block(block: Block, x: ModuleType, work: Path) -> dict[str, Any]:
    names: dict[str, tuple[str, str]] = {}  # side -> (title, channel)
    tabs: list[dict[str, Any]] = []
    for tab in block.tabs:
        entry: dict[str, Any] = {"kind": tab.kind}
        for side, video_id, (start, end) in (("a", block.a, tab.a), ("b", block.b, tab.b)):
            clip, *name = download(video_id, start, end, work)
            names[side] = (name[0], name[1])
            cut_s, flow, grid = extract(x, clip, work)
            clip.unlink()
            part: dict[str, Any] = {"start": start, "end": end}
            if tab.kind == "cuts":
                part["cuts"] = cuts_within(cut_s, end - start)
            else:
                part["step"] = STEP_S
                part["motion"] = motion_steps(flow, grid, cut_s, end - start)
            entry[side] = part
        tabs.append(entry)
    videos = {
        side: {"id": vid, "title": names[side][0], "channel": names[side][1]}
        for side, vid in (("a", block.a), ("b", block.b))
    }
    return {"videos": videos, "tabs": tabs}


def find_post(content_dir: Path, slug: str) -> Path:
    """The post whose file is `<date>-<slug>.md` (plan 018)."""
    matches = sorted(content_dir.glob(f"[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-{slug}.md"))
    if len(matches) != 1:
        found = ", ".join(m.name for m in matches) or "none"
        raise ClipError(
            f"expected one post named <date>-{slug}.md in {content_dir} (found: {found})"
        )
    return matches[0]


def add_blog_videos(path: Path, ids: list[str]) -> None:
    """Add `ids` to the blog's video list (one ID a line, sorted), keeping its comment lines."""
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    comments = [line for line in lines if line.startswith("#")] or [BLOG_VIDEOS_HEADER]
    listed = {line.split("#", 1)[0].strip() for line in lines if not line.startswith("#")} - {""}
    path.write_text("\n".join([*comments, *sorted(listed | set(ids))]) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("slug")
    ap.add_argument("--content-dir", type=Path, default=BACKEND / "../frontend/content/blog")
    ap.add_argument("--media-dir", type=Path, default=BACKEND / "../frontend/public/blog-media")
    args = ap.parse_args()
    try:
        blocks = parse_blocks(find_post(args.content_dir, args.slug).read_text(encoding="utf-8"))
        x = load_extractor()
        with tempfile.TemporaryDirectory(prefix="clip-data-") as tmp:
            data = {"blocks": [measure_block(b, x, Path(tmp)) for b in blocks]}
    except (ClipError, OSError) as exc:
        sys.exit(f"clip_data: {exc}")
    out = args.media_dir / args.slug / "clips.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out.resolve()}")
    add_blog_videos(BLOG_VIDEOS, [v for block in blocks for v in (block.a, block.b)])
    print(f"listed the videos in {BLOG_VIDEOS}")


if __name__ == "__main__":
    main()
