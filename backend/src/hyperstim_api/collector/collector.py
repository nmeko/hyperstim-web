"""The collector's work, one small job at a time (plan 013, decisions 2-7).

`Collector.tick()` does whatever is due and says how long to wait before the next tick:
read channels' newest uploads (daily) and new channels' full lists, run a few discovery
searches (each query weekly), re-check near misses (monthly), dataset videos (monthly) and
the dataset channels' names (weekly), fill gaps (daily), check the uploads the channel-first
rule needs next, and download and measure the next eligible one when the pace allows.

When something fails (decision 12), one failure never stops the rest, no decision is final
on one answer, unfinished work resumes, and a video goes on the site only when everything
it shows is in place.
"""

import calendar
import contextlib
import csv
import functools
import importlib.util
import json
import logging
import math
import os
import random
import re
import shutil
import statistics
import subprocess
import sys
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from hyperstim_api import scoring
from hyperstim_api.analysis import BLOCK_MARKER, PIPELINE_DIR, AnalysisError, Pipeline
from hyperstim_api.collector import notes, sampling
from hyperstim_api.collector.seed import tier
from hyperstim_api.collector.store import IN_STATES, KEPT, Store, Upload
from hyperstim_api.collector.youtube import ApiError, DataApi, OutOfUnits, quota_day
from hyperstim_api.dataset import LEFT_OUT_FILE, Dataset
from hyperstim_api.thumbnails import OFFLINE_HINTS

log = logging.getLogger(__name__)

DAY_S = 24 * 3600
# v2's discovery queries (56_channel_yield_probe.py), run each once a week.
QUERIES: tuple[str, ...] = (
    "nursery rhymes", "kids songs", "children's songs", "sing along songs for kids",
    "kids music videos", "toddler songs",
    "cartoons for kids", "kids animation series", "stories for children",
    "kids cartoon full episodes", "storytime for kids", "fairy tales for kids",
    "preschool cartoon show",
    "learning videos for kids", "educational videos for children", "kids science experiments",
    "learn colors and shapes", "phonics for kids", "math for kids", "stem for kids",
    "preschool learning",
    "kids gaming", "minecraft for kids", "roblox gameplay for kids", "family friendly gaming",
    "kids game commentary", "video games for kids",
    "toy play for kids", "kids crafts", "diy for kids", "kids challenge videos",
    "play doh videos for kids", "arts and crafts for children", "sensory play for toddlers",
    "outdoor activities for kids", "kids exercise",
)  # fmt: skip
QUERIES_PER_DAY = math.ceil(len(QUERIES) / 7)
MIN_SUBSCRIBERS = 10_000  # v2's channel rules
MIN_VIDEOS = 100  # more than this many
WAITING_EVERY_S = 7 * DAY_S  # the waiting channels' subscribers are read again this often
NAMES_EVERY_S = 7 * DAY_S  # the dataset channels' names are read again this often
CHANNELS_PER_TICK = 25  # newest-uploads reads per tick, so other work isn't held up
MAX_PAGES = 200  # pages of a channel's uploads read in one go (50 a page); more on the next tick
CHECK_BATCHES_PER_TICK = 10  # of 50 uploads, so years with few eligible ones can't hold a tick
CH_LEVELS = 5  # the changelog counts the channels with 1 to 4 videos, and with 5 or more
LEFT_OUT_CHECKS_PER_DAY = 50  # uploads of left-out channels checked beyond the others
OFFLINE_EVERY_S = 30 * DAY_S
BLOCK_WAIT_S = 6 * 3600
MAX_BLOCK_WAIT_S = 48 * 3600
PACE_BACK_S = 3 * DAY_S  # a halved pace doubles after this long without a block, up to full
# A failed download (not a block) is tried again after these waits; the next failure gives up.
RETRY_AFTER_S = (DAY_S, 3 * DAY_S, 7 * DAY_S)
FAILURES_IN_A_ROW = 3  # then downloads pause, with no change to the pace
# After a Data API error, an item (a channel's list, a batch of uploads) or a job waits this
# long, then a day at a time; an error is no answer about the item, so it's never final.
API_RETRY_AFTER_S = (3600, 6 * 3600, DAY_S)
BACKUP_RETRY_S = 3600
REPAIR_BATCHES = 10  # of 50 uploads or channels, per repair pass
FAILURE_PAUSE_S = 3600
LOGS_KEPT_S = 30 * DAY_S  # the downloader's output for failed downloads, in download-logs/
FREE_SPACE_MIN = 50 * 1024**3
BACKUPS_KEPT = 7  # daily copies of collector.db, in clips_dir/backups
# The collector rests in each UTC day's last minutes, so no work runs over midnight and the day
# closes with its counts at 23:59:59 (decision 10).
REST_S = 600
DAY_END_DIR = "day-end"  # in collected/: the files as they stood at the last day's end
# The classifier's names → the dataset's category keys (dataset.CATEGORIES).
CATEGORY_NAMES = {
    "music": "music",
    "narrative": "narrative",
    "play": "play & activity",
    "educational": "educational",
    "gaming": "gaming",
}
LIVE_RUNNING = {"queued", "lookup", "download", "measure"}


@functools.cache
def load_classifier() -> Callable[[dict[str, str]], str | None]:
    """v2's keyword classifier (`pipeline/63_classify_categories.py`, unchanged): title, then
    tags, then description; None when no keyword fires."""
    path = PIPELINE_DIR / "63_classify_categories.py"
    spec = importlib.util.spec_from_file_location("classify_categories", path)
    assert spec and spec.loader
    module: Any = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def classify(row: dict[str, str]) -> str | None:
        category = module.classify(row)[0]
        return CATEGORY_NAMES[category] if category else None

    return classify


def scorer(reference: Dataset) -> Callable[[dict[str, float | None]], float | None]:
    """A video's score from its features, against the reference set, as the site scores it;
    None without a feature value."""

    def score(features: dict[str, float | None]) -> float | None:
        video = reference.score_video("", "", "", "", features)
        return video.score if video else None

    return score


def api_wait(failures: int) -> float:
    """How long an item or job waits after its `failures`-th Data API error in a row."""
    return API_RETRY_AFTER_S[min(failures, len(API_RETRY_AFTER_S)) - 1]


