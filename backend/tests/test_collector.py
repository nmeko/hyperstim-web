"""The collector (plan 013): which uploads it takes, in what order, and what it writes."""

import csv
import json
import os
import random
import urllib.parse
from collections import Counter
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from hyperstim_api.collector import notes, sampling
from hyperstim_api.collector.collector import (
    DAY_S,
    QUERIES,
    Collector,
    Settings,
    changelog,
    channel_averages,
    export,
    left_out_rows,
    load_classifier,
    recount,
    scorer,
    utc,
)
from hyperstim_api.collector.sampling import Details
from hyperstim_api.collector.seed import seed
from hyperstim_api.collector.store import Store
from hyperstim_api.collector.youtube import ApiError, DataApi, OutOfUnits
from hyperstim_api.dataset import collected_files, load_dataset
from hyperstim_api.scoring import FEATURES
from hyperstim_api.thumbnails import OFFLINE_HINTS
from tests.conftest import FakePipeline, video_row, write_dataset

NOW = 1_793_000_000.0  # 2026-10-26
CHANNEL = "UC" + "a" * 22


# --- the store -----------------------------------------------------------------------------


def test_a_transaction_commits_only_a_finished_block(tmp_path: Path) -> None:
    store = Store(tmp_path / "collector.db")
    with store.transaction():
        store.set("a", 1)
    with pytest.raises(RuntimeError), store.transaction():
        store.set("b", 1)
        raise RuntimeError
    abandoned = store.transaction()
    abandoned.__enter__()
    store.set("c", 1)
    abandoned.gen.close()  # left without __exit__, e.g. dropped mid-block
    assert (store.get("a"), store.get("b"), store.get("c")) == ("1", "", "")
    store.close()


# --- the sampling rule ---------------------------------------------------------------------


RANK_DQW = 0.7570944611853032  # rank("dQw4w9WgXcQ") under rule v1


def test_rank_is_fixed_and_in_range() -> None:
    assert sampling.rank("dQw4w9WgXcQ") == sampling.rank("dQw4w9WgXcQ")
    # The same numbers under rule v2 as under v1: the rule's version isn't part of them.
    assert sampling.rank("dQw4w9WgXcQ") == RANK_DQW
    ranks = [sampling.rank(f"video{i:06d}") for i in range(2000)]
    assert all(0 <= r < 1 for r in ranks)
    assert 0.45 < sum(ranks) / len(ranks) < 0.55  # spread evenly
    assert len(set(ranks)) == len(ranks)


@pytest.mark.parametrize(
    ("iso", "seconds"),
    [("PT1H2M3S", 3723), ("PT45S", 45), ("PT10M", 600), ("P1DT1S", 86401), ("P0D", 0),
     ("", None), (None, None), ("1:00", None)],
)  # fmt: skip
def test_duration(iso: str | None, seconds: int | None) -> None:
    assert sampling.duration_s(iso) == seconds


def details(**changes: Any) -> Details:
    base: dict[str, Any] = {
        "made_for_kids": True,
        "duration_s": 600,
        "live": False,
        "region_blocked": False,
        "title": "A song",
        "description": "",
        "tags": "",
        "channel_title": "Channel",
    }
    return Details(**{**base, **changes})


@pytest.mark.parametrize(
    ("found", "short", "expected"),
    [
        (details(), None, "eligible"),
        (None, None, "gone"),
        (details(live=True), None, "wait"),
        (details(region_blocked=True), None, "region"),
        (details(made_for_kids=False), None, "not_for_kids"),
        (details(made_for_kids=None), None, "not_for_kids"),
        (details(duration_s=60), None, "duration"),
        (details(duration_s=119), None, "duration"),
        (details(duration_s=3601), None, "duration"),
        (details(duration_s=None), None, "duration"),
        (details(duration_s=150), False, "eligible"),
        (details(duration_s=150), True, "short"),
        (details(duration_s=150), None, "short"),  # undecided counts as a Short, as in v2
        (details(duration_s=181), None, "eligible"),
    ],
)
def test_verdict(found: Details | None, short: bool | None, expected: str) -> None:
    assert sampling.verdict(found, short) == expected


def test_region_blocked() -> None:
    assert sampling.region_blocked({"regionRestriction": {"blocked": ["US", "CA"]}})
    assert sampling.region_blocked({"regionRestriction": {"allowed": ["DE"]}})
    assert not sampling.region_blocked({"regionRestriction": {"allowed": ["US"]}})
    assert not sampling.region_blocked({})


# --- a fake YouTube ------------------------------------------------------------------------


class FakeYouTube:
    """The Data API's answers, from dicts; counts calls by method."""

    def __init__(self) -> None:
        self.uploads: dict[str, list[tuple[str, str]]] = {}  # channel -> newest first
        self.videos: dict[str, dict[str, Any]] = {}  # video ID -> item
        self.search: dict[str, list[str]] = {}
        self.channels: dict[str, tuple[str, int, int]] = {}  # ID -> title, subscribers, videos
        self.calls: list[str] = []
        self.quota_exceeded = False
        # (method, params) -> True: that call fails with HTTP 500
        self.fails: Callable[[str, dict[str, str]], bool] = lambda method, params: False

    def video(self, video_id: str, **changes: Any) -> None:
        item: dict[str, Any] = {
            "id": video_id,
            "snippet": {"title": f"Song {video_id}", "description": "", "tags": ["song"],
                        "channelTitle": "Channel", "liveBroadcastContent": "none"},
            "contentDetails": {"duration": "PT10M"},
            "status": {"madeForKids": True},
        }  # fmt: skip
        for key, value in changes.items():
            part, field = key.split("__")
            item[part][field] = value
        self.videos[video_id] = item

    def get(self, url: str) -> dict[str, Any]:
        method, _, query = url.removeprefix("https://www.googleapis.com/youtube/v3/").partition("?")
        params = dict(urllib.parse.parse_qsl(query))
        self.calls.append(method)
        if self.quota_exceeded:
            raise ApiError("HTTP 403: quotaExceeded", quota_exceeded=True)
        if self.fails(method, params):
            raise ApiError("HTTP 500: backendError")
        if method == "playlistItems":
            channel = "UC" + params["playlistId"][2:]
            if channel not in self.uploads:
                raise ApiError("HTTP 404: playlistNotFound")
            rows = self.uploads[channel]
            start = int(params.get("pageToken", "0"))
            page = rows[start : start + 50]
            body: dict[str, Any] = {
                "items": [
                    {"contentDetails": {"videoId": v, "videoPublishedAt": p}} for v, p in page
                ]
            }
            if start + 50 < len(rows):
                body["nextPageToken"] = str(start + 50)
            return body
        if method == "videos":
            return {"items": [self.videos[v] for v in params["id"].split(",") if v in self.videos]}
        if method == "search":
            return {"items": [{"id": {"channelId": c}} for c in self.search.get(params["q"], [])]}
        if method == "channels":
            items = []
            for c in params["id"].split(","):
                if c in self.channels:
                    title, subs, videos = self.channels[c]
                    items.append({"id": c, "snippet": {"title": title},
                                  "statistics": {"subscriberCount": str(subs),
                                                 "videoCount": str(videos)}})  # fmt: skip
            return {"items": items}
        raise AssertionError(method)


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> float:
        return self.now


class EvenSpacing(random.Random):
    """Spaces downloads by the average gap, not a random one, so a test's ticks always line up
    with the pace (a random gap longer than a tick made tests fail now and then)."""

    def expovariate(self, lambd: float = 1.0) -> float:
        return 1 / lambd


def make_store(path: Path) -> Store:
    store = Store(path / "collector.db")
    store.upsert_channel(id=CHANNEL, title="Channel", status="in", source="v2", listed_at=NOW)
    store.set("seeded", "yes")
    return store


def make_collector(
    tmp_path: Path,
    youtube: FakeYouTube,
    pipeline: FakePipeline,
    clock: Clock,
    budget: int = 7000,
    blocked: Callable[[str], bool] = lambda video_id: False,
    shorts: dict[str, bool | None] | None = None,
    at_floor: bool = True,
) -> Collector:
    store = make_store(tmp_path)
    if at_floor:  # the channel has 5 v2 picks, from 2016: its uploads are from other years
        fill_floor(store, CHANNEL)

    def spend(units: int) -> None:
        if store.units_used("day") + units > budget:
            raise OutOfUnits("budget")
        store.add_units("day", units)

    settings = Settings(
        data_dir=tmp_path / "data",
        clips_dir=tmp_path / "clips",
        analysis_dir=tmp_path / "analyses",
        per_day=150,
        provenance={"ytdlp_version": "test"},
    )
    collector = Collector(
        settings,
        store,
        DataApi(youtube.get, spend),
        pipeline,
        lambda video_id: (shorts or {}).get(video_id, False),
        load_classifier(),
        blocked,
        clock=clock,
        rng=EvenSpacing(),
    )
    collector.low_on_space = lambda: False  # type: ignore[method-assign]
    return collector


def fill_floor(store: Store, channel_id: str, n: int = 5, year: int = 2016) -> list[str]:
    """Gives the channel `n` v2 picks from `year` (not due for the offline check)."""
    picks = [f"v2{channel_id[-6:]}{year % 100:02d}{i:03d}" for i in range(n)]
    store.add_uploads(channel_id, [(v, f"{year}-01-01T00:00:00Z") for v in picks])
    for video_id in picks:
        store.set_state(video_id, "v2", title="Old", channel_title="Channel", online_at=1e12)
    return picks


def uploads(n: int, published: str = "2024-05-01T00:00:00Z") -> list[tuple[str, str]]:
    return [(f"vid{i:08d}", published) for i in range(n)]


@pytest.fixture
def youtube() -> FakeYouTube:
    yt = FakeYouTube()
    yt.uploads[CHANNEL] = uploads(30)
    for video_id, _ in yt.uploads[CHANNEL]:
        yt.video(video_id)
    return yt


def by_rank(rows: list[tuple[str, str]]) -> list[str]:
    return sorted((v for v, _ in rows), key=sampling.rank)


def collected_ids(collector: Collector) -> list[str]:
    return [r["video_id"] for r in collector.store.collected_rows()]


def run(collector: Collector, clock: Clock, ticks: int, step: float = DAY_S) -> None:
    for _ in range(ticks):
        collector.tick()
        clock.now += step


# --- collecting ----------------------------------------------------------------------------


