"""The collector's commands (plan 013). Settings come from environment variables.

python -m hyperstim_api.collector seed <research-repo>   start from v2's lists, once
python -m hyperstim_api.collector run                    collect until stopped
python -m hyperstim_api.collector status                 what it has done, and its health
python -m hyperstim_api.collector export                 write the TSV files again
python -m hyperstim_api.collector recount <backup>...    the changelog's day-end counts from
                                                         daily backups, once
python -m hyperstim_api.collector alerts                 the hourly alert check (GitHub issues)
"""

import argparse
import logging
import os
import shutil
import signal
import sys
import tempfile
import threading
import time
from collections import Counter
from pathlib import Path

from hyperstim_api import scoring
from hyperstim_api.analysis import ResearchPipeline
from hyperstim_api.collector import alerts, sampling
from hyperstim_api.collector import seed as seeding
from hyperstim_api.collector.collector import (
    RETRY_AFTER_S,
    Collector,
    Settings,
    channel_averages,
    export,
    load_classifier,
    plan,
    probe_block,
    provenance,
    recount,
    rule,
    scorer,
    utc,
)
from hyperstim_api.collector.store import Store
from hyperstim_api.collector.youtube import DataApi, OutOfUnits, http_get, is_short, quota_day
from hyperstim_api.config import _limit, _required
from hyperstim_api.dataset import load_dataset

log = logging.getLogger("hyperstim_api.collector")


def settings() -> Settings:
    analysis = os.environ.get("ANALYSIS_DIR", "").strip()
    return Settings(
        data_dir=Path(_required("COLLECTOR_DATA_DIR")),
        clips_dir=Path(_required("COLLECTOR_CLIPS_DIR")),
        analysis_dir=Path(analysis) if analysis else None,
        per_day=_limit("COLLECT_PER_DAY", 120),
        units_per_day=_limit("COLLECTOR_UNITS_PER_DAY", 7000),
    )


def open_store(s: Settings) -> Store:
    return Store(s.data_dir / "collector.db")


def run(s: Settings) -> None:
    store = open_store(s)
    if not store.get("seeded"):
        sys.exit("Seed the collector first: python -m hyperstim_api.collector seed <research-repo>")
    s.provenance = provenance()

    def spend(units: int) -> None:
        day = quota_day(time.time())
        if store.units_used(day) + units > s.units_per_day:
            raise OutOfUnits(f"budget of {s.units_per_day} units")
        store.add_units(day, units)

    reference = load_dataset(Path(_required("DATASET_PATH")))
    pipeline = ResearchPipeline(youtube_api_key=None, measure_cores=1)  # no cookies (plan 013)
    collector = Collector(
        s,
        store,
        DataApi(http_get(_required("YOUTUBE_API_KEY")), spend),
        pipeline,
        is_short,
        load_classifier(),
        probe_block,
        score=scorer(reference),
    )
    # Before anything changes, so a day that ended while it was stopped is closed as it ended.
    collector.close_day(time.time())
    # Downloads that failed before they were retried (plan 013, decision 7) get their retries.
    requeued = store.requeue_failed(len(RETRY_AFTER_S) + 1)
    if requeued:
        log.info("Trying %d failed downloads again", requeued)
    collector.fill_scores({v.id: v.score for v in reference.videos})
    stop = threading.Event()

    def on_signal(*_: object) -> None:
        stop.set()
        pipeline.cancel()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    collector.export()
    log.info("Collecting %d videos a day into %s", s.per_day, s.data_dir)
    while not stop.is_set():
        try:
            wait = collector.tick()
        except Exception:
            if stop.is_set():
                break
            log.exception("Collector tick failed; trying again in 10 minutes")
            wait = 600
        stop.wait(wait)
    store.close()


def status(s: Settings) -> str:
    store = open_store(s)
    now = time.time()
    states = dict(
        (r["state"], r["n"])
        for r in store.db.execute("SELECT state, COUNT(*) AS n FROM uploads GROUP BY state")
    )
    channels = dict(
        (r["status"], r["n"])
        for r in store.db.execute("SELECT status, COUNT(*) AS n FROM channels GROUP BY status")
    )
    added = [r["added_at"] for r in store.db.execute("SELECT added_at FROM collected")]
    attempts = Counter(
        r["outcome"]
        for r in store.db.execute("SELECT outcome FROM attempts WHERE at >= ?", (now - 86400,))
    )
    lines = [
        f"Channels: {channels.get('in', 0)} in, {channels.get('near_miss', 0)} near misses",
        "Uploads: " + ", ".join(f"{k} {v}" for k, v in sorted(states.items())),
        f"Added: {len(added)} in all, "
        f"{sum(a >= utc(now - 86400) for a in added)} in 24 h, "
        f"{sum(a >= utc(now - 7 * 86400) for a in added)} in 7 days",
        "Last 24 h: " + (", ".join(f"{k} {v}" for k, v in attempts.items()) or "nothing"),
        level_line(store, now),
        first_videos_line(store, now),
        waiting_line(store),
        left_out_line(store),
        f"Data API units today: {store.units_used(quota_day(now))} of {s.units_per_day}",
        f"Pace: {s.per_day}/day x {store.get('pace_factor', '1')}",
    ]
    blocked = float(store.get("blocked_until", "0"))
    if blocked > now:
        lines.append(f"Blocked by YouTube: waiting until {utc(blocked)}")
    paused = float(store.get("paused_until", "0"))
    if paused > now:
        lines.append(f"Paused after failed downloads in a row: until {utc(paused)}")
    retrying = store.retrying(now)
    lines.append(
        f"Failed downloads: {len(retrying)} waiting to be tried again"
        + (f" (next {utc(retrying[0])})" if retrying else "")
        + f", {states.get('failed', 0)} given up"
    )
    lines += health(store, now)
    next_at = float(store.get("next_download_at", "0"))
    lines.append(f"Next download: {utc(max(now, next_at))}")
    if s.clips_dir.exists():
        lines.append(f"Clips volume: {shutil.disk_usage(s.clips_dir).free / 1024**3:.0f} GB free")
    lines.append(f"Channels last fully searched: {store.get('channels_checked_at') or 'not yet'}")
    lines += scores_against_reference(store)
    store.close()
    return "\n".join(lines)