def utc(t: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


@dataclass
class Settings:
    data_dir: Path  # collector.db and the exported files (collected/)
    clips_dir: Path  # clips/, cache/ and a work/ folder, on the clips volume
    analysis_dir: Path | None  # the live analysis's results, block marker and offline hints
    per_day: int = 120
    units_per_day: int = 7000
    provenance: dict[str, str] = field(default_factory=dict)


class Collector:
    def __init__(
        self,
        settings: Settings,
        store: Store,
        api: DataApi,
        pipeline: Pipeline,
        is_short: Callable[[str], bool | None],
        classify: Callable[[dict[str, str]], str | None],
        probe_block: Callable[[str], bool],
        clock: Callable[[], float] = time.time,
        rng: random.Random | None = None,
        score: Callable[[dict[str, float | None]], float | None] = lambda features: None,
    ) -> None:
        self.s = settings
        self.store = store
        self.api = api
        self.pipeline = pipeline
        self.is_short = is_short
        self.classify = classify
        self.probe_block = probe_block  # after a failed download: is YouTube blocking us?
        self.clock = clock
        self.rng = rng or random.Random()
        self.score = score  # a video's score from its features, against the reference set

    # --- the loop --------------------------------------------------------------------

    def tick(self) -> float:
        """Do what's due; returns the seconds to wait before the next tick. A job that fails
        is logged and waits; the others, and downloads, go on. Nothing in the day's last
        minutes; the first tick of a day closes the day before."""
        now = self.clock()
        to_midnight = DAY_S - now % DAY_S
        if to_midnight <= REST_S:
            self.store.set("tick_at", now)  # the alert check's sign that the collector runs
            self.store.set("tick_end", self.clock())
            return to_midnight + 1
        self.close_day(now)
        self.store.set("tick_at", now)
        wait = self.work(now)
        self.store.set("tick_end", self.clock())
        return wait

    def work(self, now: float) -> float:
        self.back_up(now)
        self.prune_logs(now)
        # Also at least daily, so the channels left out for their kids share are judged again
        # (and at the first start, before any download).
        if self.store.get("export_due") or now - float(self.store.get("left_out_at", "0")) >= DAY_S:
            self.export()
        self.take_offline_hints()
        if self.store.get("out_of_units") != quota_day(now):
            for job in (
                self.refresh_uploads,
                self.finish_listings,
                self.discover,
                self.check_near_misses,
                self.refresh_waiting,
                self.refresh_names,
                self.check_online,
                self.repair,
                self.check_candidates,
            ):
                if not self.api_job(job, now):
                    break
        wait = self.maybe_download(self.clock())
        return max(5.0, min(wait, 60.0))

    def api_job(self, job: Callable[[float], None], now: float) -> bool:
        """Runs a job that calls the Data API, unless it's waiting after an error; False when
        the day's units are used up."""
        name = job.__name__
        if now < float(self.store.get(f"retry_at:{name}", "0")):
            return True
        try:
            job(now)
        except OutOfUnits as exc:
            log.warning("Data API units used up for today: %s", exc)
            self.store.set("out_of_units", quota_day(now))
            return False
        except ApiError as exc:
            failures = int(self.store.get(f"api_failures:{name}", "0")) + 1
            self.store.set(f"api_failures:{name}", failures)
            self.store.set(f"retry_at:{name}", now + api_wait(failures))
            log.warning("Data API error in %s (%d in a row): %s", name, failures, exc)
            return True
        self.store.set(f"api_failures:{name}", 0)
        self.store.set(f"ok:{name}", utc(now))
        return True

    # --- upload lists ----------------------------------------------------------------

    def refresh_uploads(self, now: float) -> None:
        """Read the newest uploads of channels not read in the last day."""
        due = self.store.db.execute(
            "SELECT id FROM channels WHERE status = 'in' AND COALESCE(listed_at, 0) < ? "
            "AND retry_at <= ? ORDER BY COALESCE(listed_at, 0), id LIMIT ?",
            (now - DAY_S, now, CHANNELS_PER_TICK),
        ).fetchall()
        for row in due:
            try:
                added = self.list_newest(row["id"])
            except ApiError as exc:
                self.channel_failed(row["id"], now, exc)
                continue
            self.store.update_channel(row["id"], listed_at=now, api_failures=0)
            if added:
                log.info("Channel %s: %d new uploads", row["id"], added)

    def list_newest(self, channel_id: str) -> int:
        """Pages through the channel's uploads (newest first), back to the first one we
        already have."""
        added, token = 0, None
        for _ in range(MAX_PAGES):
            uploads, token = self.api.uploads_page(channel_id, token)
            known = any(self.store.known(vid) for vid, _ in uploads)
            added += self.store.add_uploads(channel_id, uploads)
            if known or not token:
                break
        return added

    def finish_listings(self, now: float) -> None:
        """Go on reading the full upload lists of channels that joined (rule 3)."""
        due = self.store.db.execute(
            "SELECT id, full_listing FROM channels WHERE status = 'in' "
            "AND full_listing IS NOT NULL AND retry_at <= ? ORDER BY id LIMIT ?",
            (now, CHANNELS_PER_TICK),
        ).fetchall()
        for row in due:
            self.list_all(row["id"], row["full_listing"], now)

    def list_all(self, channel_id: str, token: str, now: float) -> None:
        """Reads the channel's uploads from page `token` ('' for the first), saving the next
        page after each, so a read that stops partway goes on from there; done when the last
        page is in."""
        added = 0
        try:
            for _ in range(MAX_PAGES):
                uploads, next_token = self.api.uploads_page(channel_id, token or None)
                with self.store.transaction():
                    added += self.store.add_uploads(channel_id, uploads)
                    self.store.update_channel(channel_id, full_listing=next_token, api_failures=0)
                if not next_token:
                    log.info("Channel %s: read all its uploads (%d new)", channel_id, added)
                    return
                token = next_token
        except ApiError as exc:
            self.channel_failed(channel_id, now, exc)
        if added:
            log.info("Channel %s: %d uploads so far, more to read", channel_id, added)

    def channel_failed(self, channel_id: str, now: float, exc: ApiError) -> None:
        """A Data API error reading the channel's uploads: it waits, the others go on."""
        row = self.store.db.execute(
            "SELECT api_failures FROM channels WHERE id = ?", (channel_id,)
        ).fetchone()
        failures = int(row["api_failures"]) + 1
        self.store.update_channel(
            channel_id, api_failures=failures, retry_at=now + api_wait(failures)
        )
        log.warning("Data API error reading %s's uploads (%d in a row): %s", channel_id,
                    failures, exc)  # fmt: skip

    # --- channels --------------------------------------------------------------------

    def discover(self, now: float) -> None:
        """Run today's share of v2's discovery queries (each query once a week)."""
        today = utc(now)[:10]
        if self.store.get("discovery_day") == today:
            return
        start = int(self.store.get("discovery_next", "0"))
        for i in range(start, min(start + QUERIES_PER_DAY, len(QUERIES))):
            found = [c for c in self.api.search_channels(QUERIES[i]) if c.startswith("UC")]
            self.admit(found, QUERIES[i], now)
            self.store.set("discovery_next", i + 1)
        if int(self.store.get("discovery_next")) >= len(QUERIES):
            self.store.set("discovery_next", 0)
            self.store.set("channels_checked_at", today)
        self.store.set("discovery_day", today)

    def admit(self, channel_ids: list[str], query: str, now: float) -> None:
        """Channels found by a query: add new ones that meet v2's rules, note the others."""
        new = [c for c in dict.fromkeys(channel_ids) if self.store.channel_status(c) is None]
        for i in range(0, len(new), 50):
            stats = self.api.channels(new[i : i + 50])
            for channel_id in new[i : i + 50]:
                found = stats.get(channel_id)
                if found is None:
                    continue
                self.judge(channel_id, found.title, found.subscriber_count, found.video_count,
                           now, query)  # fmt: skip

    def judge(
        self, channel_id: str, title: str, subscribers: int, videos: int, now: float, query: str
    ) -> None:
        if title.strip().endswith("- Topic"):
            status = "rejected"  # made by YouTube from a music catalogue (v2's rule)
        elif subscribers >= MIN_SUBSCRIBERS and videos > MIN_VIDEOS:
            status = "in"
        else:
            status = "near_miss"
        fields: dict[str, Any] = {
            "title": title,
            "subscriber_count": subscribers,
            "video_count": videos,
            "tier": tier(subscribers),
            "status": status,
            "joined_at": utc(now) if status == "in" else None,
            "checked_at": utc(now),
        }
        if self.store.channel_status(channel_id) is None:
            self.store.upsert_channel(id=channel_id, source="discovery", queries=query, **fields)
        else:  # a near miss read again: it keeps its source and queries
            self.store.update_channel(channel_id, **fields)
        if status == "in":
            self.store.update_channel(channel_id, listed_at=now, full_listing="")
            log.info("New channel %s (%s)", channel_id, title)
            self.list_all(channel_id, "", now)

    def check_near_misses(self, now: float) -> None:
        """Channels found before but under v2's bar, read again monthly."""
        due = self.store.db.execute(
            "SELECT id, queries, checked_at FROM channels WHERE status = 'near_miss' "
            "AND COALESCE(checked_at, '') < ? ORDER BY checked_at LIMIT 50",
            (utc(now - 30 * DAY_S),),
        ).fetchall()
        if not due:
            return
        stats = self.api.channels([r["id"] for r in due])
        for row in due:
            found = stats.get(row["id"])
            if found is None:
                self.store.update_channel(row["id"], checked_at=utc(now))
                continue
            self.judge(row["id"], found.title, found.subscriber_count, found.video_count, now,
                       row["queries"])  # fmt: skip

    def refresh_waiting(self, now: float) -> None:
        """The subscribers of the channels waiting for their first video, read again weekly, as
        they set the order the channels join in (decision 2). Left-out ones too, as they may
        come back. A channel no longer found keeps its counts."""
        due = self.store.db.execute(
            "SELECT id FROM channels WHERE status = 'in' AND id NOT IN (SELECT channel_id "
            f"FROM uploads WHERE state IN {IN_STATES}) AND COALESCE(checked_at, '') < ? "
            "ORDER BY checked_at, id LIMIT 50",
            (utc(now - WAITING_EVERY_S),),
        ).fetchall()
        if not due:
            return
        stats = self.api.channels([r["id"] for r in due])
        for row in due:
            found = stats.get(row["id"])
            counts = {} if found is None else {
                "subscriber_count": found.subscriber_count, "video_count": found.video_count,
            }  # fmt: skip
            self.store.update_channel(row["id"], checked_at=utc(now), **counts)

    def refresh_names(self, now: float) -> None:
        """The names of the channels with a video in the dataset (on the site, measured, or
        left out), read again weekly, so a channel renamed on YouTube shows its new name
        (plan 013, decision 9). A channel no longer found, or with no title, keeps its name."""
        due = self.store.db.execute(
            "SELECT id, title FROM channels WHERE id IN (SELECT channel_id FROM uploads "
            f"WHERE state IN {IN_STATES}) AND COALESCE(named_at, '') < ? "
            "ORDER BY named_at, id LIMIT 50",
            (utc(now - NAMES_EVERY_S),),
        ).fetchall()
        if not due:
            return
        stats = self.api.channels([r["id"] for r in due])
        for row in due:
            found = stats.get(row["id"])
            title = "" if found is None else found.title.strip()
            if title and title != row["title"]:
                if row["title"].strip():
                    log.info("Renamed %s: %s -> %s", row["id"], row["title"], title)
                self.store.update_channel(row["id"], title=title, named_at=utc(now))
                self.store.set("export_due", "1")
            else:
                self.store.update_channel(row["id"], named_at=utc(now))

    # --- the dataset's videos still online -------------------------------------------

    def check_online(self, now: float) -> None:
        """Re-check dataset videos not checked in a month; take out the ones still gone a day
        later (two checks)."""
        due = self.store.in_dataset(now - OFFLINE_EVERY_S, now, 50)
        if not due:
            return
        try:
            details = self.api.videos([u.id for u in due])
        except ApiError:
            self.uploads_failed(due, now)
            raise  # and the job waits too
        removed = False
        for upload in due:
            found = details.get(upload.id)
            if found is not None and not found.region_blocked:
                self.store.db.execute(
                    "UPDATE uploads SET online_at = ?, unsure = 0, api_failures = 0 WHERE id = ?",
                    (now, upload.id),
                )
                continue
            reason = "gone" if found is None else "region"
            if upload.unsure == 0:  # the first time: look again in a day
                self.store.db.execute(
                    "UPDATE uploads SET unsure = 1, api_failures = 0, retry_at = ? WHERE id = ?",
                    (now + DAY_S, upload.id),
                )
                continue
            with self.store.transaction():
                self.store.set_state(upload.id, "removed", reason)
                self.store.add_removed(upload.id, utc(now), reason)
            log.info("Took out %s: %s", upload.id, reason)
            removed = True
        if removed:
            self.export()

    def take_offline_hints(self) -> None:
        """Dataset videos whose thumbnail YouTube no longer has (the API's hints): due for the
        offline check now, so a gone video leaves in about a day, not a month."""
        if self.s.analysis_dir is None:
            return
        for hint in sorted((self.s.analysis_dir / OFFLINE_HINTS).glob("*")):
            # Not one already waiting for its second check: that would only delay it.
            self.store.db.execute(
                "UPDATE uploads SET online_at = 0 WHERE id = ? "
                "AND state IN ('v2', 'collected') AND unsure = 0",
                (hint.name,),
            )
            hint.unlink(missing_ok=True)

    def uploads_failed(self, uploads: list[Upload], now: float) -> None:
        """A Data API error checking a batch of uploads: they wait, so a batch that keeps
        failing makes way for the others."""
        for upload in uploads:
            failures = upload.api_failures + 1
            self.store.db.execute(
                "UPDATE uploads SET api_failures = ?, retry_at = ? WHERE id = ?",
                (failures, now + api_wait(failures), upload.id),
            )

    # --- filling gaps ----------------------------------------------------------------

    def repair(self, now: float) -> None:
        """Once a day, fill what's missing (rule 4): channel names, and the title, channel name
        or date of measured videos and of uploads listed without a date; measured videos that
        are now complete go on the site. A few units; none when nothing is missing."""
        day = utc(now)[:10]
        if self.store.get("repaired_day") == day:
            return
        db = self.store.db
        # Removals half-written before decision 12 (taken out, but never in removed.tsv): they
        # stay in the dataset and are checked again.
        db.execute(
            "UPDATE uploads SET online_at = 0, unsure = 0, retry_at = 0, reason = '', state = "
            "CASE WHEN id IN (SELECT video_id FROM collected) THEN 'collected' ELSE 'v2' END "
            "WHERE state = 'removed' AND id NOT IN (SELECT video_id FROM removed)"
        )
        named = self.repair_channel_names()
        filled = self.repair_uploads()
        added = self.add_completed(now)
        if named or added:
            self.export()
        if named or filled or added:
            log.info("Repaired: %d channel names, %d uploads; added %d", named, filled, added)
        self.store.set("repaired_day", day)

    def repair_channel_names(self) -> int:
        """Dataset channels (v2's or added) with a video that has no channel name, and no name
        of their own yet: looked up with `channels.list`."""
        ids = [
            r["channel_id"]
            for r in self.store.db.execute(
                "SELECT DISTINCT u.channel_id FROM uploads u "
                "JOIN channels c ON c.id = u.channel_id "
                "WHERE u.state IN ('v2', 'measured', 'collected') AND TRIM(u.channel_title) = '' "
                "AND TRIM(c.title) = '' ORDER BY u.channel_id LIMIT ?",
                (50 * REPAIR_BATCHES,),
            )
        ]
        named = 0
        for i in range(0, len(ids), 50):
            for channel_id, found in self.api.channels(ids[i : i + 50]).items():
                if found.title.strip():
                    self.store.update_channel(channel_id, title=found.title)
                    named += 1
        # Measured videos take their channel's name; v2's keep theirs (as in videos.tsv) and
        # the export carries the names for them.
        self.store.db.execute(
            "UPDATE uploads SET channel_title = (SELECT title FROM channels c "
            "WHERE c.id = uploads.channel_id) "
            "WHERE state = 'measured' AND TRIM(channel_title) = '' "
            "AND (SELECT TRIM(title) FROM channels c WHERE c.id = uploads.channel_id) != ''"
        )
        return named

    def repair_uploads(self) -> int:
        """Measured videos missing a title, channel name or date, and uploads listed without a
        date: looked up with `videos.list`. One missing 4 times running is gone (rule 2)."""
        rows = self.store.db.execute(
            "SELECT * FROM uploads WHERE (state = 'measured' AND (TRIM(title) = '' "
            "OR TRIM(channel_title) = '' OR published_at = '')) "
            "OR (state = 'new' AND published_at = '') ORDER BY id LIMIT ?",
            (50 * REPAIR_BATCHES,),
        ).fetchall()
        filled = 0
        for i in range(0, len(rows), 50):
            batch = rows[i : i + 50]
            details = self.api.videos([r["id"] for r in batch])
            for row in batch:
                found = details.get(row["id"])
                if found is None:
                    unsure = row["unsure"] + 1
                    if unsure > len(RETRY_AFTER_S):
                        self.store.set_state(row["id"], "ineligible", "gone", unsure=unsure)
                    else:
                        self.store.db.execute(
                            "UPDATE uploads SET unsure = ? WHERE id = ?", (unsure, row["id"])
                        )
                    continue
                self.store.db.execute(
                    "UPDATE uploads SET unsure = 0, "
                    "title = CASE WHEN TRIM(title) = '' THEN ? ELSE title END, "
                    "channel_title = CASE WHEN TRIM(channel_title) = '' THEN ? "
                    "ELSE channel_title END, "
                    "published_at = CASE WHEN published_at = '' THEN ? ELSE published_at END "
                    "WHERE id = ?",
                    (found.title, found.channel_title, found.published_at, row["id"]),
                )
                filled += 1
        return filled

    def add_completed(self, now: float) -> int:
        """Measured videos now complete go on the site, added now (so lists read as of an
        earlier time don't change)."""
        ids = [
            r["id"]
            for r in self.store.db.execute("SELECT id FROM uploads WHERE state = 'measured'")
        ]
        added = 0
        for video_id in ids:
            upload = self.store.upload(video_id)
            if upload is None or not upload.complete():
                continue
            with self.store.transaction():
                self.store.db.execute(
                    "UPDATE collected SET added_at = ? WHERE video_id = ?", (utc(now), video_id)
                )
                self.store.set_state(video_id, "collected")
            added += 1
        return added

    # --- picking ---------------------------------------------------------------------

    def rule(self, now: float) -> tuple[list[Any], list[tuple[str, list[sampling.Year]]]]:
        return rule(self.store, now)

    def check_candidates(self, now: float) -> None:
        """Check uploads in the order they'll be needed (plan 013, decision 2), a few at a
        time by number, so a download never waits for one: an upload asked again after an
        answer that couldn't settle it, when it's due (rule 2); a channel's lowest numbers
        until the filters can judge it (`KIDS_ANSWERS_MIN` answers) and, for one judged in
        but not on the site yet, until it has an upload ready for its first video, the
        channels with the most subscribers first, as they get theirs first; then the
        years the channels catching up need and the years the channel-first rule fills next
        (`rule`) that have none ready. Left-out channels'
        years get `LEFT_OUT_CHECKS_PER_DAY` more a day, as their answers decide whether they
        come back (decision 1)."""
        settled = utc(now - sampling.SETTLE_S)
        rows, order = self.rule(now)
        out = self.store.left_out_ids()
        due = {
            (r["channel_id"], int(r["y"])): r
            for r in rows
            if r["due"] and int(r["y"]) >= sampling.FIRST_YEAR
        }
        per_channel: dict[str, list[Any]] = {}
        for r in rows:
            per_channel.setdefault(r["channel_id"], []).append(r)
        limit = 50 * CHECK_BATCHES_PER_TICK
        ids: list[str] = []

        def take(channel_id: str, year: int | None, n: int) -> None:
            if len(ids) < limit and n > 0:
                ids.extend(v for v in self.store.lowest_unchecked(
                    channel_id, None if year is None else str(year), now, settled, n
                ) if v not in ids)  # fmt: skip

        for (channel_id, year), r in sorted(due.items()):
            if r["unsure"]:
                take(channel_id, year, 1)
        subscribers = self.store.subscribers()
        for channel_id, rs in sorted(
            per_channel.items(), key=lambda item: (-subscribers.get(item[0], 0), item[0])
        ):
            answers = sum(int(r["answers"]) for r in rs)
            on_site = any(int(r["videos"]) for r in rs)
            if answers < sampling.KIDS_ANSWERS_MIN:
                take(channel_id, None, sampling.KIDS_ANSWERS_MIN - answers)
            elif not on_site and channel_id not in out and not any(int(r["ready"]) for r in rs):
                take(channel_id, None, sampling.CHECKS_PER_YEAR)
        for channel_id, years in order:
            for y in years:
                if not y.ready and (channel_id, y.year) in due:
                    take(channel_id, y.year, sampling.CHECKS_PER_YEAR)
        today = utc(now)[:10]
        if self.store.get("left_out_checked") != today:
            budget = len(ids) + LEFT_OUT_CHECKS_PER_DAY
            years = sorted(
                (y for y in sampling.years_from(rows, today) if y.channel_id in out
                 and (y.channel_id, y.year) in due),
                key=lambda y: (y.rate, y.channel_id, y.year),
            )  # fmt: skip
            for y in years:
                if len(ids) >= budget:
                    break
                take(y.channel_id, y.year, sampling.CHECKS_PER_YEAR)
            del ids[budget:]
            self.store.set("left_out_checked", today)
        for start in range(0, len(ids), 50):
            self.check(ids[start : start + 50], now)

    def next_upload(self, now: float) -> Upload | None:
        """The next upload to download (plan 013, decision 2). An exploring one while exploring
        has had under a third of today's downloads (`sampling.explore_turn`): the channels
        catching up first, in their order (`sampling.catch_up_order`), the first with an upload
        ready in a year it needs; with none catching up, a channel's first video while fewer
        than `FIRST_VIDEOS_PER_DAY` channels got theirs today. Otherwise an expanding one: by
        the channel-first rule over the channels in, the first channel in line with an upload
        ready in one of its years below its threshold, the thinnest such year, its lowest
        number. Either goes to the other when it has nothing ready. A channel that caught up
        is marked so here."""
        _, ahead, done, expand = plan(self.store, now)
        for channel_id in done:
            self.store.set_catching_up(channel_id, False)

        def explore() -> Upload | None:
            for channel_id, years in ahead:
                for y in years:
                    if y.ready:
                        return self.store.ready_upload(channel_id, y.year, now)
            if not ahead and self.store.first_video_left(now):
                return self.store.first_video(now)
            return None

        def expanding() -> Upload | None:
            for channel_id, years in expand:
                for y in years:
                    if y.ready:
                        return self.store.ready_upload(channel_id, y.year, now)
            return None

        turns = (explore, expanding)
        if not sampling.explore_turn(*self.store.downloads_today(now)):
            turns = (expanding, explore)
        for turn in turns:
            upload = turn()
            if upload is not None:
                return upload
        return None

    def check(self, ids: list[str], now: float) -> None:
        """Eligibility of up to 50 uploads, by v2's checks, recording the rule they were
        checked for (`pick`). An answer that can't settle it (the upload missing, no
        made-for-kids answer, the Shorts probe undecided) is asked again after 1, 3 and 7 days;
        the 4th such answer is final (rule 2)."""
        uploads = [u for u in map(self.store.upload, ids) if u is not None]
        try:
            details = self.api.videos(ids)
        except ApiError:
            self.uploads_failed(uploads, now)
            raise  # and the job waits too
        for upload in uploads:
            video_id = upload.id
            found = details.get(video_id)
            short = None
            # Asked only when it's all that's left to settle, so ineligible uploads cost
            # YouTube no requests.
            if (
                found is not None
                and sampling.needs_shorts_probe(found)
                and sampling.verdict(found, False) == "eligible"
            ):
                short = self.is_short(video_id)
            verdict = sampling.verdict(found, short)
            if verdict == "wait":  # a premiere or stream not over yet
                self.store.db.execute(
                    "UPDATE uploads SET retry_at = ?, api_failures = 0 WHERE id = ?",
                    (now + DAY_S, video_id),
                )
                continue
            unsure = (
                verdict == "gone"
                or (verdict == "not_for_kids" and found is not None and found.made_for_kids is None)
                or (verdict == "short" and short is None)
            )
            if unsure and upload.unsure < len(RETRY_AFTER_S):
                self.store.db.execute(
                    "UPDATE uploads SET unsure = ?, api_failures = 0, reason = ?, retry_at = ? "
                    "WHERE id = ?",
                    (upload.unsure + 1, verdict, now + RETRY_AFTER_S[upload.unsure], video_id),
                )
                continue
            fields: dict[str, Any] = {
                "checked_at": now,
                "api_failures": 0,
                "unsure": upload.unsure + 1 if unsure else 0,
                "pick": "level",
            }
            if found is not None:
                fields.update(
                    title=found.title,
                    description=found.description,
                    tags=found.tags,
                    channel_title=found.channel_title,
                    duration_s=found.duration_s,
                )
                if not upload.published_at and found.published_at:
                    fields["published_at"] = found.published_at
            state = "eligible" if verdict == "eligible" else "ineligible"
            self.store.set_state(video_id, state, "" if state == "eligible" else verdict,
                                 **fields)  # fmt: skip

    # --- downloading and measuring ---------------------------------------------------

    def per_day(self, now: float) -> float:
        """The pace, halved after repeated blocks and doubled back every `PACE_BACK_S` without
        one."""
        factor = float(self.store.get("pace_factor", "1"))
        if factor < 1 and now - float(self.store.get("blocked_at", "0")) > PACE_BACK_S:
            factor = min(1.0, factor * 2)
            self.store.set("pace_factor", factor)
            self.store.set("blocked_at", now)  # the next doubling `PACE_BACK_S` later
        return self.s.per_day * factor

    def maybe_download(self, now: float) -> float:
        """Download and measure one video if it's time; returns the seconds until the next."""
        blocked_until = float(self.store.get("blocked_until", "0"))
        if now < blocked_until:
            return blocked_until - now
        paused_until = float(self.store.get("paused_until", "0"))
        if now < paused_until:
            return paused_until - now
        if self.live_blocked(now):
            return 600
        next_at = float(self.store.get("next_download_at", "0"))
        if now < next_at:
            return next_at - now
        if self.store.attempts_since(now - DAY_S) >= self.per_day(now):
            return 600
        if self.live_running() or self.low_on_space():
            return 60
        upload = self.next_upload(now)
        if upload is None:
            return 60
        self.collect(upload, now)
        gap = self.rng.expovariate(self.per_day(now) / DAY_S)  # random spacing, on average even
        self.store.set("next_download_at", self.clock() + gap)
        return gap

    def fill_scores(self, reference: dict[str, float]) -> None:
        """The dataset videos' scores, which the download order goes by (decision 2): v2's
        picks from the reference set (`reference`: video ID -> score), the added ones scored
        against it, as the site does."""
        with self.store.transaction():
            self.store.set_scores(reference.items())
            self.store.set_scores(
                (r["video_id"], self.score(json.loads(r["features"])))
                for r in self.store.unscored()
            )

    def collect(self, upload: Upload, now: float) -> None:
        """Download, measure and classify the upload, and add it; or, while it lacks a title,
        channel name or date, keep it measured until the repair pass fills the gap (rule 6).
        Any failure is a failed try (rule 2)."""
        reused = self.live_result(upload.id)
        work = self.s.clips_dir / "work" / upload.id
        shutil.rmtree(work, ignore_errors=True)
        try:
            if reused is not None:
                features, source = reused, "live analysis"
            else:
                work.mkdir(parents=True)
                self.pipeline.download(upload.id, work)
                features = self.pipeline.measure(upload.id, work)
                source = "collector"
                self.keep_clip(upload.id, work)
            if all(features.get(k) is None for k in scoring.FEATURES):
                raise AnalysisError("failed", "measured no feature values")
            category = self.classify(
                {"title": upload.title, "tag": upload.tags, "desc": upload.description}
            )
        except AnalysisError as exc:
            self.failed(upload, now, str(exc), self.keep_logs(upload.id, work, now))
            return
        except Exception as exc:  # disk, classifier, …: not YouTube, so no block probe
            log.exception("Unexpected error collecting %s", upload.id)
            self.failed(upload, now, f"{type(exc).__name__}: {exc}", None, probe=False)
            return
        finally:
            shutil.rmtree(work, ignore_errors=True)
        complete = upload.complete()
        first = not self.store.has_videos(upload.channel_id)
        with self.store.transaction():
            self.store.add_collected(
                upload.id,
                utc(self.clock()),
                category,
                features,
                0.0,  # no cut-off under rule v2: the year files leave it blank
                {**self.s.provenance, "measured_by": source},
            )
            self.store.set_state(upload.id, "collected" if complete else "measured",
                                 online_at=now, score=self.score(features))  # fmt: skip
            if first:  # it catches up from exploring's share (decision 2)
                self.store.set_catching_up(upload.channel_id, True)
            self.store.log_attempt(upload.id, now, "collected")
        self.store.set("block_wait", 0)
        self.store.set("failures_in_a_row", 0)
        if not complete:
            log.info("Measured %s; waiting for its title, channel name or date", upload.id)
            return
        self.export()
        log.info("Added %s (%s, %s)", upload.id, category or "no category", upload.title[:60])

    def failed(
        self, upload: Upload, now: float, message: str, log_file: Path | None, probe: bool = True
    ) -> None:
        where = f" (log: {log_file})" if log_file else ""
        if probe and self.probe_block(upload.id):
            wait = min(
                MAX_BLOCK_WAIT_S, max(BLOCK_WAIT_S, 2 * int(self.store.get("block_wait", "0")))
            )
            if int(self.store.get("block_wait", "0")):  # blocked again right after a wait
                factor = float(self.store.get("pace_factor", "1"))
                self.store.set("pace_factor", max(0.125, factor / 2))
            else:
                self.store.set("blocked_since", now)
            self.store.set("block_wait", wait)
            self.store.set("blocked_until", now + wait)
            self.store.set("blocked_at", now)
            self.store.log_attempt(upload.id, now, "blocked", message)
            self.store.set("failures_in_a_row", 0)
            log.warning("YouTube is blocking downloads; waiting %.0f h%s", wait / 3600, where)
            return  # the video stays eligible and is tried again
        # Not a block: try again later, as often as RETRY_AFTER_S allows (plan 013, decision 7).
        with self.store.transaction():
            self.store.log_attempt(upload.id, now, "failed", message)
            failures = self.store.failures(upload.id)
            if failures > len(RETRY_AFTER_S):
                self.store.set_state(upload.id, "failed", message[-300:])
                then = "given up"
            else:
                retry_at = now + RETRY_AFTER_S[failures - 1]
                self.store.set_state(upload.id, "eligible", message[-300:], retry_at=retry_at)
                then = f"trying again after {utc(retry_at)}"
        log.warning(
            "Couldn't collect %s (failure %d, %s): %s%s",
            upload.id, failures, then, message[-200:], where,
        )  # fmt: skip
        in_a_row = int(self.store.get("failures_in_a_row", "0")) + 1
        if in_a_row >= FAILURES_IN_A_ROW:
            self.store.set("paused_until", now + FAILURE_PAUSE_S)
            in_a_row = 0
            log.warning(
                "%d failed downloads in a row; pausing %.0f min",
                FAILURES_IN_A_ROW, FAILURE_PAUSE_S / 60,
            )  # fmt: skip
        self.store.set("failures_in_a_row", in_a_row)

    def keep_logs(self, video_id: str, work: Path, now: float) -> Path | None:
        """The download script's output for each failed try, kept as one file in
        download-logs/<date>/ (see `prune_logs`)."""
        tries = sorted((work / "clips").glob(f"{video_id}.*.log"))
        tries += sorted(work.glob("download-log-*.tsv"))
        if not tries:
            return None
        path = self.s.data_dir / "download-logs" / utc(now)[:10] / f"{video_id}.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as out:
            for one in tries:
                out.write(f"===== {one.name} =====\n")
                out.write(one.read_text(encoding="utf-8", errors="replace"))
                out.write("\n")
        return path

    def keep_clip(self, video_id: str, work: Path) -> None:
        """Keep the clip and its feature cache on the clips volume (plan 013, decision 6)."""
        for name, folder in (
            (f"clips/{video_id}.mp4", "clips"),
            (f"cache/{video_id}.npz", "cache"),
        ):
            source = work / name
            if source.exists():
                (self.s.clips_dir / folder).mkdir(parents=True, exist_ok=True)
                os.replace(source, self.s.clips_dir / folder / source.name)

    def live_result(self, video_id: str) -> dict[str, float | None] | None:
        """Features of the video if a live check already measured it."""
        if self.s.analysis_dir is None:
            return None
        path = self.s.analysis_dir / f"{video_id}.json"
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        features = record.get("features")
        if record.get("status") == "done" and isinstance(features, dict):
            return {k: features.get(k) for k in scoring.FEATURES}
        return None

    def live_running(self) -> bool:
        """A live check waiting or running: it goes first."""
        if self.s.analysis_dir is None or not self.s.analysis_dir.is_dir():
            return False
        for path in self.s.analysis_dir.glob("*.json"):
            with contextlib.suppress(OSError, ValueError):
                if json.loads(path.read_text(encoding="utf-8")).get("status") in LIVE_RUNNING:
                    return True
        return False

    def live_blocked(self, now: float) -> bool:
        """The live analysis saw a block in the last 6 hours."""
        if self.s.analysis_dir is None:
            return False
        try:
            at = float((self.s.analysis_dir / BLOCK_MARKER).read_text().strip())
        except (OSError, ValueError):
            return False
        return now - at < BLOCK_WAIT_S

    def low_on_space(self) -> bool:
        self.s.clips_dir.mkdir(parents=True, exist_ok=True)
        free = shutil.disk_usage(self.s.clips_dir).free
        low = free < FREE_SPACE_MIN
        self.store.set("low_space", "1" if low else "")
        if low:
            log.warning("Paused: %.0f GB free on the clips volume", free / 1024**3)
        return low

    def prune_logs(self, now: float) -> None:
        """Delete the days of download logs older than LOGS_KEPT_S."""
        oldest = utc(now - LOGS_KEPT_S)[:10]
        with contextlib.suppress(OSError):
            for day in (self.s.data_dir / "download-logs").glob("????-??-??"):
                if day.name < oldest:
                    shutil.rmtree(day, ignore_errors=True)

    # --- backup ----------------------------------------------------------------------

    def back_up(self, now: float) -> None:
        """Once a day (UTC), a copy of collector.db on the clips volume, so losing the disk it's
        on doesn't lose the collector's state; the newest few are kept."""
        day = utc(now)[:10]
        if self.store.get("backed_up") == day:
            return
        if now < float(self.store.get("retry_at:back_up", "0")):
            return
        folder = self.s.clips_dir / "backups"
        try:
            folder.mkdir(parents=True, exist_ok=True)
            self.store.backup(folder / f"collector-{day}.db")
            for old in sorted(folder.glob("collector-*.db"))[:-BACKUPS_KEPT]:
                old.unlink()
        except Exception:  # e.g. the clips volume full or missing: the rest goes on
            failures = int(self.store.get("backup_failures", "0")) + 1
            self.store.set("backup_failures", failures)
            self.store.set("retry_at:back_up", now + BACKUP_RETRY_S)
            log.exception("Backup failed (%d in a row); trying again in an hour", failures)
            return
        self.store.set("backed_up", day)
        self.store.set("backup_failures", 0)
        self.store.set("ok:back_up", utc(now))
        log.info("Backed up collector.db to %s", folder)

    # --- closing the day (decision 10) -------------------------------------------------

    def close_day(self, now: float) -> None:
        """On the first tick of a UTC day: records the day before's counts that can't be worked
        out again (`ch_ready`, `ch_out`, `ch_yr_2nd`, `ch_yr_med`), then writes the files and their
        day-end copy. When the last tick finished before midnight, nothing has changed since,
        so the counts are the day's end (also for days the collector was down); otherwise
        they're as of now, and only the day before gets them."""
        midnight = now - now % DAY_S
        yesterday = utc(midnight - DAY_S)[:10]
        closed = self.store.get("closed_day")
        if not closed:  # the first run with this: the day before was recorded the old way
            self.store.set("closed_day", yesterday)
            return
        if closed >= yesterday:
            return
        started = float(self.store.get("tick_at", "0") or 0)
        ended = float(self.store.get("tick_end", "0") or 0)
        exact = started <= ended < midnight
        self.store.update_left_out(utc(now)[:10], now)
        ready, out = self.store.ready_to_join(), len(self.store.left_out_list())
        years = channel_averages(self.store, yesterday)
        day = midnight - DAY_S
        with self.store.transaction():
            while utc(day)[:10] > closed:
                if exact or utc(day)[:10] == yesterday:
                    at = day + DAY_S if exact else now
                    self.store.record_daily(utc(day)[:10], ready, out, at, years)
                day -= DAY_S
            self.store.set("closed_day", yesterday)
        if not exact:
            log.warning("Closed %s late: its counts are as of %s", yesterday, utc(now))
        self.export()
        try:
            export(self.store, self.s.data_dir / "collected" / DAY_END_DIR, now, until=midnight)
        except Exception:  # the daily commit then waits for the next day's copy
            log.exception("Couldn't write the day-end copy of %s", yesterday)

    # --- export ----------------------------------------------------------------------

    def export(self) -> None:
        """Writes the files the API reads; if that fails, tries again on the next tick."""
        try:
            export(self.store, self.s.data_dir / "collected", self.clock())
        except Exception:
            self.store.set("export_due", "1")
            self.store.set("export_failures", int(self.store.get("export_failures", "0")) + 1)
            if not self.store.get("export_failed_since"):
                self.store.set("export_failed_since", self.clock())
            log.exception("Export failed; trying again on the next tick")
            return
        self.store.set("left_out_at", self.clock())  # judged again in a day at the latest
        self.store.set("export_due", "")
        self.store.set("export_failures", 0)
        self.store.set("export_failed_since", "")
        self.store.set("ok:export", utc(self.clock()))


COLUMNS = (
    "video_id", "title", "channel_id", "channel_title", "category", "published_at",
    "duration_s", *scoring.FEATURES, "added_at", "r", "cutoff", "pick", "rule_version",
    "measured_by", "ytdlp_version", "ffmpeg_version", "pipeline_commit", "cache_version",
)  # fmt: skip


def export(
    store: Store, directory: Path, now: float | None = None, until: float | None = None
) -> None:
    """The added videos (one file per year of adding, in the order added), the removed ones,
    the channels left out for their kids share or eligible uploads per year (worked out again
    here) and a little metadata,
    each written whole and renamed into place, for the API to reload. With `until` (a
    midnight), only the videos added and taken out before it: the day-end copy."""
    directory.mkdir(parents=True, exist_ok=True)
    now = time.time() if now is None else now
    store.update_left_out(utc(now)[:10], now)
    before = "9999" if until is None else utc(until)
    by_year: dict[str, list[dict[str, object]]] = {}
    for row in store.collected_rows():
        if row["added_at"] >= before:
            continue
        features = json.loads(row["features"])
        provenance = json.loads(row["provenance"])
        out: dict[str, object] = {
            "video_id": row["video_id"],
            "title": row["title"],
            "channel_id": row["channel_id"],
            "channel_title": row["channel_title"],
            "category": row["category"] or "",
            "published_at": row["published_at"][:10],
            "duration_s": row["duration_s"] if row["duration_s"] is not None else "",
            "added_at": row["added_at"],
            "r": f"{row['r']:.9f}",
            "cutoff": "" if row["pick"] == "level" else f"{row['cutoff']:.9f}",
            "pick": row["pick"],
            "rule_version": sampling.rule_version(row["pick"]),
        }
        out.update({k: "" if features.get(k) is None else features[k] for k in scoring.FEATURES})
        out.update({k: provenance.get(k, "") for k in COLUMNS if k not in out})
        by_year.setdefault(row["added_at"][:4], []).append(out)
    for year, rows in by_year.items():
        _write_tsv(directory / f"{year}.tsv", COLUMNS, rows)
    removed = [dict(r) for r in store.removed_rows() if r["removed_at"] < before]
    _write_tsv(directory / "removed.tsv", ("video_id", "removed_at", "reason"), removed)
    _write_tsv(
        directory / "channel-names.tsv", ("channel_id", "channel_title"), channel_names(store)
    )
    _write_tsv(directory / LEFT_OUT_FILE, LEFT_OUT_COLUMNS, left_out_rows(store))
    changes = changelog(store, time.time() if now is None else now)
    _write_tsv(directory / "CHANGELOG.tsv", CHANGELOG_COLUMNS, changes)
    meta = {"channelsCheckedAt": store.get("channels_checked_at") or None}
    _replace(directory / "meta.json", json.dumps(meta) + "\n")


def recount(store: Store, backups: list[Path], scratch: Path) -> list[str]:
    """Works out `ch_ready`, `ch_out`, `ch_yr_2nd` and `ch_yr_med` again from daily backups of
    collector.db (decision 10): each was taken on a day's first tick, so it holds the end of
    the day before. Records
    them for that day with the backup's time (its `tick_at`, else the file's), unless the day
    has a count from 23:59:59 or from closer to it (then only its blank `ch_yr_2nd` and
    `ch_yr_med` are filled in), or is before the collector's first day.
    Returns a line per backup saying what it did."""
    first = store.db.execute("SELECT MIN(added_at) FROM collected").fetchone()[0]
    daily = store.daily()
    done: list[str] = []
    for path in sorted(backups):
        copy = scratch / path.name  # judged again in a copy, so the backup stays as it was
        shutil.copyfile(path, copy)
        backup = Store(copy)
        at = float(backup.get("tick_at") or path.stat().st_mtime)
        day = utc(at - at % DAY_S - DAY_S)[:10]
        recorded = daily.get(day)
        if first is None or day < first[:10]:
            done.append(f"{path.name}: {day} is before the first day, skipped")
        elif recorded is not None and recorded["at"] is not None and recorded["at"] <= at:
            if recorded["ch_yr_2nd"] is not None and recorded["ch_yr_med"] is not None:
                done.append(f"{path.name}: {day} already has a closer count, skipped")
            else:  # its closer counts stay; only the videos per year it lacks are filled in
                backup.update_left_out(day, at)
                years = channel_averages(backup, day)
                store.fill_years(day, years)
                done.append(
                    f"{path.name}: {day} already has a closer count, kept; filled in "
                    f"ch_yr_2nd {_avg(years[0]) or '-'}, ch_yr_med {_avg(years[1]) or '-'}"
                )
        else:
            backup.update_left_out(day, at)
            ready, out = backup.ready_to_join(), len(backup.left_out_list())
            years = channel_averages(backup, day)
            store.record_daily(day, ready, out, at, years)
            done.append(
                f"{path.name}: {day} ch_ready {ready}, ch_out {out}, "
                f"ch_yr_2nd {_avg(years[0]) or '-'}, ch_yr_med {_avg(years[1]) or '-'}, "
                f"as of {utc(at)}"
            )
        backup.close()
    return done


def channel_names(store: Store) -> list[dict[str, object]]:
    """The current names of the channels with videos in the dataset (or taken out of it): the
    API shows them instead of the name a video carries, which is its channel's name when it
    was collected (plan 013, decision 9)."""
    rows = store.db.execute(
        "SELECT c.id, c.title FROM channels c WHERE TRIM(c.title) != '' AND EXISTS ("
        "SELECT 1 FROM uploads u WHERE u.channel_id = c.id "
        f"AND (u.state IN {IN_STATES} OR u.state = 'removed')) ORDER BY c.id"
    )
    return [{"channel_id": r["id"], "channel_title": r["title"]} for r in rows]


LEFT_OUT_COLUMNS = (
    "channel_id", "channel_title", "checked", "for_kids", "kids_pct", "per_year", "reason",
    "since", "videos",
)  # fmt: skip


def left_out_rows(store: Store) -> list[dict[str, object]]:
    """The channels left out for their kids share or their eligible uploads per year, with the
    numbers behind it (plan 013, decisions 1 and 10): the checked uploads, how many of them are
    made for kids, their share, the estimated eligible uploads per active year, why it's left
    out, the day it was last left out (UTC), and the channel's videos in the dataset that the
    site doesn't show."""
    return [
        {
            "channel_id": r["channel_id"],
            "channel_title": r["title"],
            "checked": r["answers"],
            "for_kids": r["kids"],
            "kids_pct": f"{100 * r['kids'] / r['answers']:.1f}",
            "per_year": "" if r["per_year"] is None else f"{r['per_year']:.1f}",
            "reason": r["reason"],
            "since": "" if r["since"] is None else utc(r["since"])[:10],
            "videos": r["videos"],
        }
        for r in store.left_out_list()
    ]


CHANGELOG_COLUMNS = (
    "date", "videos", "channels", *(f"ch_{n}" for n in range(1, CH_LEVELS)),
    f"ch_{CH_LEVELS}plus", "ch_ready", "ch_out", "ch_yr_2nd", "ch_yr_med", "added_v", "removed_v",
    "new_ch", "note",
)  # fmt: skip


def changelog(store: Store, now: float) -> list[dict[str, object]]:
    """One line per finished UTC day with a change, a recorded count or a note, the newest
    first: the site at 23:59:59 (videos, channels, the channels by their number of videos),
    the channels ready to join and left out and the thinnest and typical channel-year as
    recorded when the day was closed, the day's
    changes and its notes. The channels left out now count as never there, as on the site. The
    days before each record began have none (blank), since they can't be counted again; a
    recorded count not from 23:59:59 gets a note saying when it's from."""
    today = time.strftime("%Y-%m-%d", time.gmtime(now))
    store.date_notes(notes.NOTES, today)
    channel_of = {
        r["id"]: r["channel_id"]
        for r in store.db.execute(
            "SELECT id, channel_id FROM uploads WHERE state IN ('v2', 'collected', 'removed') "
            f"AND channel_id {KEPT}"
        )
    }
    collected = {
        r["video_id"]: r["added_at"] for r in store.collected_rows() if r["video_id"] in channel_of
    }
    events = [(at, "add", vid) for vid, at in collected.items()]
    events += [
        (r["removed_at"], "remove", r["video_id"])
        for r in store.removed_rows()
        if r["video_id"] in channel_of
    ]
    events.sort()
    daily = store.daily()
    notes_by_day = store.notes()
    # The reference set: v2's picks, also the ones removed since.
    visible = Counter(channel_of[v] for v in channel_of if v not in collected)
    days = sorted(d for d in {at[:10] for at, _, _ in events} | set(daily) | set(notes_by_day)
                  if d < today)  # fmt: skip
    lines: list[dict[str, object]] = []
    i = 0
    for day in days:
        line: dict[str, object] = {"added_v": 0, "removed_v": 0, "new_ch": 0}
        while i < len(events) and events[i][0][:10] == day:
            _, kind, video_id = events[i]
            i += 1
            channel = channel_of[video_id]
            if kind == "add":
                line["added_v"] = int(str(line["added_v"])) + 1
                line["new_ch"] = int(str(line["new_ch"])) + (visible[channel] == 0)
                visible[channel] += 1
            elif visible[channel] > 0:
                line["removed_v"] = int(str(line["removed_v"])) + 1
                visible[channel] -= 1
        levels = Counter(min(n, CH_LEVELS) for n in visible.values() if n > 0)
        recorded = daily.get(day)
        end = calendar.timegm(time.strptime(day, "%Y-%m-%d")) + DAY_S
        logged = store.left_out_at(end)  # from the log, from its first day on
        out = recorded["ch_out"] if logged is None and recorded is not None else logged
        line |= {
            "date": day,
            "videos": sum(visible.values()),
            "channels": sum(levels.values()),
            **{f"ch_{n}": levels[n] for n in range(1, CH_LEVELS)},
            f"ch_{CH_LEVELS}plus": levels[CH_LEVELS],
            "ch_ready": recorded["ch_ready"] if recorded else "",
            "ch_out": "" if out is None else out,
            "ch_yr_2nd": _avg(recorded["ch_yr_2nd"]) if recorded else "",
            "ch_yr_med": _avg(recorded["ch_yr_med"]) if recorded else "",
            "note": "; ".join(
                notes_by_day.get(day, []) + recorded_when(day, recorded, logged is not None)
            ),
        }
        lines.append(line)
    return lines[::-1]


def rule_years(store: Store, now: float) -> tuple[list[Any], list[sampling.Year]]:
    """The store's rows of the channel-years (`year_rows`) and the years of the channels that
    aren't left out, as the channel-first rule sees them (decisions 1 and 2)."""
    rows = store.year_rows(now, utc(now - sampling.SETTLE_S), utc(now)[:10])
    out = store.left_out_ids()
    return rows, [y for y in sampling.years_from(rows, utc(now)[:10]) if y.channel_id not in out]


Order = list[tuple[str, list[sampling.Year]]]


def plan(store: Store, now: float) -> tuple[list[Any], Order, list[str], Order]:
    """The store's rows of the channel-years (`year_rows`), and of the channels on the site
    that aren't left out (decision 2): exploring's order of the channels catching up
    (`sampling.catch_up_order`), the ones of them that caught up, and the channel-first order
    of the others (`sampling.pick_order`)."""
    rows, years = rule_years(store, now)
    scores = store.channel_scores()
    ahead, done = sampling.catch_up_order(years, store.catching_up(), scores)
    catching = {c for c, _ in ahead}
    expand = sampling.pick_order([y for y in years if y.channel_id not in catching], scores)
    return rows, ahead, done, expand


def rule(store: Store, now: float) -> tuple[list[Any], Order]:
    """The store's rows of the channel-years (`year_rows`) and the order the channels on the
    site that aren't left out are filled in: the channels catching up, then channel first
    (decisions 1 and 2)."""
    rows, ahead, _, expand = plan(store, now)
    return rows, ahead + expand


def channel_averages(store: Store, day: str) -> tuple[float | None, float | None]:
    """The channels' videos per year on the site on `day` (decision 10): the second smallest
    among the channels with an upload left to take (`ch_yr_2nd`), and the median over all
    (`ch_yr_med`); None without channels."""
    out = store.left_out_ids()
    by: dict[str, list[sampling.Year]] = {}
    for y in sampling.years_from(store.year_rows(0, "", day), day):
        if y.channel_id not in out:
            by.setdefault(y.channel_id, []).append(y)
    avgs = {c: sampling.average(ys, site=True) for c, ys in by.items() if any(y.site for y in ys)}
    values = [a for a in avgs.values() if a is not None]
    left = sorted(
        a for c, a in avgs.items() if a is not None and any(y.counted and y.open for y in by[c])
    )
    return (
        round(left[1], 2) if len(left) > 1 else None,
        round(statistics.median(values), 2) if values else None,
    )


def _avg(value: float | None) -> str:
    """Videos per year as the changelog shows it: two decimals, blank if not recorded."""
    return "" if value is None else f"{value:.2f}"


def recorded_when(day: str, recorded: Any, logged: bool = False) -> list[str]:
    """The note for a day whose `ch_ready` and `ch_out` (and `ch_yr_2nd`, `ch_yr_med`) aren't
    from 23:59:59; `ch_out` isn't named when it's from the log (`logged`), which has it there."""
    if recorded is None:
        return []
    names = ["ch_ready", *([] if logged else ["ch_out"])]
    names += ["ch_yr_2nd", "ch_yr_med"] if recorded["ch_yr_med"] is not None else []
    counts = " and ".join(names) if len(names) < 3 else ", ".join(names[:-1]) + " and " + names[-1]
    if recorded["at"] is None:
        return ["ch_ready and ch_out at the day's last export (time not kept)"]
    end = calendar.timegm(time.strptime(day, "%Y-%m-%d")) + DAY_S
    if recorded["at"] == end:
        return []
    at = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(recorded["at"]))
    return [f"{counts} as of {at} UTC"]


