"""Usage counts (plan 014): what's counted, search chains, the daily files, no IPs."""

import csv
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hyperstim_api.usage import CHAIN_S, UsageLog
from tests.conftest import FakePipeline, video_row, write_dataset

CHANNEL = "UC" + "a" * 22
DAY = 1_793_000_000.0  # 2026-10-26, 08:53 UTC


class Clock:
    def __init__(self) -> None:
        self.now = DAY

    def __call__(self) -> float:
        return self.now


def rows(path: Path) -> dict[tuple[str, str, str], int]:
    with path.open(newline="", encoding="utf-8") as fh:
        return {
            (r["kind"], r["key"], r["extra"]): int(r["count"])
            for r in csv.DictReader(fh, delimiter="\t")
        }


def test_counts_are_written_per_day(tmp_path: Path) -> None:
    clock = Clock()
    log = UsageLog(tmp_path, clock)
    log.count("video_view", "abc", "dataset")
    log.count("video_view", "abc", "dataset")
    log.flush()
    assert rows(tmp_path / "2026-10-26.tsv") == {("video_view", "abc", "dataset"): 2}
    clock.now += 86400
    log.count("channel_view", "UCx")
    log.flush()
    assert rows(tmp_path / "2026-10-26.tsv") == {("video_view", "abc", "dataset"): 2}
    assert rows(tmp_path / "2026-10-27.tsv") == {("channel_view", "UCx", ""): 1}


def test_a_restart_keeps_the_days_counts(tmp_path: Path) -> None:
    clock = Clock()
    first = UsageLog(tmp_path, clock)
    first.count("channel_view", "UCx")
    first.stop()
    second = UsageLog(tmp_path, clock)
    second.count("channel_view", "UCx")
    second.flush()
    assert rows(tmp_path / "2026-10-26.tsv") == {("channel_view", "UCx", ""): 2}


def test_only_the_last_search_of_a_chain_counts(tmp_path: Path) -> None:
    clock = Clock()
    log = UsageLog(tmp_path, clock)
    for text in ["p", "pe", "pep", "Peppa", "peppa pig"]:
        log.search("1.1.1.1", "search_videos", text, found=True)
        clock.now += 0.3
    log.search("2.2.2.2", "search_videos", "Bluey ", found=False)  # someone else, at once
    log.search("1.1.1.1", "search_videos", "peppa", found=True)  # deleting back: same chain
    clock.now += CHAIN_S
    log.flush()
    assert rows(tmp_path / "2026-10-26.tsv") == {
        ("search_videos", "peppa", "found"): 1,
        ("search_videos", "bluey", "nothing"): 1,
    }
    log.search("1.1.1.1", "search_videos", "peppa", found=True)  # later: a new search
    log.search("1.1.1.1", "search_channels", "cocomelon", found=True)  # other list: new chain
    log.search("1.1.1.1", "search_channels", "dinosaurs", found=False)  # other word: new chain
    log.stop()
    assert rows(tmp_path / "2026-10-26.tsv") == {
        ("search_videos", "peppa", "found"): 2,
        ("search_videos", "bluey", "nothing"): 1,
        ("search_channels", "cocomelon", "found"): 1,
        ("search_channels", "dinosaurs", "nothing"): 1,
    }


@pytest.mark.parametrize(
    "text", ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ", "UC" + "a" * 22, "   ", ""]
)
def test_links_and_ids_are_not_kept_as_searches(tmp_path: Path, text: str) -> None:
    log = UsageLog(tmp_path, Clock())
    log.search("1.1.1.1", "search_videos", text, found=True)
    log.stop()
    assert not (tmp_path / "2026-10-26.tsv").exists()


def test_long_searches_are_cut(tmp_path: Path) -> None:
    log = UsageLog(tmp_path, Clock())
    log.search("1.1.1.1", "search_videos", "x" * 200, found=False)
    log.stop()
    assert rows(tmp_path / "2026-10-26.tsv") == {("search_videos", "x" * 80, "nothing"): 1}


def test_the_api_counts_what_visitors_do_and_never_their_ip(
    tmp_path: Path,
    make_client: Callable[..., TestClient],
    pipeline: FakePipeline,
) -> None:
    folder = tmp_path / "usage"
    dataset_path = write_dataset(tmp_path / "videos.tsv", [video_row("dataset0001", CHANNEL, 1.0)])
    client = make_client(dataset_path, usage_dir=folder)
    client.get("/api/videos/dataset0001")
    client.get("/api/channels/" + CHANNEL)
    client.get("/api/videos/nothere0001")  # unknown: not counted
    client.get("/api/channels/" + "UC" + "z" * 22)  # unknown: not counted
    client.post("/api/analyses/dataset0001")  # a dataset video
    client.post("/api/analyses/live0000001")
    client.post("/api/analyses/live0000001")
    client.get("/api/videos", params={"q": "Title of"})
    client.get("/api/videos", params={"q": "Title of", "offset": 20})  # a later page
    client.get("/api/channels", params={"q": "zzz", "minVideos": 1})
    pipeline.links["https://www.youtube.com/@known"] = ("UC" + "k" * 22, "Known")
    client.get("/api/channel-lookup", params={"url": "https://www.youtube.com/@known"})
    usage = client.app.state.usage  # type: ignore[attr-defined]
    usage.stop()
    files = list(folder.glob("*.tsv"))
    assert len(files) == 1
    assert rows(files[0]) == {
        ("video_view", "dataset0001", "dataset"): 1,
        ("channel_view", CHANNEL, ""): 1,
        ("live_check", "dataset0001", "in_dataset"): 1,
        ("live_check", "live0000001", "new"): 1,
        ("live_check", "live0000001", "repeat"): 1,
        ("search_videos", "title of", "found"): 1,
        ("search_channels", "zzz", "nothing"): 1,
        ("channel_lookup", "UC" + "k" * 22, "not_in"): 1,
    }
    assert "testclient" not in files[0].read_text()  # the test client's address


def test_nothing_is_counted_without_a_usage_folder(
    tmp_path: Path, make_client: Callable[..., TestClient]
) -> None:
    dataset_path = write_dataset(tmp_path / "videos.tsv", [video_row("dataset0001", CHANNEL, 1.0)])
    client = make_client(dataset_path)
    assert client.get("/api/videos/dataset0001").status_code == 200
    assert client.app.state.usage is None  # type: ignore[attr-defined]