WAITING_SHOWN = 5  # the channels next in line that `status` names


def level_line(store: Store, now: float) -> str:
    """How far the channels are filled (plan 013, decision 1): their videos per year (the
    median, and the second smallest of those with an upload left), how many the channel-first
    rule can fill now and how many it skips for now (nothing left below their threshold)."""
    second, median = channel_averages(store, utc(now)[:10])
    rows, order = rule(store, now)
    on_site = {r["channel_id"] for r in rows if int(r["videos"])} - store.left_out_ids()
    return (
        f"Channels' videos per year: median {median}, second smallest {second}; "
        f"the rule can fill {len(order)} channels now, skips {len(on_site) - len(order)}"
    )


def first_videos_line(store: Store, now: float) -> str:
    """Today's exploring downloads, the channels catching up and the channels that got their
    first video today (plan 013, decision 2)."""
    explored, downloads = store.downloads_today(now)
    return (
        f"Exploring today: {explored} of {downloads} downloads "
        f"(share {sampling.EXPLORE_SHARE}); {len(plan(store, now)[1])} channels catching up; "
        f"first videos today: {store.first_videos_today(now)} of "
        f"{sampling.FIRST_VIDEOS_PER_DAY} channels"
    )


def waiting_line(store: Store) -> str:
    """The channels waiting for their first video and the next few in line, by subscribers
    (plan 013, decision 2)."""
    waiting = store.waiting_channels()
    following = ", ".join(f"{r['title']} ({r['subscribers']:,})" for r in waiting[:WAITING_SHOWN])
    return f"Waiting for a first video: {len(waiting)} channels" + (
        f"; next: {following}" if waiting else ""
    )


def left_out_line(store: Store) -> str:
    """The channels left out at the last export, by why, and their videos."""
    reasons = dict(
        store.db.execute("SELECT reason, COUNT(*) FROM left_out GROUP BY reason").fetchall()
    )
    videos = store.db.execute(
        "SELECT COUNT(*) FROM uploads WHERE state IN ('v2', 'collected') "
        "AND channel_id IN (SELECT channel_id FROM left_out)"
    ).fetchone()[0]
    return (
        f"Left out ({sampling.KIDS_ANSWERS_MIN}+ answers): {sum(reasons.values())} channels, "
        f"{videos} of their videos; under {sampling.KIDS_PERCENT_MIN} % made for kids "
        f"{reasons.get('kids_share', 0)}, under {sampling.PER_YEAR_MIN} eligible a year "
        f"{reasons.get('per_year', 0)}, both {reasons.get('both', 0)}"
    )


def health(store: Store, now: float) -> list[str]:
    """What's waiting after a failure, what was given up, and when each job last worked
    (plan 013, decision 12)."""
    db = store.db

    def count(sql: str, *args: object) -> int:
        return int(db.execute(sql, args).fetchone()[0])

    month = now - 30 * 86400
    lines = [
        "Waiting after a Data API error: "
        f"{count('SELECT COUNT(*) FROM channels WHERE api_failures > 0')} channels' lists, "
        f"{count('SELECT COUNT(*) FROM uploads WHERE api_failures > 0 AND retry_at > ?', now)}"
        " uploads",
        "Asked again (no clear answer yet): "
        f"{count("SELECT COUNT(*) FROM uploads WHERE state = 'new' AND unsure > 0")} uploads, "
        f"{
            count("SELECT COUNT(*) FROM uploads WHERE state IN ('v2', 'collected') AND unsure > 0")
        } dataset videos possibly gone",
        "Given up in 30 days: "
        f"{
            count(
                "SELECT COUNT(*) FROM uploads WHERE state = 'ineligible' AND unsure > 3 "
                'AND COALESCE(checked_at, 0) >= ?',
                month,
            )
        } unclear uploads, "
        f"{
            count(
                "SELECT COUNT(*) FROM uploads WHERE state = 'failed' AND id IN "
                '(SELECT video_id FROM attempts WHERE at >= ?)',
                month,
            )
        } downloads",
        "Waiting for a title, channel name or date: "
        f"{count("SELECT COUNT(*) FROM uploads WHERE state = 'measured'")} measured videos",
        "Channels with uploads still to read: "
        f"{count('SELECT COUNT(*) FROM channels WHERE full_listing IS NOT NULL')}",
    ]
    last = db.execute("SELECT MAX(at) FROM attempts WHERE outcome = 'collected'").fetchone()[0]
    jobs = {
        "download": utc(last) if last else "",
        "upload lists": store.get("ok:refresh_uploads"),
        "offline check": store.get("ok:check_online"),
        "repair": store.get("ok:repair"),
        "names": store.get("ok:refresh_names"),
        "backup": store.get("backed_up"),
        "export": store.get("ok:export"),
    }
    lines.append("Last worked: " + ", ".join(f"{k} {v or 'not yet'}" for k, v in jobs.items()))
    if int(store.get("backup_failures", "0")):
        lines.append(f"Backup: failed {store.get('backup_failures')} times in a row")
    if float(store.get("blocked_until", "0")) > now:
        since = float(store.get("blocked_since") or store.get("blocked_at", "0"))
        lines.append(f"Blocked for {(now - since) / 3600:.0f} h (since {utc(since)})")
    return lines