def _write_tsv(path: Path, columns: tuple[str, ...], rows: list[dict[str, object]]) -> None:
    tmp = path.with_suffix(".tsv.tmp")
    with tmp.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, columns, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {k: str(v).replace("\t", " ").replace("\n", " ") for k, v in row.items()}
            )
    os.replace(tmp, path)


def _replace(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


# --- provenance and the block probe --------------------------------------------------------


def provenance() -> dict[str, str]:
    """What measured the videos, recorded with each one."""

    def run(cmd: list[str]) -> str:
        try:
            return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            return ""

    extract = (PIPELINE_DIR / "04_extract_features_v2.py").read_text(encoding="utf-8")
    cache = re.search(r"^CACHE_VERSION = (\d+)", extract, re.M)
    commit = run(["git", "-C", str(PIPELINE_DIR), "rev-parse", "--short", "HEAD"])
    dirty = run(["git", "-C", str(PIPELINE_DIR), "status", "--porcelain", "--", "."])
    return {
        "ytdlp_version": run([sys.executable, "-m", "yt_dlp", "--version"]),
        "ffmpeg_version": (run(["ffmpeg", "-version"]).split() + ["", "", ""])[2],
        "pipeline_commit": commit + ("+changes" if dirty else ""),
        "cache_version": cache.group(1) if cache else "",
    }


def probe_block(video_id: str) -> bool:
    """Ask yt-dlp once, with its full error text, whether YouTube is blocking us. (The
    download script keeps only the error's last 180 characters, which cut the reason off.)"""
    cmd = [sys.executable, "-m", "yt_dlp", "--simulate", "--no-warnings"]
    cmd += ["--remote-components", "ejs:github", f"https://www.youtube.com/watch?v={video_id}"]
    path = f"{Path(sys.executable).parent}{os.pathsep}{os.environ.get('PATH', '')}"
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120, env={**os.environ, "PATH": path}
        )
    except subprocess.TimeoutExpired:
        return False
    return "not a bot" in proc.stderr