def test_takes_eligible_uploads_lowest_number_first(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    order = by_rank(youtube.uploads[CHANNEL])
    youtube.video(order[1], status__madeForKids=False)  # the second-lowest isn't for kids
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    run(collector, clock, 3, step=3600)
    assert collected_ids(collector) == [order[0], order[2], order[3]]
    assert collector.store.upload(order[1]).state == "ineligible"  # type: ignore[union-attr]


def test_picking_only_adds(tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    seen: list[list[str]] = []
    for _ in range(5):
        run(collector, clock, 1, step=3600)
        seen.append(collected_ids(collector))
    for before, after in zip(seen, seen[1:], strict=False):
        assert after[: len(before)] == before


def test_a_new_upload_comes_in_a_day_after_it_goes_up(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    run(collector, clock, 10, step=3600)
    # Listed by the daily check, then checked and taken first once it's a day old: its year,
    # the running one, has no video yet, so it's the thinnest.
    fresh = "new00000001"
    youtube.uploads[CHANNEL].insert(0, (fresh, sampling_time(clock.now - 3600)))
    youtube.video(fresh)
    collector.store.update_channel(CHANNEL, listed_at=0)
    run(collector, clock, 1, step=3600)
    assert collector.store.known(fresh)
    assert fresh not in collected_ids(collector)  # not a day old yet
    clock.now += DAY_S
    run(collector, clock, 1, step=3600)
    assert collected_ids(collector)[-1] == fresh


def sampling_time(t: float) -> str:
    from hyperstim_api.collector.collector import utc

    return utc(t)


def test_uploads_before_2015_and_v2_picks_are_never_taken(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    old = uploads(5, published="2014-12-31T00:00:00Z")
    old = [(f"old{v[3:]}", p) for v, p in old]
    collector.store.add_uploads(CHANNEL, old + youtube.uploads[CHANNEL])
    pick = by_rank(youtube.uploads[CHANNEL])[0]
    collector.store.set_state(pick, "v2")
    run(collector, clock, 40, step=3600)
    taken = collected_ids(collector)
    assert pick not in taken
    assert not [v for v in taken if v.startswith("old")]
    assert len(taken) == 29


def test_premieres_wait_a_day(tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline) -> None:
    clock = Clock()
    first = by_rank(youtube.uploads[CHANNEL])[0]
    youtube.video(first, snippet__liveBroadcastContent="upcoming")
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    run(collector, clock, 1, step=60)
    assert collector.store.upload(first).state == "new"  # type: ignore[union-attr]
    youtube.video(first)
    clock.now += DAY_S
    run(collector, clock, 30, step=3600)
    assert first in collected_ids(collector)


def test_shorts_are_left_out(tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline) -> None:
    clock = Clock()
    first, second = by_rank(youtube.uploads[CHANNEL])[:2]
    youtube.video(first, contentDetails__duration="PT2M30S")
    youtube.video(second, contentDetails__duration="PT2M30S")
    collector = make_collector(tmp_path, youtube, pipeline, clock, shorts={first: True})
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    run(collector, clock, 1, step=3600)
    reason = collector.store.db.execute("SELECT reason FROM uploads WHERE id = ?", (first,))
    assert reason.fetchone()[0] == "short"
    assert collector.store.upload(second).state == "collected"  # type: ignore[union-attr]


def test_pace_spreads_downloads_over_the_day(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    youtube.uploads[CHANNEL] = uploads(400)
    for video_id, _ in youtube.uploads[CHANNEL]:
        youtube.video(video_id)
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.s.per_day = 24
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    run(collector, clock, 24 * 12, step=300)  # one day, a tick every 5 minutes
    assert 10 <= len(collected_ids(collector)) <= 24  # on average 24, never more


def failing(pipeline: FakePipeline, video_id: str) -> None:
    """Every download of the video fails, leaving a log like the download script's."""
    pipeline.fail[video_id] = ("download", "unavailable")

    def write_log(step: str, vid: str, workdir: Path | None) -> None:
        if step == "download" and workdir is not None and vid == video_id:
            (workdir / "clips").mkdir(exist_ok=True)
            (workdir / "clips" / f"{vid}.mweb.log").write_text("ERROR: empty stream")

    pipeline.during = write_log


def test_a_failed_download_is_tried_again_after_1_3_and_7_days_then_given_up(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    first = by_rank(youtube.uploads[CHANNEL])[0]
    failing(pipeline, first)
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])

    def tries() -> int:
        return collector.store.failures(first)

    def upload_state() -> str:
        return collector.store.upload(first).state  # type: ignore[union-attr]

    collector.tick()
    assert (tries(), upload_state()) == (1, "eligible")
    failed_at = NOW
    for wait, count in ((DAY_S, 2), (3 * DAY_S, 3), (7 * DAY_S, 4)):
        clock.now = failed_at + wait - 1200  # not yet: other videos go on meanwhile
        collector.store.set("next_download_at", 0)
        collector.tick()
        assert tries() == count - 1
        clock.now = failed_at + wait
        collector.store.set("next_download_at", 0)
        collector.tick()
        assert tries() == count
        failed_at = clock.now
    assert upload_state() == "failed"  # the 4th failure gives up
    assert len(collected_ids(collector)) == 3
    clock.now += 30 * DAY_S
    run(collector, clock, 5, step=3600)
    assert tries() == 4


def test_retries_come_one_per_slot_and_count_towards_the_pace(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    collector.tick()  # checks the uploads; downloads the lowest
    waiting = by_rank(youtube.uploads[CHANNEL])[1:6]
    for video_id in waiting:  # five failed a day ago, all due now
        collector.store.log_attempt(video_id, NOW - DAY_S, "failed")
        collector.store.set_state(video_id, "eligible", retry_at=NOW, title="T", channel_title="C")
    gap = DAY_S / 150
    for i in range(5):
        clock.now += gap
        collector.tick()
        collector.tick()  # a second tick in the same slot downloads nothing
        assert collected_ids(collector)[1:] == waiting[: i + 1]
    collector.s.per_day = 6  # today's 6 slots are used: the 1st download and the 5 retries
    clock.now += gap
    collector.tick()
    assert len(collected_ids(collector)) == 6


def test_three_failures_in_a_row_pause_downloads_for_an_hour(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    order = by_rank(youtube.uploads[CHANNEL])
    for video_id in order[:4]:
        pipeline.fail[video_id] = ("download", "unavailable")
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    gap = DAY_S / 150
    for _ in range(3):
        collector.tick()
        clock.now += gap
    assert float(collector.store.get("paused_until")) == NOW + 2 * gap + 3600
    collector.tick()
    assert collector.store.attempts_since(0) == 3  # paused
    clock.now = NOW + 2 * gap + 3600
    collector.tick()
    assert collector.store.failures(order[3]) == 1  # the 4th, after the pause
    clock.now += gap
    collector.tick()
    assert collected_ids(collector) == [order[4]]  # the pace is unchanged
    assert collector.per_day(clock.now) == 150
    assert collector.store.get("failures_in_a_row") == "0"


def test_the_downloaders_output_is_kept_for_30_days(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    first = by_rank(youtube.uploads[CHANNEL])[0]
    failing(pipeline, first)
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    logs = tmp_path / "data" / "download-logs"
    collector.tick()
    kept = logs / "2026-10-26" / f"{first}.log"
    assert "ERROR: empty stream" in kept.read_text()
    clock.now += 30 * DAY_S
    collector.tick()
    assert kept.exists()  # 30 days: still kept
    clock.now += DAY_S
    collector.tick()
    assert not kept.parent.exists()
    assert (logs / "2026-11-25" / f"{first}.log").exists()  # the retry's, kept


def test_downloads_failed_before_retries_are_tried_again(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    store.add_uploads(CHANNEL, [("once0000001", "2024-01-01"), ("four0000001", "2024-01-01")])
    for video_id, failures in (("once0000001", 1), ("four0000001", 4)):
        store.set_state(video_id, "failed")
        for i in range(failures):
            store.log_attempt(video_id, NOW + i, "failed")
    store.log_attempt("once0000001", NOW, "blocked")
    assert store.requeue_failed(4) == 1
    assert store.upload("once0000001").state == "eligible"  # type: ignore[union-attr]
    assert store.upload("four0000001").state == "failed"  # type: ignore[union-attr]
    assert store.requeue_failed(4) == 0


def test_a_block_pauses_downloads_and_backs_off(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    first = by_rank(youtube.uploads[CHANNEL])[0]
    pipeline.fail[first] = ("download", "unavailable")
    collector = make_collector(tmp_path, youtube, pipeline, clock, blocked=lambda v: True)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    collector.tick()
    assert collector.store.upload(first).state == "eligible"  # type: ignore[union-attr]
    assert float(collector.store.get("blocked_until")) == NOW + 6 * 3600
    clock.now += 3600
    collector.tick()
    assert collector.store.attempts_since(0) == 1  # still waiting
    clock.now = NOW + 6 * 3600 + 1
    collector.tick()  # blocked again right away: twice the wait, half the pace
    assert float(collector.store.get("blocked_until")) == clock.now + 12 * 3600
    assert collector.per_day(clock.now) == 75
    del pipeline.fail[first]
    clock.now += 12 * 3600 + 1
    collector.tick()
    assert collected_ids(collector) == [first]
    assert collector.store.get("block_wait") == "0"
    assert collector.per_day(clock.now + 2 * DAY_S) == 75
    assert collector.per_day(clock.now + 3 * DAY_S) == 150  # back after 3 days without a block


def test_a_live_check_goes_first_and_its_result_is_reused(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    first = by_rank(youtube.uploads[CHANNEL])[0]
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    analyses = tmp_path / "analyses"
    analyses.mkdir()
    (analyses / "other000000.json").write_text(json.dumps({"status": "download"}))
    collector.tick()
    assert collected_ids(collector) == []
    features = dict.fromkeys(FEATURES, 1.25)
    (analyses / "other000000.json").write_text(json.dumps({"status": "done"}))
    (analyses / f"{first}.json").write_text(json.dumps({"status": "done", "features": features}))
    collector.tick()
    assert collected_ids(collector) == [first]
    assert pipeline.workdirs == []  # nothing downloaded
    row = collector.store.collected_rows()[0]
    assert json.loads(row["features"]) == features
    assert json.loads(row["provenance"])["measured_by"] == "live analysis"


def test_a_block_seen_by_a_live_check_pauses_downloads(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    (tmp_path / "analyses").mkdir()
    (tmp_path / "analyses" / "youtube-blocked").write_text(f"{NOW - 60}\n")
    collector.tick()
    assert collected_ids(collector) == []
    clock.now += 6 * 3600
    collector.tick()
    assert len(collected_ids(collector)) == 1


def test_clips_and_feature_caches_are_kept(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    first = by_rank(youtube.uploads[CHANNEL])[0]

    def write(step: str, video_id: str, workdir: Path | None) -> None:
        assert workdir is not None
        if step == "download":
            (workdir / "clips").mkdir()
            (workdir / "clips" / f"{video_id}.mp4").write_text("clip")
        if step == "measure":
            (workdir / "cache").mkdir()
            (workdir / "cache" / f"{video_id}.npz").write_text("cache")

    pipeline.during = write
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    collector.tick()
    assert (tmp_path / "clips" / "clips" / f"{first}.mp4").read_text() == "clip"
    assert (tmp_path / "clips" / "cache" / f"{first}.npz").read_text() == "cache"
    assert not (tmp_path / "clips" / "work" / first).exists()


def test_backs_up_its_database_once_a_day_and_keeps_a_week(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock, at_floor=False)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    backups = tmp_path / "clips" / "backups"
    collector.tick()
    collector.tick()  # the same day: no second copy
    assert [p.name for p in backups.iterdir()] == ["collector-2026-10-26.db"]
    copy = Store(backups / "collector-2026-10-26.db")
    assert copy.get("seeded") == "yes"
    assert copy.db.execute("SELECT COUNT(*) FROM uploads").fetchone()[0] == 30
    copy.close()
    run(collector, clock, ticks=9)
    names = sorted(p.name for p in backups.iterdir())
    assert len(names) == 7
    assert names[0] == "collector-2026-10-28.db"  # 9 days, the newest 7 kept
    assert names[-1] == "collector-2026-11-03.db"


def test_categories_come_from_v2s_keywords(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    first, second = by_rank(youtube.uploads[CHANNEL])[:2]
    youtube.video(first, snippet__title="Minecraft lets play", snippet__tags=[])
    youtube.video(second, snippet__title="Hello", snippet__tags=[])
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    run(collector, clock, 2, step=3600)
    rows = {r["video_id"]: r["category"] for r in collector.store.collected_rows()}
    assert rows == {first: "gaming", second: None}


# --- channel first, and the per-year filter (plan 013, decisions 1 and 2) -----------------

SMALL = "UC" + "b" * 22


def small_channel(
    collector: Collector, youtube: FakeYouTube, n: int, picks: int = 1, prefix: str = "sml"
) -> list[str]:
    """A second channel with `picks` v2 picks and `n` eligible uploads; returns them by number."""
    store = collector.store
    store.upsert_channel(id=SMALL, title="Small", status="in", source="v2", listed_at=NOW)
    fill_floor(store, SMALL, picks)
    rows = [(f"{prefix}{i:08d}", "2024-05-01T00:00:00Z") for i in range(n)]
    youtube.uploads[SMALL] = rows
    for video_id, _ in rows:
        youtube.video(video_id)
    store.add_uploads(SMALL, rows)
    return by_rank(rows)


def eligible_in(youtube: FakeYouTube, channel_id: str, year: int, n: int) -> list[str]:
    """`n` eligible uploads of the channel from `year`, listed on YouTube; returns their IDs."""
    rows = [(f"y{year}{channel_id[-3:]}{i:04d}", f"{year}-05-01T00:00:00Z") for i in range(n)]
    youtube.uploads.setdefault(channel_id, []).extend(rows)
    for video_id, _ in rows:
        youtube.video(video_id)
    return [v for v, _ in rows]


def year_of(store: Store, video_id: str) -> str:
    return store.upload(video_id).published_at[:4]  # type: ignore[union-attr]


def span(
    store: Store, channel_id: str, first: str = "2023-01-01", last: str = "2026-10-25"
) -> None:
    """The channel's first and last uploads (gone, so they count for nothing else): its years
    from `first` to `last` are active in full, the running year up to today."""
    for video_id, published in ((f"fst{channel_id[-6:]}", first), (f"lst{channel_id[-6:]}", last)):
        store.add_uploads(channel_id, [(video_id, f"{published}T00:00:00Z")])
        store.set_state(video_id, "ineligible", "gone")


def judged(store: Store, channel_id: str, n: int = 20, year: int = 2023) -> None:
    """`n` uploads of the channel found eligible but given up: answers enough for the filters
    to judge it (and in again, at `n` a year), none of them to download."""
    ids = [f"jdg{channel_id[-4:]}{i:04d}" for i in range(n)]
    store.add_uploads(channel_id, [(v, f"{year}-05-01T00:00:00Z") for v in ids])
    for video_id in ids:
        store.set_state(video_id, "failed")


def a_year(channel_id: str, year: int, videos: int, open_: bool = True, part: float = 1.0,
           eligible: int | None = None, low_r: float | None = None) -> sampling.Year:  # fmt: skip
    return sampling.Year(
        channel_id=channel_id, year=year, videos=videos, site=videos,
        eligible=videos + open_ if eligible is None else eligible, waiting=int(open_),
        ready=int(open_), unchecked=0, part=part, low_r=low_r,
    )  # fmt: skip


def test_the_part_of_a_year_a_channel_was_active() -> None:
    today = date(2026, 10, 26)
    full = sampling.active_part(2023, date(2020, 1, 1), date(2026, 10, 20), today)
    started = sampling.active_part(2024, date(2024, 7, 1), date(2026, 10, 20), today)
    running = sampling.active_part(2026, date(2020, 1, 1), date(2026, 10, 20), today)
    stopped = sampling.active_part(2022, date(2020, 1, 1), date(2022, 3, 31), today)
    assert full == 1.0
    assert started == 184 / 366  # from its first upload
    assert running == 299 / 365  # to today
    assert stopped == 90 / 365  # to its last upload


def test_a_channels_average_counts_only_years_with_an_eligible_upload() -> None:
    years = [
        a_year(CHANNEL, 2022, 4, open_=False),
        a_year(CHANNEL, 2023, 0, open_=False, eligible=0),  # every upload checked ineligible
        a_year(CHANNEL, 2024, 2, part=0.5),
    ]
    assert sampling.average(years) == 6 / 1.5


def test_the_channel_with_the_fewest_videos_a_year_goes_first_in_its_thinnest_year() -> None:
    order = sampling.pick_order(
        [a_year(CHANNEL, 2023, 6), a_year(CHANNEL, 2024, 2),
         a_year(SMALL, 2023, 3), a_year(SMALL, 2024, 1), a_year(SMALL, 2025, 2, part=0.25)],
        {},
    )  # fmt: skip
    assert [c for c, _ in order] == [SMALL, CHANNEL]  # 6 / 2.25 a year, then 8 / 2
    # SMALL's years below its threshold, CHANNEL's 4 a year: 2024 (1), then 2023 (3); 2025 is
    # 8 a year.
    assert [(y.year, y.rate) for y in order[0][1]] == [(2024, 1.0), (2023, 3.0)]
    assert [y.year for y in order[1][1]] == [2024]


def test_a_channel_with_nothing_left_below_its_average_waits_until_the_others_pass_it() -> None:
    small = [a_year(SMALL, 2022, 9, open_=False), a_year(SMALL, 2023, 1, open_=False),
             a_year(SMALL, 2024, 6)]  # fmt: skip
    # SMALL averages 5.3: its years under it have nothing left, so it's skipped while
    # CHANNEL, at 5.5, still has a thin year to fill.
    channel = [a_year(CHANNEL, 2023, 8), a_year(CHANNEL, 2024, 3)]
    assert [c for c, _ in sampling.pick_order(small + channel, {})] == [CHANNEL]
    # Once CHANNEL is past 6 a year (no year under its average left), SMALL comes back for its
    # 2024, under the new threshold.
    channel = [a_year(CHANNEL, 2023, 8), a_year(CHANNEL, 2024, 7)]
    order = sampling.pick_order(small + channel, {})
    assert [c for c, _ in order][0] == SMALL and [y.year for y in order[0][1]] == [2024]


def test_on_a_tie_a_channels_year_farthest_from_its_videos_goes_first() -> None:
    # Videos in 2015-2020 only; 2021-2026 tie at 0. Before, the earliest tied year went first.
    years = [a_year(CHANNEL, y, 1, open_=False) for y in range(2015, 2021)]
    years += [a_year(CHANNEL, y, 0, low_r=0.5) for y in range(2021, 2027)]
    years += [a_year(SMALL, 2024, 9)]  # a higher channel, so CHANNEL's 0s are below threshold
    order = sampling.pick_order(years, {})
    assert [y.year for y in order[0][1]][:2] == [2026, 2025]  # 6 years from 2020, then 5
    # With 2026 filled, 2023 is farthest from both 2020 and 2026.
    years = [y for y in years if y.year != 2026 or y.channel_id != CHANNEL]
    years.append(a_year(CHANNEL, 2026, 1, open_=False))
    assert sampling.pick_order(years, {})[0][1][0].year == 2023


def test_on_a_tie_at_the_same_distance_the_year_with_the_lowest_number_goes_first() -> None:
    years = [a_year(CHANNEL, 2020, 1, open_=False), a_year(CHANNEL, 2023, 1, open_=False),
             a_year(CHANNEL, 2021, 0, low_r=0.31), a_year(CHANNEL, 2022, 0, low_r=0.07),
             a_year(CHANNEL, 2024, 0, low_r=0.52), a_year(SMALL, 2024, 9)]  # fmt: skip
    assert [y.year for y in sampling.pick_order(years, {})[0][1]] == [2022, 2021, 2024]


def test_a_years_lowest_number_counts_only_eligible_uploads_ready_now(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    ids = [f"low{i:04d}" for i in range(4)]
    store.add_uploads(CHANNEL, [(v, "2024-05-01T00:00:00Z") for v in ids])
    ready, later, _, _ = sorted(ids, key=sampling.rank)[::-1]  # the two highest numbers
    store.set_state(ready, "eligible")
    store.set_state(later, "eligible", retry_at=NOW + 3600)  # waiting for a retry
    (row,) = [r for r in store.year_rows(NOW, "", "2026-10-26") if r["y"] == 2024]
    assert row["low_r"] == sampling.rank(ready)  # not the unchecked ones' lower numbers


def test_on_a_tie_the_higher_scored_channel_goes_first() -> None:
    years = [a_year(CHANNEL, 2024, 1), a_year(SMALL, 2024, 1),
             a_year(CHANNEL, 2023, 3), a_year(SMALL, 2023, 3)]  # fmt: skip
    assert [c for c, _ in sampling.pick_order(years, {CHANNEL: 10.0, SMALL: 50.0})] == [
        SMALL, CHANNEL,
    ]  # fmt: skip


def test_eligible_uploads_per_year_are_estimated_from_the_checked_ones() -> None:
    assert sampling.eligible_per_year(v2=5, found=6, answers=19, unchecked=100, part=2) is None
    # 5 of v2's, 6 found of 20 answers (30 %), and 30 % of the 100 not checked, over 2 years.
    assert sampling.eligible_per_year(v2=5, found=6, answers=20, unchecked=100, part=2) == 20.5


def test_downloads_follow_the_channel_first_rule(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    youtube.uploads[CHANNEL] = []
    collector = make_collector(tmp_path, youtube, pipeline, clock, at_floor=False)
    store = collector.store
    store.upsert_channel(id=SMALL, title="Small", status="in", source="v2", listed_at=NOW)
    for channel_id, picks in ((CHANNEL, 5), (SMALL, 1)):
        span(store, channel_id)
        fill_floor(store, channel_id, picks, year=2023)
        fresh = eligible_in(youtube, channel_id, 2024, 8)
        store.add_uploads(channel_id, [(v, "2024-05-01T00:00:00Z") for v in fresh])
        judged(store, channel_id, year=2025)
    run(collector, clock, 8, step=3600)
    # Over 2023-2025, SMALL has 1/3 a year on average and CHANNEL 5/3. Each takes its 2024
    # while it's under its threshold (its own average or the other's, whichever is higher),
    # the lower average first; once neither is under its threshold (both at 3), the open years
    # take turns, the fewest videos first, SMALL on the tie.
    channels = [channel_of(store, v) for v in collected_ids(collector)]
    assert channels == [SMALL, SMALL, CHANNEL, CHANNEL, SMALL, CHANNEL, SMALL, CHANNEL]
    assert {year_of(store, v) for v in collected_ids(collector)} == {"2024"}


def test_a_download_doesnt_wait_for_a_retry(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    youtube.uploads[CHANNEL] = []
    collector = make_collector(tmp_path, youtube, pipeline, clock, at_floor=False)
    store = collector.store
    store.upsert_channel(id=SMALL, title="Small", status="in", source="v2", listed_at=NOW)
    for channel_id, picks in ((CHANNEL, 3), (SMALL, 4)):
        span(store, channel_id)
        fill_floor(store, channel_id, picks, year=2024 if channel_id == CHANNEL else 2023)
    (only,) = eligible_in(youtube, CHANNEL, 2023, 1)  # CHANNEL's 2023: next in line
    store.add_uploads(CHANNEL, [(only, "2023-05-01T00:00:00Z")])
    failing(pipeline, only)
    waiting(store, SMALL, level_ids("rdy", 3))  # SMALL's 2024
    run(collector, clock, 3, step=3600)
    assert store.failures(only) == 1  # its only video waits a day for its retry,
    assert [channel_of(store, v) for v in collected_ids(collector)] == [SMALL, SMALL]  # SMALL goes


def test_the_shorts_probe_is_asked_only_when_its_all_thats_left(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    class Asked(dict[str, bool | None]):
        def __init__(self) -> None:
            super().__init__(unused=False)  # not empty, so it's used
            self.asked: list[str] = []

        def get(self, key: str, default: Any = None) -> Any:
            self.asked.append(key)
            return False

    clock = Clock()
    first, second = by_rank(youtube.uploads[CHANNEL])[:2]
    youtube.video(first, contentDetails__duration="PT2M30S", status__madeForKids=False)
    youtube.video(second, contentDetails__duration="PT2M30S")
    asked = Asked()
    collector = make_collector(tmp_path, youtube, pipeline, clock, shorts=asked)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    collector.tick()
    assert asked.asked == [second]


def test_status_shows_how_far_the_channels_are_filled(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    from hyperstim_api.collector.__main__ import level_line

    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)  # 2016: 5 videos
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])  # 2024: none yet
    small_channel(collector, youtube, 0)  # 2016: 1 video, nothing left
    for channel_id in (CHANNEL, SMALL):
        span(collector.store, channel_id)
    # CHANNEL: 5 over 2016 and 2024, 2.5 a year; SMALL: 1 a year, with nothing left to take.
    assert level_line(collector.store, clock.now) == (
        "Channels' videos per year: median 1.75, second smallest None; the rule can fill 1 "
        "channels now, skips 1"
    )


# --- fewest videos first, and the kids share (plan 013, decisions 1 and 2) ------------------

TINY = "UC" + "c" * 22


def waiting(store: Store, channel_id: str, ids: list[str], pick: str = "sample") -> None:
    """Uploads of the channel checked eligible before, waiting to be downloaded."""
    store.add_uploads(channel_id, [(v, "2024-05-01T00:00:00Z") for v in ids])
    for video_id in ids:
        store.set_state(video_id, "eligible", title="T", channel_title="C")
        store.db.execute("UPDATE uploads SET pick = ? WHERE id = ?", (pick, video_id))


def answered(store: Store, channel_id: str, kids: int, not_for_kids: int, prefix: str) -> None:
    """`kids` uploads checked and found too long (made for kids) and `not_for_kids` not made
    for kids: the channel's made-for-kids answers, none of them waiting to be downloaded."""
    ids = [f"{prefix}{i:07d}" for i in range(kids + not_for_kids)]
    store.add_uploads(channel_id, [(v, "2024-05-01T00:00:00Z") for v in ids])
    for i, video_id in enumerate(ids):
        store.set_state(video_id, "ineligible", "duration" if i < kids else "not_for_kids")


def level_ids(prefix: str, n: int) -> list[str]:
    return sorted((f"{prefix}{i:07d}" for i in range(n)), key=sampling.rank)


def scored(store: Store, channel_id: str, scores: list[float]) -> None:
    """Gives the channel v2 picks with these scores."""
    picks = fill_floor(store, channel_id, len(scores))
    store.set_scores(zip(picks, scores, strict=True))


def score_of(store: Store, video_id: str) -> float | None:
    row = store.db.execute("SELECT score FROM uploads WHERE id = ?", (video_id,)).fetchone()
    return None if row[0] is None else float(row[0])


def channel_of(store: Store, video_id: str) -> str:
    return store.upload(video_id).channel_id  # type: ignore[union-attr]


def eligible_waiting(store: Store, channel_id: str, ids: list[str], year: int) -> None:
    """Uploads of the channel from `year`, checked eligible, waiting to be downloaded."""
    store.add_uploads(channel_id, [(v, f"{year}-05-01T00:00:00Z") for v in ids])
    for video_id in ids:
        store.set_state(video_id, "eligible", title="T", channel_title="C")


def new_channel(store: Store, channel_id: str) -> None:
    """A channel discovery added, judged in by the filters (its 2023 counted, nothing left)."""
    store.upsert_channel(id=channel_id, title="C", status="in", source="discovery",
                         listed_at=NOW)  # fmt: skip
    judged(store, channel_id)


def explore_flags(store: Store) -> list[int]:
    return [r[0] for r in store.db.execute("SELECT explore FROM attempts ORDER BY id")]


def test_a_third_of_the_days_downloads_go_to_exploring() -> None:
    def explored(downloads: int) -> int:
        n = 0
        for i in range(downloads):
            n += sampling.explore_turn(n, i)
        return n

    assert [sampling.explore_turn(n, i) for i, n in enumerate([0, 1, 1, 1, 2, 2])] == [
        True, False, False, True, False, False,
    ]  # fmt: skip
    assert explored(150) == 50
    assert explored(75) == 25  # at half pace after a block too


def test_a_new_channel_catches_up_its_empty_years_first_then_to_the_lowest_channel_in() -> None:
    others = [a_year(CHANNEL, 2023, 2), a_year(CHANNEL, 2024, 2)]  # 2 a year, can take more
    full = [a_year(SMALL, 2023, 9, open_=False)]  # nothing left: doesn't set the level
    new = [a_year(TINY, 2023, 1), a_year(TINY, 2024, 0), a_year(TINY, 2025, 0)]
    order, done = sampling.catch_up_order(others + full + new, {TINY}, {})
    assert done == []
    ((channel_id, years),) = order
    assert channel_id == TINY
    assert [y.year for y in years][2:] == [2023]  # its years with no video first
    assert {y.year for y in years[:2]} == {2024, 2025}
    caught = [a_year(TINY, 2023, 2), a_year(TINY, 2024, 2), a_year(TINY, 2025, 2)]
    assert sampling.catch_up_order(others + caught, {TINY}, {}) == ([], [TINY])


def test_a_new_channel_gets_at_least_5_videos_and_one_every_other_year() -> None:
    others = [a_year(CHANNEL, 2023, 1), a_year(CHANNEL, 2024, 0)]  # 0.5 a year: a low level

    def needs(new: list[sampling.Year]) -> list[int]:
        order, _ = sampling.catch_up_order(others + new, {TINY}, {})
        return [y.year for _, ys in order for y in ys]

    # A short history: 3 videos over 2 years is above the level, but under 5 in all.
    assert needs([a_year(TINY, 2025, 1), a_year(TINY, 2026, 2)]) == [2025, 2026]
    # 5 over 12 years is under one every other year: its open years, empty ones first.
    long = [a_year(TINY, y, int(y < 2020)) for y in range(2015, 2027)]
    assert needs(long)[:7] == [2026, 2025, 2024, 2023, 2022, 2021, 2020]  # spread: the farthest
    assert needs(long)[7:] == [2015, 2016, 2017, 2018, 2019]
    long[-1] = a_year(TINY, 2026, 1)  # 6 over 12: caught up, empty years and all
    assert sampling.catch_up_order(others + long, {TINY}, {}) == ([], [TINY])
    # Nothing left to take: caught up with what it has.
    closed = [a_year(TINY, 2023, 1, open_=False), a_year(TINY, 2024, 0, open_=False)]
    assert sampling.catch_up_order(others + closed, {TINY}, {}) == ([], [TINY])


def test_exploring_downloads_take_a_third_and_the_new_channel_catches_up_from_them(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    clock.now = NOW - NOW % DAY_S + 3600  # 01:00 UTC
    youtube.uploads[CHANNEL] = []
    collector = make_collector(tmp_path, youtube, pipeline, clock)  # CHANNEL: 2016's 5
    store = collector.store
    eligible_waiting(store, CHANNEL, level_ids("exp", 6), 2024)
    new_channel(store, TINY)
    eligible_waiting(store, TINY, level_ids("tny", 2), 2024)
    eligible_waiting(store, TINY, level_ids("tnz", 2), 2025)
    run(collector, clock, 6, step=3600)
    channels = [channel_of(store, v) for v in collected_ids(collector)]
    assert channels == [TINY, CHANNEL, CHANNEL, TINY, CHANNEL, CHANNEL]
    assert explore_flags(store) == [1, 0, 0, 1, 0, 0]
    assert store.downloads_today(clock.now) == (2, 6)
    assert {year_of(store, v) for v in collected_ids(collector) if channel_of(store, v) == TINY} \
        == {"2024", "2025"}  # its empty year first  # fmt: skip
    assert store.catching_up() == {TINY}  # still under CHANNEL's 2.5 a year


def test_no_first_video_while_a_channel_is_catching_up_and_exploring_left_goes_to_expanding(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    clock.now = NOW - NOW % DAY_S + 3600
    youtube.uploads[CHANNEL] = []
    collector = make_collector(tmp_path, youtube, pipeline, clock)  # CHANNEL: nothing to take
    store = collector.store
    second = "UC" + "9" * 22
    for channel_id in (TINY, second):
        new_channel(store, channel_id)
    numbers = level_ids("cat", 4)
    eligible_waiting(store, TINY, numbers[:1], 2024)  # the lowest number: TINY first
    eligible_waiting(store, TINY, numbers[2:3], 2025)
    eligible_waiting(store, second, numbers[1:2], 2024)  # lower than TINY's 2025
    run(collector, clock, 3, step=3600)
    # With no channel in that can take a video, every download explores: TINY's first video,
    # its empty 2025 before the second channel's first, then it's caught up.
    assert [channel_of(store, v) for v in collected_ids(collector)] == [TINY, TINY, second]
    assert TINY not in store.catching_up()
    # Once exploring has nothing ready, the download goes to expanding.
    eligible_waiting(store, CHANNEL, numbers[3:], 2024)
    run(collector, clock, 1, step=3600)
    assert channel_of(store, collected_ids(collector)[-1]) == CHANNEL
    assert explore_flags(store) == [1, 1, 1, 0]


def test_at_most_3_channels_get_their_first_video_a_day(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    clock.now = NOW - NOW % DAY_S + 3600  # 01:00 UTC
    youtube.uploads[CHANNEL] = []
    collector = make_collector(tmp_path, youtube, pipeline, clock)  # CHANNEL: nothing to take
    store = collector.store
    numbers = level_ids("fst", 5)
    new = [f"UC{i:022d}" for i in range(5)]
    for channel_id, video_id in zip(new, numbers, strict=True):
        new_channel(store, channel_id)
        eligible_waiting(store, channel_id, [video_id], 2024)  # caught up with it
    failing(pipeline, numbers[0])  # a failed first download doesn't use up a slot
    run(collector, clock, 6, step=3600)
    assert collected_ids(collector) == numbers[1:4]
    assert store.first_videos_today(clock.now) == 3
    assert store.ready(clock.now) == 0  # the 5th new channel's video waits for tomorrow
    assert explore_flags(store) == [1, 1, 1, 1]  # the failed one was exploring too
    # The next day: the failed one is tried again once it's due, then the 5th.
    clock.now += DAY_S - 6 * 3600
    run(collector, clock, 6, step=3600)
    assert collected_ids(collector)[3] == numbers[4]
    assert store.failures(numbers[0]) == 2
    assert store.first_videos_today(clock.now) == 1


def subscribed(store: Store, channel_id: str, subscribers: int, title: str = "C") -> None:
    store.update_channel(channel_id, subscriber_count=subscribers, title=title)


def test_the_waiting_channel_with_the_most_subscribers_gets_the_first_video(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    clock.now = NOW - NOW % DAY_S + 3600  # 01:00 UTC
    youtube.uploads[CHANNEL] = []
    collector = make_collector(tmp_path, youtube, pipeline, clock)  # CHANNEL: nothing to take
    store = collector.store
    small, big, tied, unjudged, out = (f"UC{i:018d}{i}abc" for i in range(1, 6))
    numbers = level_ids("sub", 6)
    for channel_id, video_id, subscribers in (
        (small, numbers[0], 20_000),  # the lowest number, but the fewest subscribers
        (big, numbers[2], 5_000_000),
        (tied, numbers[1], 5_000_000),  # as many as `big`, with a lower number
    ):
        new_channel(store, channel_id)
        subscribed(store, channel_id, subscribers)
        eligible_waiting(store, channel_id, [video_id], 2024)
    # Not judged by the filters yet (no answers), or left out (1 of 21 made for kids): passed
    # over however big.
    for channel_id, video_id, subscribers in ((unjudged, numbers[4], 80_000_000),
                                              (out, numbers[3], 90_000_000)):  # fmt: skip
        store.upsert_channel(id=channel_id, title="C", status="in", source="discovery",
                             listed_at=NOW, subscriber_count=subscribers)  # fmt: skip
        eligible_waiting(store, channel_id, [video_id], 2024)
    answered(store, out, 0, 20, "out")
    collector.export()  # judges the channels: `out` is left out
    assert store.left_out_ids() == {out}
    assert store.first_video(clock.now).id == numbers[1]  # type: ignore[union-attr]
    assert [r["id"] for r in store.waiting_channels()] == [unjudged, big, tied, small]
    run(collector, clock, 4, step=3600)
    assert [channel_of(store, v) for v in collected_ids(collector)] == [tied, big, small]
    assert store.first_videos_today(clock.now) == 3  # still at most 3 a day


def test_checks_reach_the_new_channel_with_the_most_subscribers_first(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    youtube.uploads[CHANNEL] = []
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    store = collector.store
    small, big = "UC" + "1" * 22, "UC" + "z" * 22  # `small` first by ID
    for channel_id, subscribers in ((small, 20_000), (big, 3_000_000)):
        store.upsert_channel(id=channel_id, title="C", status="in", source="discovery",
                             listed_at=NOW, subscriber_count=subscribers)  # fmt: skip
        store.add_uploads(channel_id, [(f"{channel_id[-1]}chk{i:06d}", "2024-05-01T00:00:00Z")
                                       for i in range(25)])  # fmt: skip
    seen: list[str] = []
    collector.check = lambda ids, now: seen.extend(ids)  # type: ignore[method-assign]
    collector.check_candidates(clock.now)
    assert len(seen) == 40
    assert {channel_of(store, v) for v in seen[:20]} == {big}
    assert {channel_of(store, v) for v in seen[20:]} == {small}


def test_the_waiting_channels_subscribers_are_read_again_weekly(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)  # CHANNEL: on the site
    store = collector.store
    week_ago, yesterday = utc(clock.now - 8 * DAY_S), utc(clock.now - DAY_S)
    due, fresh, out, gone = (f"UC{i:018d}{i}xyz" for i in range(1, 5))
    for channel_id, checked in ((due, week_ago), (fresh, yesterday), (out, week_ago),
                                (gone, week_ago)):  # fmt: skip
        store.upsert_channel(id=channel_id, title="C", status="in", source="discovery",
                             subscriber_count=50_000, video_count=200,
                             checked_at=checked)  # fmt: skip
        youtube.channels[channel_id] = ("C", 9_000_000, 300)
    del youtube.channels[gone]
    store.update_channel(CHANNEL, subscriber_count=1_000, checked_at=week_ago)
    youtube.channels[CHANNEL] = ("Channel", 7_000_000, 300)
    store.db.execute("INSERT INTO left_out (channel_id, kids, answers) VALUES (?, 0, 20)", (out,))
    youtube.calls.clear()
    collector.refresh_waiting(clock.now)
    assert youtube.calls == ["channels"]  # one unit for up to 50 channels

    def counts(channel_id: str) -> tuple[int | None, int | None, str]:
        row = store.db.execute(
            "SELECT subscriber_count, video_count, checked_at FROM channels WHERE id = ?",
            (channel_id,),
        ).fetchone()
        return row[0], row[1], row[2]

    assert counts(due) == (9_000_000, 300, utc(clock.now))
    assert counts(out) == (9_000_000, 300, utc(clock.now))  # left out, but may come back
    assert counts(fresh) == (50_000, 200, yesterday)  # read in the past week
    assert counts(gone) == (50_000, 200, utc(clock.now))  # not found: keeps its counts
    assert counts(CHANNEL)[:2] == (1_000, None)  # has a video: not waiting
    assert [r["id"] for r in store.waiting_channels()] == [due, fresh, gone]  # reordered
    youtube.calls.clear()
    collector.refresh_waiting(clock.now + DAY_S)
    assert youtube.calls == []  # nothing due again for a week


def test_the_dataset_channels_names_are_read_again_weekly(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline, caplog: pytest.LogCaptureFixture
) -> None:
    """A channel renamed on YouTube gets its new name in the export (plan 013, decision 9)."""
    caplog.set_level("INFO")
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)  # CHANNEL: on the site
    store = collector.store
    week_ago, yesterday = utc(clock.now - 8 * DAY_S), utc(clock.now - DAY_S)
    renamed, fresh, gone, blank, out, waiting = (f"UC{i:018d}{i}nam" for i in range(1, 7))
    for i, channel_id in enumerate((renamed, fresh, gone, blank, out, waiting)):
        store.upsert_channel(id=channel_id, title=f"Old {i}", status="in", source="discovery",
                             named_at=yesterday if channel_id == fresh else week_ago)  # fmt: skip
        youtube.channels[channel_id] = (f"New {i}", 50_000, 300)
        if channel_id != waiting:
            store.add_uploads(channel_id, [(f"vid{i:08d}", "2020-01-01")])
            store.set_state(f"vid{i:08d}", "v2", online_at=clock.now)
    del youtube.channels[gone]
    youtube.channels[blank] = ("  ", 50_000, 300)
    youtube.channels[CHANNEL] = ("Channel", 50_000, 300)  # unchanged
    store.db.execute("INSERT INTO left_out (channel_id, kids, answers) VALUES (?, 0, 20)", (out,))
    youtube.calls.clear()
    collector.refresh_names(clock.now)
    assert youtube.calls == ["channels"]  # one unit for up to 50 channels

    def name(channel_id: str) -> tuple[str, str]:
        row = store.db.execute(
            "SELECT title, named_at FROM channels WHERE id = ?", (channel_id,)
        ).fetchone()
        return row[0], row[1]

    now = utc(clock.now)
    assert name(renamed) == ("New 0", now)
    assert name(out) == ("New 4", now)  # left out: its page may come back
    assert name(fresh) == ("Old 1", yesterday)  # read in the past week
    assert name(gone) == ("Old 2", now)  # not found: keeps its name
    assert name(blank) == ("Old 3", now)  # no title: keeps its name
    assert name(waiting) == ("Old 5", week_ago)  # no video in the dataset
    assert name(CHANNEL)[1] == now
    assert f"Renamed {renamed}: Old 0 -> New 0" in caplog.text
    assert "Renamed " + CHANNEL not in caplog.text
    assert store.get("export_due") == "1"
    collector.tick()  # the export it asked for
    names = (tmp_path / "data" / "collected" / "channel-names.tsv").read_text()
    assert f"{renamed}\tNew 0\n" in names and f"{fresh}\tOld 1\n" in names
    assert f"{CHANNEL}\tChannel\n" in names  # every dataset channel with a name
    assert waiting not in names
    youtube.calls.clear()
    collector.refresh_names(clock.now + DAY_S)
    assert youtube.calls == []  # nothing due again for a week
    collector.refresh_names(clock.now + 7 * DAY_S)
    assert youtube.calls == ["channels"]  # the week after


def test_the_names_are_read_50_channels_a_call(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    store = collector.store
    for i in range(60):
        channel_id = f"UC{i:020d}n"
        store.upsert_channel(id=channel_id, title="C", status="in", source="discovery")
        store.add_uploads(channel_id, [(f"many{i:07d}", "2020-01-01")])
        store.set_state(f"many{i:07d}", "v2", online_at=clock.now)
    youtube.calls.clear()
    collector.refresh_names(clock.now)
    collector.refresh_names(clock.now)
    collector.refresh_names(clock.now)
    assert youtube.calls == ["channels", "channels"]  # 61 channels: two units, then none due


def test_status_names_the_channels_next_in_line_for_a_first_video(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    from hyperstim_api.collector.__main__ import waiting_line

    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)  # CHANNEL: on the site
    store = collector.store
    assert waiting_line(store) == "Waiting for a first video: 0 channels"
    for i, subscribers in enumerate((20_000, 45_000_000, 300_000, 1_000, 2_000, 3_000)):
        channel_id = f"UC{i:020d}w"
        store.upsert_channel(id=channel_id, title=f"Ch{i}", status="in", source="discovery",
                             subscriber_count=subscribers)  # fmt: skip
    assert waiting_line(store) == (
        "Waiting for a first video: 6 channels; next: Ch1 (45,000,000), Ch2 (300,000), "
        "Ch0 (20,000), Ch5 (3,000), Ch4 (2,000)"
    )


def test_status_shows_the_days_exploring_and_the_channels_catching_up(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    from hyperstim_api.collector.__main__ import first_videos_line

    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)  # CHANNEL: 2016's 5
    store = collector.store
    assert first_videos_line(store, clock.now) == (
        "Exploring today: 0 of 0 downloads (share 1/3); 0 channels catching up; "
        "first videos today: 0 of 3 channels"
    )
    new_channel(store, TINY)
    fill_floor(store, TINY, 1, year=2024)
    eligible_waiting(store, TINY, ["tny0000001"], 2025)  # an empty year with a video waiting
    store.set_catching_up(TINY, True)
    store.log_attempt("tny0000001", clock.now, "failed")
    assert first_videos_line(store, clock.now) == (
        "Exploring today: 1 of 1 downloads (share 1/3); 1 channels catching up; "
        "first videos today: 0 of 3 channels"
    )


def test_the_dataset_videos_scores_are_filled_in_once(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock, at_floor=False)
    store = collector.store
    (v2,) = fill_floor(store, CHANNEL, 1)
    store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    run(collector, clock, 1, step=3600)  # added without a score, as before the change
    (added,) = collected_ids(collector)
    assert score_of(store, added) is None
    collector.score = lambda features: 42.0
    collector.fill_scores({v2: 70.0})
    assert score_of(store, v2) == 70.0
    assert score_of(store, added) == 42.0
    collector.fill_scores({v2: 10.0})  # a score never changes
    assert score_of(store, v2) == 70.0


def test_added_videos_are_scored_as_the_site_scores_them(tmp_path: Path) -> None:
    rows = [video_row(f"ref{i:08d}", CHANNEL, float(i)) for i in range(10)]
    reference = load_dataset(write_dataset(tmp_path / "videos.tsv", rows))
    score = scorer(reference)
    for video in reference.videos:
        features = {f.key: f.value for f in video.features}
        assert score(features) == video.score
    assert score(dict.fromkeys(FEATURES)) is None


@pytest.mark.parametrize(
    ("kids", "answers", "out"),
    [(1, 20, True), (2, 21, True), (2, 20, False), (3, 30, False), (0, 19, False)],
)
def test_a_channel_under_10_percent_made_for_kids_is_left_out(
    kids: int, answers: int, out: bool
) -> None:
    assert sampling.left_out(kids, answers) is out


def test_a_left_out_channel_gets_no_downloads_and_comes_back(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    youtube.uploads[CHANNEL] = []
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    store = collector.store
    small = small_channel(collector, youtube, 10, picks=15)  # unchecked
    # 2 of 22 answers made for kids (9 %); v2's 15 picks don't count, or it'd be 17 of 37.
    answered(store, SMALL, 1, 20, "nfk")
    waiting(store, SMALL, ["wait0000001"])
    collector.tick()
    assert [r["channel_id"] for r in store.db.execute("SELECT * FROM left_out")] == [SMALL]
    rows = list(csv.DictReader((tmp_path / "data" / "collected" / "excluded-channels.tsv").open(),
                               delimiter="\t"))  # fmt: skip
    # The numbers behind it, and its 15 v2 picks the site doesn't show. Its eligible uploads per
    # year are enough: only its kids share leaves it out.
    assert rows == [{"channel_id": SMALL, "channel_title": "Small", "checked": "22",
                     "for_kids": "2", "kids_pct": "9.1", "per_year": "12.3",
                     "reason": "kids_share", "since": "2026-10-26", "videos": "15"}]  # fmt: skip
    run(collector, clock, 5, step=3600)
    assert collected_ids(collector) == []  # nothing downloaded
    # Its uploads are still checked, also with one waiting, as their answers decide whether it
    # comes back: a few a day, 3 from this year today.
    picks = Counter(store.upload(v).pick for v in small)  # type: ignore[union-attr]
    assert picks == {"level": 3, "sample": 7}
    # Those checks found 3 more made for kids: 5 of 25 (20 %). Judged again within a day, it's
    # back, and its waiting uploads are downloaded.
    assert store.db.execute("SELECT COUNT(*) FROM left_out").fetchone()[0] == 1
    clock.now += DAY_S
    run(collector, clock, 2, step=3600)
    assert store.db.execute("SELECT COUNT(*) FROM left_out").fetchone()[0] == 0
    assert collected_ids(collector)
    assert {store.upload(v).channel_id for v in collected_ids(collector)} == {SMALL}  # type: ignore[union-attr]


def test_a_channel_under_5_eligible_a_year_is_left_out_and_comes_back(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    store.upsert_channel(id=SMALL, title="Small", status="in", source="v2", listed_at=NOW)
    span(store, SMALL)  # 2023, 2024 and 2026 so far: 2.82 active years
    fill_floor(store, SMALL, 2, year=2023)
    answered(store, SMALL, 19, 0, "kid")  # made for kids, but none eligible (too long)
    assert store.update_left_out("2026-10-26", NOW) == []  # 19 answers: not judged yet
    answered(store, SMALL, 20, 0, "kid")
    (row,) = store.update_left_out("2026-10-26", NOW)
    assert (row["channel_id"], row["reason"], round(row["per_year"], 2)) == (
        SMALL,
        "per_year",
        0.71,
    )
    judged(store, SMALL, 20)  # 20 more found eligible: (2 + 20) / 2.82 years
    assert store.update_left_out("2026-10-26", NOW) == []


def log_of(store: Store) -> list[tuple[str, float, str, str | None]]:
    return [tuple(r) for r in store.db.execute("SELECT * FROM left_out_log ORDER BY rowid")]


def test_the_log_keeps_who_left_came_back_or_changed_reason_and_since_when(
    tmp_path: Path,
) -> None:
    store = make_store(tmp_path)
    store.upsert_channel(id=TINY, title="C", status="in", source="v2", listed_at=NOW)
    answered(store, TINY, 0, 20, "nfa")  # none made for kids, none eligible: both
    # Left out before the log began: its first judging logs it as of then.
    store.db.execute("INSERT INTO left_out (channel_id, kids, answers) VALUES (?, 0, 20)", (TINY,))
    store.update_left_out("2026-10-26", NOW)
    assert log_of(store) == [(TINY, NOW, "out", "both")]
    store.update_left_out("2026-10-26", NOW + 60)  # nothing changed: nothing logged
    assert len(log_of(store)) == 1
    # SMALL leaves (under 5 eligible a year) ...
    store.upsert_channel(id=SMALL, title="Small", status="in", source="v2", listed_at=NOW)
    span(store, SMALL)
    fill_floor(store, SMALL, 2, year=2023)
    answered(store, SMALL, 20, 0, "kid")
    store.update_left_out("2026-10-26", NOW + 120)
    assert log_of(store)[1:] == [(SMALL, NOW + 120, "out", "per_year")]
    # ... and comes back the next day; TINY's kids share passes 10 %, so only its reason changes.
    judged(store, SMALL, 20)
    answered(store, TINY, 5, 0, "kdb")
    store.update_left_out("2026-10-27", NOW + DAY_S)
    assert log_of(store)[2:] == [
        (TINY, NOW + DAY_S, "out", "per_year"),
        (SMALL, NOW + DAY_S, "in", None),
    ]
    # Left out since its first `out`, not since its reason changed.
    assert [(r["channel_id"], r["reason"], r["since"]) for r in store.left_out_list()] == [
        (TINY, "per_year", NOW)
    ]
    assert [r["since"] for r in left_out_rows(store)] == ["2026-10-26"]


def test_ch_out_is_counted_from_the_log_from_its_first_day(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    added(store, CHANNEL, "add00000001", NOW - DAY_S)
    store.record_daily("2026-10-25", 0, 7, MIDNIGHT - DAY_S)  # before the log: as recorded
    store.record_daily("2026-10-26", 0, 99, MIDNIGHT)
    store.record_daily("2026-10-27", 0, 99, MIDNIGHT + DAY_S)
    store.upsert_channel(id=TINY, title="C", status="in", source="v2", listed_at=NOW)
    answered(store, TINY, 0, 20, "nfa")
    store.update_left_out("2026-10-26", NOW)  # the log begins: TINY out
    store.upsert_channel(id=SMALL, title="Small", status="in", source="v2", listed_at=NOW)
    answered(store, SMALL, 0, 20, "nfb")
    store.update_left_out("2026-10-27", MIDNIGHT + 60)  # SMALL out the next day
    judged(store, SMALL, 20)  # back in, judged just after the next day's end
    store.update_left_out("2026-10-28", MIDNIGHT + DAY_S + 60)
    assert [r["channel_id"] for r in store.left_out_list()] == [TINY]
    store.record_daily("2026-10-28", 0, 99, MIDNIGHT + 2 * DAY_S)
    rows = {r["date"]: r["ch_out"] for r in changelog(store, MIDNIGHT + 2 * DAY_S + 60)}
    assert rows == {"2026-10-25": 7, "2026-10-26": 1, "2026-10-27": 2, "2026-10-28": 1}


def test_a_new_channel_is_judged_before_its_first_video(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    youtube.uploads[CHANNEL] = []
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    store = collector.store
    new = "UC" + "n" * 22
    store.upsert_channel(id=new, title="New", status="in", source="discovery", listed_at=NOW)
    rows = [(f"new{i:08d}", "2024-05-01T00:00:00Z") for i in range(40)]
    for video_id, _ in rows:
        youtube.video(video_id)
    store.add_uploads(new, rows)
    store.add_uploads(new, [("few00000001", "2023-05-01T00:00:00Z")])
    collector.check_candidates(clock.now)
    # Its 20 lowest numbers over all its years, so the filters can judge it.
    checked = [v for v, _ in rows if store.upload(v).state != "new"]  # type: ignore[union-attr]
    assert sorted(checked, key=sampling.rank) == by_rank(rows)[:20]
    collector.tick()
    assert collected_ids(collector) == by_rank(rows)[:1]  # judged in: its first video


def test_status_shows_the_channels_left_out(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    from hyperstim_api.collector.__main__ import left_out_line

    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    small_channel(collector, youtube, 0, picks=2)
    answered(collector.store, SMALL, 0, 25, "nfk")
    collector.store.update_left_out("2026-10-26", NOW)
    assert left_out_line(collector.store) == (
        "Left out (20+ answers): 1 channels, 2 of their videos; under 10 % made for kids 0, "
        "under 5 eligible a year 0, both 1"
    )


# --- the export the API reads --------------------------------------------------------------


def test_export_is_read_by_the_api(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock, at_floor=False)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    span(collector.store, CHANNEL)
    run(collector, clock, 3, step=3600)
    folder = tmp_path / "data" / "collected"
    with (folder / "2026.tsv").open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh, delimiter="\t"))
    assert [r["video_id"] for r in rows] == collected_ids(collector)
    assert rows[0]["ytdlp_version"] == "test"
    assert {(r["pick"], r["rule_version"], r["cutoff"]) for r in rows} == {("level", "v2", "")}
    reference = write_dataset(tmp_path / "videos.tsv", [video_row("ref00000001", CHANNEL, 5.0)])
    dataset = load_dataset(reference, folder)
    assert len(dataset.videos) == 4
    assert all(dataset.videos_by_id[r["video_id"]].added_at == r["added_at"] for r in rows)
    # The changelog the release notes read: one line a finished day, with the totals. The day
    # still running has none; the next day's first tick closes it.
    assert (folder / "CHANGELOG.tsv").read_text().count("\n") == 1
    clock.now = NOW - NOW % DAY_S + DAY_S + 1
    collector.tick()
    with (folder / "CHANGELOG.tsv").open(newline="", encoding="utf-8") as fh:
        log = list(csv.DictReader(fh, delimiter="\t"))
    assert log[-1:] == [
        {"date": "2026-10-26", "videos": "3", "channels": "1", "ch_1": "0", "ch_2": "0",
         "ch_3": "1", "ch_4": "0", "ch_5plus": "0", "ch_ready": "0", "ch_out": "0",
         "ch_yr_2nd": "", "ch_yr_med": "3.00", "added_v": "3", "removed_v": "0", "new_ch": "1",
         "note": "Collecting starts: 150 videos a day, lowest r first; "
                 "Counts end at 23:59:59 UTC; ch_ready, ch_out recounted from backups; "
                 "Thinnest channels first; under 5 eligible a year left out; 3 new a day; "
                 "A third of downloads for new channels to catch up; at most 3 new a day; "
                 "New channels join by subscribers, most first; their counts read weekly; "
                 "Pace lowered from 150 to 120 videos a day after three blocks"}
    ]  # fmt: skip
    assert "CHANGELOG.tsv" not in [p.name for p in collected_files(folder)]


def test_videos_picked_under_rule_v1_keep_their_provenance(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    for video_id, pick in (("old00000001", "floor"), ("old00000002", "sample")):
        added(store, CHANNEL, video_id, NOW)
        store.db.execute("UPDATE uploads SET pick = ? WHERE id = ?", (pick, video_id))
        store.db.execute("UPDATE collected SET cutoff = 0.25 WHERE video_id = ?", (video_id,))
    folder = tmp_path / "collected"
    export(store, folder, NOW + 60)
    with (folder / "2026.tsv").open(newline="", encoding="utf-8") as fh:
        rows = {r["video_id"]: r for r in csv.DictReader(fh, delimiter="\t")}
    assert {(r["pick"], r["rule_version"], r["cutoff"]) for r in rows.values()} == {
        ("floor", "v1", "0.250000000"), ("sample", "v1", "0.250000000")
    }  # fmt: skip


def added(store: Store, channel_id: str, video_id: str, at: float) -> None:
    """A video of the channel, checked a day before and added at `at`."""
    store.add_uploads(channel_id, [(video_id, "2024-05-01T00:00:00Z")])
    store.set_state(video_id, "collected", checked_at=at - DAY_S)
    store.log_attempt(video_id, at, "collected")
    store.add_collected(video_id, utc(at), None, {}, 0.0, {})


def changelog_rows(store: Store, now: float) -> list[dict[str, object]]:
    return [{k: v for k, v in row.items() if k != "note"} for row in changelog(store, now)]


def test_the_changelog_counts_the_channels_by_their_videos_newest_day_first(
    tmp_path: Path,
) -> None:
    store = make_store(tmp_path)
    fill_floor(store, CHANNEL)  # 5 videos
    for channel_id in (SMALL, TINY):
        store.upsert_channel(id=channel_id, title="C", status="in", source="v2", listed_at=NOW)
    fill_floor(store, SMALL, 1)
    fill_floor(store, TINY, 2)
    store.db.execute(
        "INSERT INTO left_out (channel_id, kids, answers) VALUES (?, 0, 30)", (TINY,)
    )  # counted nowhere
    added(store, SMALL, "add00000001", NOW)  # its 2nd video
    store.set_state("add00000001", "removed")  # taken out the next day
    store.add_removed("add00000001", utc(NOW + DAY_S), "gone")
    rows = changelog_rows(store, NOW + 2 * DAY_S)
    assert rows == [
        {"date": "2026-10-27", "videos": 6, "channels": 2, "ch_1": 1, "ch_2": 0, "ch_3": 0,
         "ch_4": 0, "ch_5plus": 1, "ch_ready": "", "ch_out": "",
         "ch_yr_2nd": "", "ch_yr_med": "", "added_v": 0,
         "removed_v": 1, "new_ch": 0},
        {"date": "2026-10-26", "videos": 7, "channels": 2, "ch_1": 0, "ch_2": 1, "ch_3": 0,
         "ch_4": 0, "ch_5plus": 1, "ch_ready": "", "ch_out": "",
         "ch_yr_2nd": "", "ch_yr_med": "", "added_v": 1,
         "removed_v": 0, "new_ch": 0},
    ]  # fmt: skip
    for row in rows:
        assert sum(int(str(row[f"ch_{k}"])) for k in (1, 2, 3, 4, "5plus")) == row["channels"]


MIDNIGHT = NOW - NOW % DAY_S + DAY_S  # 2026-10-27 00:00:00 UTC, the end of 2026-10-26


def test_only_finished_days_are_listed_each_to_23_59_59(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    added(store, CHANNEL, "add00000001", MIDNIGHT - 1)  # 23:59:59
    added(store, CHANNEL, "add00000002", MIDNIGHT)  # 00:00:00, the next day
    assert [r["date"] for r in changelog(store, MIDNIGHT + 3600)] == ["2026-10-26"]
    rows = {r["date"]: r["added_v"] for r in changelog(store, MIDNIGHT + DAY_S)}
    assert rows == {"2026-10-27": 1, "2026-10-26": 1}


def closing(tmp_path: Path, ended: float, closed: str = "2026-10-25") -> Collector:
    """A collector whose last tick started 100 s before midnight and ended at `ended`."""
    clock = Clock()
    clock.now = MIDNIGHT + 1
    collector = make_collector(tmp_path, FakeYouTube(), FakePipeline(), clock)
    collector.store.set("closed_day", closed)
    collector.store.set("tick_at", MIDNIGHT - 100)
    collector.store.set("tick_end", ended)
    return collector


def recorded(store: Store) -> dict[str, tuple[int, int | None, float | None]]:
    return {d: (r["ch_ready"], r["ch_out"], r["at"]) for d, r in store.daily().items()}


def notes_by_day(store: Store, now: float) -> dict[str, str]:
    return {str(r["date"]): str(r["note"]) for r in changelog(store, now)}


def test_the_first_tick_of_a_day_closes_the_day_before_at_23_59_59(tmp_path: Path) -> None:
    collector = closing(tmp_path, ended=MIDNIGHT - 90)
    store = collector.store
    waiting(store, SMALL, ["wait0000001"])
    store.upsert_channel(id=TINY, title="C", status="in", source="v2", listed_at=NOW)
    answered(store, TINY, 0, 20, "nfk")  # left out
    collector.close_day(MIDNIGHT + 1)
    assert recorded(store) == {"2026-10-26": (1, 1, MIDNIGHT)}
    # Later the same day: another channel waits and TINY comes back; the closed day keeps its
    # counts, with no note, since they're from 23:59:59.
    waiting(store, CHANNEL, ["wait0000002"])
    answered(store, TINY, 20, 0, "kid")
    collector.close_day(MIDNIGHT + 3600)
    collector.export()
    assert recorded(store) == {"2026-10-26": (1, 1, MIDNIGHT)}
    assert "as of" not in notes_by_day(store, MIDNIGHT + DAY_S)["2026-10-26"]


def test_a_tick_that_ran_past_midnight_closes_the_day_as_of_then(tmp_path: Path) -> None:
    collector = closing(tmp_path, ended=MIDNIGHT + 30)  # a download finished after midnight
    collector.close_day(MIDNIGHT + 31)
    assert recorded(collector.store) == {"2026-10-26": (0, 0, MIDNIGHT + 31)}
    note = notes_by_day(collector.store, MIDNIGHT + DAY_S)["2026-10-26"]
    assert note.endswith("ch_ready, ch_out, ch_yr_2nd and ch_yr_med as of 2026-10-27 00:00:31 UTC")


def test_days_the_collector_was_down_are_closed_as_they_ended(tmp_path: Path) -> None:
    # Stopped after a finished tick on 2026-10-25: nothing changed until it started again.
    collector = closing(tmp_path, ended=MIDNIGHT - DAY_S - 3600, closed="2026-10-24")
    collector.store.set("tick_at", MIDNIGHT - DAY_S - 3610)
    collector.close_day(MIDNIGHT + 5 * 3600)
    assert recorded(collector.store) == {
        "2026-10-25": (0, 0, MIDNIGHT - DAY_S), "2026-10-26": (0, 0, MIDNIGHT)
    }  # fmt: skip


def test_after_a_crash_only_the_day_before_is_closed_as_of_then(tmp_path: Path) -> None:
    # Its last tick never finished, so what changed then and when is unknown.
    collector = closing(tmp_path, ended=MIDNIGHT - DAY_S - 3600, closed="2026-10-24")
    collector.store.set("tick_at", MIDNIGHT - DAY_S - 60)
    collector.close_day(MIDNIGHT + 5 * 3600)
    assert recorded(collector.store) == {"2026-10-26": (0, 0, MIDNIGHT + 5 * 3600)}


def test_the_first_run_with_closing_leaves_the_day_before_as_recorded(tmp_path: Path) -> None:
    collector = closing(tmp_path, ended=MIDNIGHT - 90, closed="")
    collector.store.db.execute(
        "INSERT INTO daily (day, ch_ready, ch_out) VALUES ('2026-10-26', 4, 2)"
    )
    collector.close_day(MIDNIGHT + 1)
    assert recorded(collector.store) == {"2026-10-26": (4, 2, None)}
    assert collector.store.get("closed_day") == "2026-10-26"
    note = notes_by_day(collector.store, MIDNIGHT + DAY_S)["2026-10-26"]
    assert note.endswith("ch_ready and ch_out at the day's last export (time not kept)")


def test_a_day_recorded_before_ch_out_was_keeps_its_ch_ready(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    added(store, CHANNEL, "add00000001", NOW)
    store.db.execute("INSERT INTO daily (day, ch_ready) VALUES ('2026-10-27', 4)")
    rows = {r["date"]: (r["ch_ready"], r["ch_out"]) for r in changelog(store, NOW + 2 * DAY_S)}
    assert rows == {"2026-10-26": ("", ""), "2026-10-27": (4, "")}


def test_the_channels_videos_per_year_count_the_channels_on_the_site(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    for channel_id in (SMALL, TINY, "UC" + "w" * 22, "UC" + "o" * 22):
        store.upsert_channel(id=channel_id, title="C", status="in", source="v2", listed_at=NOW)
    for channel_id in (CHANNEL, SMALL, TINY):
        span(store, channel_id)  # 2023 to 2026: whole years
    fill_floor(store, CHANNEL, 4, year=2023)
    added(store, CHANNEL, "add00000001", NOW)  # 2024
    store.add_uploads(CHANNEL, [("chk00000001", "2024-03-01T00:00:00Z")])  # one left to check
    fill_floor(store, SMALL, 2, year=2023)
    answered(store, SMALL, 0, 3, "nfk")  # 2024: none eligible, so it doesn't count
    fill_floor(store, TINY, 6, year=2023)
    store.add_uploads(TINY, [("chk00000002", "2024-03-01T00:00:00Z")])
    waiting(store, "UC" + "w" * 22, ["wait0000001"])  # not on the site: not counted
    fill_floor(store, "UC" + "o" * 22, 1)
    store.db.execute("INSERT INTO left_out (channel_id, kids, answers) VALUES (?, 0, 30)",
                     ("UC" + "o" * 22,))  # fmt: skip  # nor a left-out one
    # CHANNEL 2.5 a year (5 over 2023-2024), SMALL 2 (only 2023 counts), TINY 3 (6 over two):
    # the median 2.5; the second smallest of those with an upload left (CHANNEL, TINY) 3.
    assert channel_averages(store, "2026-10-26") == (3.0, 2.5)
    # An upload the next day makes 2026 one of SMALL's years, still open: 2 over 1.82 years.
    store.add_uploads(SMALL, [("new00000001", "2026-10-27T00:00:00Z")])
    assert channel_averages(store, "2026-10-26") == (3.0, 2.5)
    assert channel_averages(store, "2026-10-27") == (2.5, 2.5)


def test_the_channels_videos_per_year_are_recorded_at_the_close_and_kept(tmp_path: Path) -> None:
    collector = closing(tmp_path, ended=MIDNIGHT - 90)  # CHANNEL: 2016's 5
    store = collector.store
    span(store, CHANNEL, first="2016-01-01")
    store.add_uploads(CHANNEL, [("vid00000008", "2019-01-01T00:00:00Z")])  # 2019: 0, open
    collector.close_day(MIDNIGHT + 1)
    day = store.daily()["2026-10-26"]
    assert (day["ch_yr_2nd"], day["ch_yr_med"]) == (None, 2.5)  # one channel: no second
    # Uploads listed later add years, but the closed day keeps its values.
    store.add_uploads(CHANNEL, [("vid00000009", "2020-01-01T00:00:00Z")])
    collector.close_day(MIDNIGHT + 3600)
    rows = {r["date"]: (r["ch_yr_2nd"], r["ch_yr_med"]) for r in changelog(store, MIDNIGHT + DAY_S)}
    assert rows["2026-10-26"] == ("", "2.50")
    assert "as of" not in notes_by_day(store, MIDNIGHT + DAY_S)["2026-10-26"]


def test_the_channels_videos_per_year_are_blank_for_a_day_recorded_before_them(
    tmp_path: Path,
) -> None:
    store = make_store(tmp_path)
    added(store, CHANNEL, "add00000001", NOW)
    store.record_daily("2026-10-26", 0, 0, MIDNIGHT)
    rows = {r["date"]: (r["ch_yr_2nd"], r["ch_yr_med"]) for r in changelog(store, NOW + 2 * DAY_S)}
    assert rows == {"2026-10-26": ("", "")}


def test_the_collector_rests_in_the_days_last_10_minutes(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock, at_floor=False)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    clock.now = MIDNIGHT - 600
    assert collector.tick() == 601  # until just after midnight
    assert collected_ids(collector) == [] and youtube.calls == []
    assert float(collector.store.get("tick_at")) == MIDNIGHT - 600
    clock.now = MIDNIGHT - 601
    collector.tick()
    assert collected_ids(collector) != []


def test_the_day_end_copy_leaves_out_what_came_after_midnight(tmp_path: Path) -> None:
    collector = closing(tmp_path, ended=MIDNIGHT + 30)
    added(collector.store, CHANNEL, "add00000001", MIDNIGHT - 5)
    added(collector.store, CHANNEL, "add00000002", MIDNIGHT + 10)
    collector.close_day(MIDNIGHT + 31)
    folder = tmp_path / "data" / "collected"
    assert "add00000002" in (folder / "2026.tsv").read_text()
    day_end = (folder / "day-end" / "2026.tsv").read_text()
    assert "add00000001" in day_end and "add00000002" not in day_end
    changelog_end = (folder / "day-end" / "CHANGELOG.tsv").read_text().splitlines()
    assert [line.split("\t")[0] for line in changelog_end[1:]] == ["2026-10-26"]
    assert (folder / "day-end" / "excluded-channels.tsv").exists()


def test_a_failed_day_end_copy_still_closes_the_day(tmp_path: Path) -> None:
    collector = closing(tmp_path, ended=MIDNIGHT - 90)
    folder = tmp_path / "data" / "collected"
    folder.mkdir(parents=True)
    (folder / "day-end").write_text("in the way")  # the copy can't be written
    collector.close_day(MIDNIGHT + 1)
    assert recorded(collector.store) == {"2026-10-26": (0, 0, MIDNIGHT)}
    assert (folder / "CHANGELOG.tsv").read_text().count("\n") == 2  # the live files: written


def backup_at(store: Store, path: Path, tick_at: float | None) -> Path:
    if tick_at is not None:
        store.set("tick_at", tick_at)
    store.backup(path)
    return path


def test_recount_takes_the_counts_from_each_backup_with_its_time(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    span(store, CHANNEL)
    added(store, CHANNEL, "add00000001", NOW)  # the first day: 2026-10-26
    waiting(store, SMALL, ["wait0000001"])
    store.upsert_channel(id=TINY, title="C", status="in", source="v2", listed_at=NOW)
    answered(store, TINY, 0, 20, "nfk")  # left out, but not judged yet in the backup
    first = backup_at(store, tmp_path / "collector-2026-10-27.db", MIDNIGHT + 41)
    before = backup_at(store, tmp_path / "collector-2026-10-26.db", MIDNIGHT - DAY_S + 30)
    # Since then: the video came in, and the day was recorded the old way, with no time.
    store.set_state("wait0000001", "collected")
    store.db.execute("INSERT INTO daily (day, ch_ready, ch_out) VALUES ('2026-10-26', 0, 0)")
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    done = recount(store, [first, before], scratch)
    assert recorded(store) == {"2026-10-26": (1, 1, MIDNIGHT + 41)}
    assert store.left_out_list() == []  # judged in the copy only
    assert done == [
        "collector-2026-10-26.db: 2026-10-25 is before the first day, skipped",
        "collector-2026-10-27.db: 2026-10-26 ch_ready 1, ch_out 1, ch_yr_2nd -, ch_yr_med 1.00, "
        "as of 2026-10-27T00:00:41Z",
    ]
    note = notes_by_day(store, MIDNIGHT + DAY_S)["2026-10-26"]
    assert note.endswith("ch_ready, ch_out, ch_yr_2nd and ch_yr_med as of 2026-10-27 00:00:41 UTC")


def test_recount_keeps_a_closer_count_and_fills_in_only_its_blank_videos_per_year(
    tmp_path: Path,
) -> None:
    store = make_store(tmp_path)
    span(store, CHANNEL)
    added(store, CHANNEL, "add00000001", NOW)
    store.record_daily("2026-10-26", 3, 2, MIDNIGHT)  # at 23:59:59, before ch_yr_* were kept
    backup = backup_at(store, tmp_path / "collector-2026-10-27.db", MIDNIGHT + 41)
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    assert recount(store, [backup], scratch) == [
        "collector-2026-10-27.db: 2026-10-26 already has a closer count, kept; filled in "
        "ch_yr_2nd -, ch_yr_med 1.00"
    ]
    assert recorded(store) == {"2026-10-26": (3, 2, MIDNIGHT)}
    day = store.daily()["2026-10-26"]
    assert (day["ch_yr_2nd"], round(day["ch_yr_med"], 2)) == (None, 1.0)
    assert "as of" not in notes_by_day(store, MIDNIGHT + DAY_S)["2026-10-26"]  # still 23:59:59
    # Only blanks are filled: the median stays; once both are there, a run skips the day.
    store.fill_years("2026-10-26", (0.5, 9.0))
    assert recount(store, [backup], scratch) == [
        "collector-2026-10-27.db: 2026-10-26 already has a closer count, skipped"
    ]
    day = store.daily()["2026-10-26"]
    assert (day["ch_yr_2nd"], day["ch_yr_med"]) == (0.5, 1.0)


def test_recount_uses_the_files_time_for_a_backup_without_tick_at(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    added(store, CHANNEL, "add00000001", NOW)
    backup = backup_at(store, tmp_path / "collector-2026-10-27.db", None)
    os.utime(backup, (MIDNIGHT + 75, MIDNIGHT + 75))
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    recount(store, [backup], scratch)
    assert recorded(store) == {"2026-10-26": (0, 0, MIDNIGHT + 75)}


def test_the_left_out_list_counts_only_the_videos_the_site_would_show(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    store.upsert_channel(id=SMALL, title="Small", status="in", source="v2", listed_at=NOW)
    picks = fill_floor(store, SMALL, 2)
    store.set_state(picks[0], "removed")  # gone offline: not counted
    added(store, SMALL, "add00000001", NOW)
    waiting(store, SMALL, ["wait0000001"])  # not downloaded: not counted
    answered(store, SMALL, 1, 32, "nfk")  # 1 of 33, with the added and waiting ones: 3 of 35
    store.update_left_out("2026-10-26", NOW)
    assert left_out_rows(store) == [
        {"channel_id": SMALL, "channel_title": "Small", "checked": 35, "for_kids": 3,
         "kids_pct": "8.6", "per_year": "2.2", "reason": "both", "since": "2026-10-26",
         "videos": 2}
    ]  # fmt: skip


def test_a_new_note_lands_on_the_first_day_the_collector_runs_with_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = make_store(tmp_path)
    added(store, CHANNEL, "add00000001", NOW)
    monkeypatch.setattr(notes, "NOTES", (("Started", "2026-10-26"), ("Rule A", None)))
    changelog(store, NOW + DAY_S)
    monkeypatch.setattr(notes, "NOTES", (*notes.NOTES, ("Rule B", None)))
    changelog(store, NOW + DAY_S + 60)  # a later release the same day
    by_day = {r["date"]: r["note"] for r in changelog(store, NOW + 3 * DAY_S)}
    assert by_day == {"2026-10-27": "Rule A; Rule B", "2026-10-26": "Started"}


# --- channels ------------------------------------------------------------------------------


def test_discovery_adds_channels_that_meet_v2s_rules(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    good, small, topic = "UC" + "g" * 22, "UC" + "s" * 22, "UC" + "t" * 22
    youtube.search[QUERIES[0]] = [good, small, topic, CHANNEL]
    youtube.channels = {
        good: ("Good Songs", 50_000, 300),
        small: ("Small", 5_000, 300),
        topic: ("Artist - Topic", 1_000_000, 9_000),
    }
    youtube.uploads[good] = uploads(120)
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.discover(clock.now)
    store = collector.store
    assert store.channel_status(good) == "in"
    assert store.channel_status(small) == "near_miss"
    assert store.channel_status(topic) == "rejected"
    assert (
        store.db.execute("SELECT COUNT(*) FROM uploads WHERE channel_id = ?", (good,)).fetchone()[0]
        == 120
    )
    assert youtube.calls.count("search") == 6  # today's share of the 36 queries
    collector.discover(clock.now)  # nothing more today
    assert youtube.calls.count("search") == 6
    for day in range(1, 6):  # 6 a day: all 36 in 6 days, so each query at least weekly
        collector.discover(clock.now + day * DAY_S)
    assert youtube.calls.count("search") == 36
    assert store.get("channels_checked_at") == "2026-10-31"


def test_a_near_miss_that_grew_is_added(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    grown = "UC" + "n" * 22
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.upsert_channel(
        id=grown, status="near_miss", source="v2", queries="kids songs", checked_at="2026-08-26"
    )
    youtube.channels[grown] = ("Grown", 20_000, 150)
    youtube.uploads[grown] = uploads(3)
    collector.check_near_misses(clock.now)
    row = collector.store.db.execute("SELECT * FROM channels WHERE id = ?", (grown,)).fetchone()
    assert (row["status"], row["source"], row["queries"]) == ("in", "v2", "kids songs")
    assert row["joined_at"].startswith("2026-10-2")


def test_offline_videos_are_taken_out(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock, at_floor=False)
    collector.store.add_uploads(
        CHANNEL, [("pick0000001", "2020-01-01"), ("pick0000002", "2020-01-01")]
    )
    collector.store.set_state("pick0000001", "v2", online_at=0)
    collector.store.set_state("pick0000002", "v2", online_at=0)
    youtube.video("pick0000002", contentDetails__regionRestriction={"blocked": ["US"]})
    collector.check_online(clock.now)
    assert collector.store.removed_rows() == []  # not on one answer: checked again in a day
    clock.now += DAY_S - 60
    collector.check_online(clock.now)
    assert collector.store.removed_rows() == []
    clock.now += 60
    collector.check_online(clock.now)
    removed = {r["video_id"]: r["reason"] for r in collector.store.removed_rows()}
    assert removed == {"pick0000001": "gone", "pick0000002": "region"}
    text = (tmp_path / "data" / "collected" / "removed.tsv").read_text()
    assert "pick0000001" in text
    row = changelog(collector.store, clock.now + DAY_S)[0]  # once the day is over
    assert (row["date"], row["videos"], row["channels"]) == ("2026-10-27", 0, 0)
    assert (row["added_v"], row["removed_v"], row["new_ch"]) == (0, 2, 0)


def test_a_missing_thumbnail_brings_the_offline_check_forward(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock, at_floor=False)
    gone, online, waiting = "pick0000001", "pick0000002", "pick0000003"
    collector.store.add_uploads(CHANNEL, [(v, "2020-01-01") for v in (gone, online, waiting)])
    for video_id in (gone, online, waiting):
        collector.store.set_state(video_id, "v2", online_at=clock.now)  # checked today
    youtube.video(online)
    collector.store.db.execute(  # missed once yesterday: its second check is due today
        "UPDATE uploads SET online_at = 0, unsure = 1, retry_at = ? WHERE id = ?",
        (clock.now + DAY_S, waiting),
    )
    hints = tmp_path / "analyses" / OFFLINE_HINTS
    hints.mkdir(parents=True)
    for video_id in (gone, online, waiting, "vid00000000", "unknown0000"):
        (hints / video_id).touch()
    collector.tick()
    assert list(hints.iterdir()) == []
    online_at = dict(collector.store.db.execute("SELECT id, online_at FROM uploads").fetchall())
    assert online_at[online] == clock.now  # checked at once, still online
    assert collector.store.removed_rows() == []  # not on one answer, nor `waiting` early
    clock.now += DAY_S
    collector.tick()
    assert [r["video_id"] for r in collector.store.removed_rows()] == [gone, waiting]


# --- the Data API budget -------------------------------------------------------------------


def test_stops_at_its_budget_until_the_next_day(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    youtube.search = {q: [] for q in QUERIES}
    collector = make_collector(tmp_path, youtube, pipeline, clock, budget=250)
    collector.tick()
    assert youtube.calls.count("search") == 2  # 100 units each; the third would pass 250
    assert collector.store.get("out_of_units")
    calls = len(youtube.calls)
    collector.tick()
    assert len(youtube.calls) == calls  # no more calls today


def test_youtube_saying_quota_exceeded_stops_for_the_day(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    youtube.quota_exceeded = True
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.tick()
    assert collector.store.get("out_of_units")


def test_a_gone_channel_has_no_uploads(youtube: FakeYouTube) -> None:
    api = DataApi(youtube.get, lambda units: None)
    assert api.uploads_page("UC" + "x" * 22) == ([], None)


def test_other_api_errors_surface() -> None:
    def failing(url: str) -> dict[str, Any]:
        raise ApiError("HTTP 500")

    with pytest.raises(ApiError):
        DataApi(failing, lambda units: None).videos(["a"])


# --- seeding from v2 -----------------------------------------------------------------------


def test_seed_from_v2(tmp_path: Path) -> None:
    repo = tmp_path / "research"
    probe = repo / "runs" / "channel-yield-probe"
    probe.mkdir(parents=True)
    other, topic = "UC" + "o" * 22, "UC" + "t" * 22
    columns = ["channel_id", "title", "subscriber_count", "video_count", "auto_generated",
               "discovery_queries"]  # fmt: skip
    with (probe / "channels-p1.tsv").open("w", encoding="utf-8") as fh:
        fh.write("\t".join(columns) + "\n")
        fh.write(f"{CHANNEL}\tSampled\t2000000\t500\t0\tkids songs\n")
        fh.write(f"{other}\tSmall\t9000\t500\t0\tkids songs\n")
        fh.write(f"{topic}\tX - Topic\t90000\t500\t1\tkids songs\n")
    catalogue = repo / "runs" / "contemporary-v2" / "catalogue-cache"
    catalogue.mkdir(parents=True)
    (catalogue / f"{CHANNEL}.tsv").write_text(
        "video_id\tpublished_at\npick0000001\t2020-01-01T00:00:00Z\nmore0000001\t2021-01-01T00:00:00Z\n"
    )
    dataset = write_dataset(tmp_path / "videos.tsv", [video_row("pick0000001", CHANNEL, 1.0)])
    store = Store(tmp_path / "db" / "collector.db")
    assert seed(store, repo, dataset) == "Seeded 1 channels (1 near misses), 2 uploads, 1 v2 picks"
    assert store.channel_status(topic) == "rejected"
    assert store.upload("pick0000001").state == "v2"  # type: ignore[union-attr]
    assert store.upload("more0000001").state == "new"  # type: ignore[union-attr]
    with pytest.raises(RuntimeError, match="already seeded"):
        seed(store, repo, dataset)


# --- when something fails (decision 12) ----------------------------------------------------

OTHER = "UC" + "b" * 22


def test_a_failing_channel_list_waits_while_the_others_and_downloads_go_on(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    collector.store.upsert_channel(id=OTHER, title="Other", status="in", source="v2", listed_at=0)
    collector.store.update_channel(CHANNEL, listed_at=0)
    youtube.uploads[OTHER] = [("othr0000001", "2024-05-01T00:00:00Z")]
    youtube.fails = lambda method, params: params.get("playlistId") == "UU" + CHANNEL[2:]
    collector.tick()
    assert collector.store.known("othr0000001")  # the other channel was read
    assert len(collected_ids(collector)) == 1  # and a video downloaded
    calls = youtube.calls.count("playlistItems")
    clock.now += 1800
    collector.tick()
    assert youtube.calls.count("playlistItems") == calls  # it waits an hour, not every tick
    youtube.fails = lambda method, params: False
    clock.now += 1800
    collector.tick()
    row = collector.store.db.execute("SELECT * FROM channels WHERE id = ?", (CHANNEL,)).fetchone()
    assert (row["api_failures"], row["listed_at"]) == (0, clock.now)


def test_a_failing_batch_of_details_waits_and_downloads_go_on(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    collector.tick()  # checks the uploads, downloads one
    late = "late0000001"  # from 2023, which has no video yet: the thinnest year
    collector.store.add_uploads(CHANNEL, [(late, "2023-05-01T00:00:00Z")])
    youtube.video(late)
    youtube.fails = lambda method, params: method == "videos"
    clock.now += 3600
    collector.tick()
    upload = collector.store.upload(late)
    assert upload is not None and (upload.state, upload.api_failures) == ("new", 1)
    assert len(collected_ids(collector)) == 2  # downloads went on
    calls = youtube.calls.count("videos")
    clock.now += 600
    collector.tick()
    assert youtube.calls.count("videos") == calls  # the job waits after the error
    youtube.fails = lambda method, params: False
    clock.now += 3600
    collector.tick()
    assert collected_ids(collector)[-1] == late  # checked, and downloaded first


def test_a_missing_upload_is_asked_again_after_1_3_and_7_days(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    first = by_rank(youtube.uploads[CHANNEL])[0]
    del youtube.videos[first]  # private for a while
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    collector.check_candidates(clock.now)
    upload = collector.store.upload(first)
    assert upload is not None and (upload.state, upload.unsure) == ("new", 1)
    clock.now += DAY_S
    collector.check_candidates(clock.now)
    assert collector.store.upload(first).unsure == 2  # type: ignore[union-attr]
    youtube.video(first)  # public again
    clock.now += 3 * DAY_S
    collector.check_candidates(clock.now)
    assert collector.store.upload(first).state == "eligible"  # type: ignore[union-attr]


def test_an_undecided_shorts_probe_is_final_only_the_4th_time(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    first = by_rank(youtube.uploads[CHANNEL])[0]
    youtube.video(first, contentDetails__duration="PT2M30S")
    collector = make_collector(tmp_path, youtube, pipeline, clock, shorts={first: None})
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    for wait in (0, DAY_S, 3 * DAY_S, 7 * DAY_S):
        clock.now += wait
        assert collector.store.upload(first).state == "new"  # type: ignore[union-attr]
        collector.check_candidates(clock.now)
    upload = collector.store.upload(first)
    assert upload is not None and (upload.state, upload.unsure) == ("ineligible", 4)
    reason = collector.store.db.execute("SELECT reason FROM uploads WHERE id = ?", (first,))
    assert reason.fetchone()[0] == "short"


def test_a_half_written_removal_is_checked_again(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, [("pick0000001", "2020-01-01")])
    collector.store.set_state("pick0000001", "removed", "gone")  # no removed.tsv row
    collector.repair(clock.now)
    upload = collector.store.upload("pick0000001")
    assert upload is not None and upload.state == "v2"
    assert collector.store.in_dataset(clock.now, clock.now, 50)[0].id == "pick0000001"


def test_a_failed_backup_doesnt_stop_the_collector(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    (tmp_path / "clips").mkdir()
    (tmp_path / "clips" / "backups").write_text("not a folder")  # as if the volume broke
    collector.tick()
    assert len(collected_ids(collector)) == 1
    assert collector.store.get("backup_failures") == "1"
    (tmp_path / "clips" / "backups").unlink()
    clock.now += 1800
    collector.tick()
    assert not (tmp_path / "clips" / "backups").exists()  # waits an hour
    clock.now += 1800
    collector.tick()
    assert (tmp_path / "clips" / "backups" / "collector-2026-10-26.db").exists()
    assert collector.store.get("backup_failures") == "0"


def test_an_unexpected_error_is_a_failed_try_that_takes_a_slot(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    first = by_rank(youtube.uploads[CHANNEL])[0]
    pipeline.fail[first] = ("measure", None)  # crashes, not an AnalysisError
    probed: list[str] = []

    def blocked(video_id: str) -> bool:
        probed.append(video_id)
        return False

    collector = make_collector(tmp_path, youtube, pipeline, clock, blocked=blocked)
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    collector.tick()
    upload = collector.store.upload(first)
    assert upload is not None and upload.state == "eligible"
    assert collector.store.failures(first) == 1
    assert probed == []  # not YouTube: no block probe
    assert float(collector.store.get("next_download_at")) > clock.now  # the pace holds
    collector.tick()
    assert collector.store.attempts_since(0) == 1


def test_a_new_channels_list_that_fails_on_page_3_goes_on_from_page_3(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    good = "UC" + "g" * 22
    youtube.search[QUERIES[0]] = [good]
    youtube.channels = {good: ("Good Songs", 50_000, 300)}
    youtube.uploads[good] = [(f"good{i:07d}", "2024-05-01T00:00:00Z") for i in range(200)]
    pages: list[str] = []

    def fails(method: str, params: dict[str, str]) -> bool:
        if method != "playlistItems" or params["playlistId"] != "UU" + good[2:]:
            return False
        pages.append(params.get("pageToken", "0"))
        return params.get("pageToken") == "100" and pages.count("100") == 1

    youtube.fails = fails
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.discover(clock.now)
    store = collector.store
    row = store.db.execute("SELECT * FROM channels WHERE id = ?", (good,)).fetchone()
    assert (row["status"], row["full_listing"]) == ("in", "100")
    assert (
        store.db.execute("SELECT COUNT(*) FROM uploads WHERE channel_id = ?", (good,)).fetchone()[0]
        == 100
    )
    clock.now += 3600
    collector.finish_listings(clock.now)
    assert pages == ["0", "50", "100", "100", "150"]  # pages 1 and 2 not read again
    assert (
        store.db.execute("SELECT COUNT(*) FROM uploads WHERE channel_id = ?", (good,)).fetchone()[0]
        == 200
    )
    row = store.db.execute("SELECT * FROM channels WHERE id = ?", (good,)).fetchone()
    assert row["full_listing"] is None


def test_an_older_database_gets_the_new_columns_and_reads_new_channels_again(
    tmp_path: Path,
) -> None:
    import sqlite3

    path = tmp_path / "collector.db"
    old = sqlite3.connect(path)
    old.executescript(
        "CREATE TABLE channels (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', "
        "subscriber_count INTEGER, video_count INTEGER, tier TEXT NOT NULL DEFAULT '', "
        "status TEXT NOT NULL, source TEXT NOT NULL, queries TEXT NOT NULL DEFAULT '', "
        "joined_at TEXT, checked_at TEXT, listed_at REAL);"
        "CREATE TABLE uploads (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, "
        "published_at TEXT NOT NULL, r REAL NOT NULL, state TEXT NOT NULL DEFAULT 'new', "
        "reason TEXT NOT NULL DEFAULT '', retry_at REAL NOT NULL DEFAULT 0, checked_at REAL, "
        "online_at REAL, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', "
        "tags TEXT NOT NULL DEFAULT '', channel_title TEXT NOT NULL DEFAULT '', "
        "duration_s INTEGER);"
        "INSERT INTO channels (id, status, source, joined_at) VALUES "
        "('UCv2', 'in', 'v2', '2026-08-26'), ('UCnew', 'in', 'discovery', "
        "'2026-10-27T10:00:00Z'), ('UCnear', 'near_miss', 'v2', NULL);"
        "INSERT INTO uploads (id, channel_id, published_at, r) VALUES ('vid', 'UCv2', '2024', 0.5);"
        "CREATE TABLE daily (day TEXT PRIMARY KEY, ch_ready INTEGER NOT NULL);"
        "INSERT INTO daily VALUES ('2026-10-29', 17);"
        "CREATE TABLE attempts (id INTEGER PRIMARY KEY, video_id TEXT NOT NULL, at REAL NOT NULL, "
        "outcome TEXT NOT NULL, message TEXT NOT NULL DEFAULT '');"
        "INSERT INTO attempts (video_id, at, outcome) VALUES ('vid', 1, 'collected');"
    )
    old.close()
    store = Store(path)
    listing = dict(store.db.execute("SELECT id, full_listing FROM channels").fetchall())
    assert listing == {"UCv2": None, "UCnew": "", "UCnear": None}
    named = dict(store.db.execute("SELECT id, named_at FROM channels").fetchall())
    assert named == {"UCv2": None, "UCnew": None, "UCnear": None}  # names read on the next tick
    upload = store.upload("vid")
    assert upload is not None and (upload.unsure, upload.api_failures) == (0, 0)
    assert upload.pick == "sample"  # everything picked before the floor
    day = store.daily()["2026-10-29"]
    assert (day["ch_ready"], day["ch_out"], day["at"], day["ch_yr_med"]) == (17, None, None, None)
    assert store.catching_up() == frozenset()  # the channels in before count as caught up
    assert store.downloads_today(1) == (0, 1)  # the downloads before weren't exploring
    store.close()
    assert (
        dict(Store(path).db.execute("SELECT id, full_listing FROM channels").fetchall()) == listing
    )


def test_a_video_without_a_channel_name_waits_until_the_repair_fills_it(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    first = by_rank(youtube.uploads[CHANNEL])[0]
    youtube.video(first, snippet__channelTitle="")
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.update_channel(CHANNEL, title="")
    collector.store.add_uploads(CHANNEL, youtube.uploads[CHANNEL])
    collector.store.set("repaired_day", "2026-10-26")
    collector.tick()
    assert collector.store.upload(first).state == "measured"  # type: ignore[union-attr]
    assert collector.store.attempts_since(0) == 1  # measured: it took its slot
    assert first not in collected_ids(collector)
    exported = tmp_path / "data" / "collected" / "2026.tsv"
    assert not exported.exists() or first not in exported.read_text()
    youtube.channels[CHANNEL] = ("Found Name", 50_000, 300)
    clock.now += DAY_S
    collector.tick()  # the next day's repair
    upload = collector.store.upload(first)
    assert upload is not None and (upload.state, upload.channel_title) == (
        "collected",
        "Found Name",
    )
    row = next(r for r in collector.store.collected_rows() if r["video_id"] == first)
    assert row["added_at"] == sampling_time(clock.now)  # added when it went on the site
    assert first in exported.read_text()


def test_uploads_listed_without_a_date_are_looked_up(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    youtube.uploads[CHANNEL] = [("nodate00001", "")]
    youtube.video("nodate00001", snippet__publishedAt="2024-05-01T00:00:00Z")
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.update_channel(CHANNEL, listed_at=0)
    collector.tick()
    upload = collector.store.upload("nodate00001")
    assert upload is not None and upload.published_at == "2024-05-01T00:00:00Z"


def test_v2_channels_without_a_name_get_one_in_the_export(
    tmp_path: Path, youtube: FakeYouTube, pipeline: FakePipeline
) -> None:
    clock = Clock()
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    collector.store.update_channel(CHANNEL, title="")
    collector.store.add_uploads(CHANNEL, [("pick0000001", "2020-01-01")])
    collector.store.set_state("pick0000001", "v2", online_at=clock.now)
    youtube.channels[CHANNEL] = ("Found Name", 50_000, 300)
    collector.repair(clock.now)
    names = (tmp_path / "data" / "collected" / "channel-names.tsv").read_text()
    assert names == f"channel_id\tchannel_title\n{CHANNEL}\tFound Name\n"
    assert youtube.calls.count("channels") == 1
    collector.repair(clock.now + DAY_S)
    assert youtube.calls.count("channels") == 1  # known now: not asked again


def test_the_recount_command_records_and_writes_the_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from hyperstim_api.collector.__main__ import main

    data = tmp_path / "data"
    store = make_store(data)
    added(store, CHANNEL, "add00000001", NOW)
    backup = backup_at(store, tmp_path / "collector-2026-10-27.db", MIDNIGHT + 41)
    store.close()
    monkeypatch.setenv("COLLECTOR_DATA_DIR", str(data))
    monkeypatch.setenv("COLLECTOR_CLIPS_DIR", str(tmp_path / "clips"))
    monkeypatch.setattr("sys.argv", ["collector", "recount", str(backup)])
    main()
    assert "2026-10-26 ch_ready 0, ch_out 0" in capsys.readouterr().out
    assert "00:00:41 UTC" in (data / "collected" / "CHANGELOG.tsv").read_text()


def test_the_collector_adds_120_videos_a_day_unless_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from hyperstim_api.collector.__main__ import settings as collector_settings

    monkeypatch.setenv("COLLECTOR_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("COLLECTOR_CLIPS_DIR", str(tmp_path / "clips"))
    monkeypatch.delenv("COLLECT_PER_DAY", raising=False)
    assert collector_settings().per_day == 120
    assert Settings(data_dir=tmp_path, clips_dir=tmp_path, analysis_dir=None).per_day == 120
    monkeypatch.setenv("COLLECT_PER_DAY", "150")
    assert collector_settings().per_day == 150