def scores_against_reference(store: Store) -> list[str]:
    """How added videos score against the reference set (plan 013, decision 4), and the share
    of the dataset from the 100 busiest channels."""
    dataset_path = os.environ.get("DATASET_PATH", "").strip()
    if not dataset_path:
        return []
    import json

    reference = load_dataset(Path(dataset_path))
    scores = []
    for row in store.db.execute("SELECT features FROM collected"):
        features = json.loads(row["features"])
        value = scoring.composite(features, reference.pools)
        if value is not None:
            score = scoring.percentile_rank(value, reference.composite_pool)
            if score is not None:
                scores.append(score)
    lines = []
    if scores:
        fifths = Counter(min(4, int(s // 20)) for s in scores)
        shares = " ".join(f"{100 * fifths[i] / len(scores):.0f}%" for i in range(5))
        lines.append(
            f"Added videos' scores: mean {sum(scores) / len(scores):.1f} (reference 50), "
            f"by fifth {shares} (reference 20% each)"
        )
    busiest = [
        r["channel_id"]
        for r in store.db.execute(
            "SELECT channel_id FROM uploads GROUP BY channel_id ORDER BY COUNT(*) DESC LIMIT 100"
        )
    ]
    in_dataset = store.db.execute(
        "SELECT channel_id FROM uploads WHERE state IN ('v2', 'collected')"
    ).fetchall()
    if in_dataset:
        top = sum(r["channel_id"] in set(busiest) for r in in_dataset)
        lines.append(f"Dataset from the 100 busiest channels: {100 * top / len(in_dataset):.0f}%")
    return lines


def check_alerts(s: Settings) -> None:
    """Plan 013, decision 12. Without ALERT_GITHUB_TOKEN, what would be posted is only logged."""
    token = os.environ.get("ALERT_GITHUB_TOKEN", "").strip()
    issues: alerts.Issues = (
        alerts.GitHubIssues(_required("ALERT_REPO"), token) if token else alerts.LogOnly()
    )
    store = open_store(s)
    posts = alerts.check(
        store,
        s.data_dir / "alerts.json",
        issues,
        time.time(),
        os.environ.get("ALERT_DATA_UNIT", "").strip() or None,
    )
    store.close()
    log.info("Alert check: %s", ", ".join(f"{p.action} {p.key}" for p in posts) or "all well")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(prog="python -m hyperstim_api.collector")
    commands = parser.add_subparsers(dest="command", required=True)
    seed_cmd = commands.add_parser("seed", help="start from v2's lists (once)")
    seed_cmd.add_argument("research_repo", type=Path)
    commands.add_parser("run", help="collect until stopped")
    commands.add_parser("status", help="what the collector has done")
    commands.add_parser("export", help="write the TSV files again")
    commands.add_parser("alerts", help="the hourly alert check: open, comment on, close issues")
    recount_cmd = commands.add_parser(
        "recount", help="the changelog's day-end counts from daily backups (once)"
    )
    recount_cmd.add_argument("backups", type=Path, nargs="+")
    args = parser.parse_args()
    s = settings()
    if args.command == "seed":
        store = open_store(s)
        print(seeding.seed(store, args.research_repo, Path(_required("DATASET_PATH"))))
        export(store, s.data_dir / "collected")
        store.close()
    elif args.command == "run":
        run(s)
    elif args.command == "status":
        print(status(s))
    elif args.command == "alerts":
        check_alerts(s)
    elif args.command == "recount":
        store = open_store(s)
        with tempfile.TemporaryDirectory() as scratch:
            print("\n".join(recount(store, args.backups, Path(scratch))))
        export(store, s.data_dir / "collected")
        store.close()
    else:
        store = open_store(s)
        export(store, s.data_dir / "collected")
        store.close()


if __name__ == "__main__":
    main()
