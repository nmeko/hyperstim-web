import csv
import json
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hyperstim_api.analysis import AnalysisError, ErrorCode, VideoInfo
from hyperstim_api.config import Settings
from hyperstim_api.dataset import REQUIRED_COLUMNS
from hyperstim_api.main import create_app
from hyperstim_api.scoring import FEATURES
from hyperstim_api.thumbnails import Fetch

ORIGIN = "http://localhost:3000"

# Synthetic videos: (id, channel_id, value of every feature). With all 12 features
# equal, a video's score is the percentile of that value among the scored videos.
VIDEOS = [
    ("vid-a1", "chan-a", 10.0),
    ("vid-a2", "chan-a", 9.0),
    ("vid-a3", "chan-a", 8.0),
    ("vid-a4", "chan-a", 7.0),
    ("vid-a5", "chan-a", 6.0),
    ("vid-b1", "chan-b", 5.0),
    ("vid-b2", "chan-b", 4.0),
    ("vid-b3", "chan-b", 3.0),
    ("vid-b4", "chan-b", 2.0),
    ("vid-b5", "chan-b", 1.0),
    ("vid-c1", "chan-c", 11.0),  # chan-c has 2 videos
    ("vid-c2", "chan-c", 0.0),
]

Row = dict[str, str]


def video_row(
    video_id: str,
    channel_id: str,
    value: float | None,
    published_at: str = "2024-01-01",
    category: str = "music",
) -> Row:
    row = {
        "video_id": video_id,
        "title": f"Title of {video_id}",
        "channel_id": channel_id,
        "channel_title": f"Channel {channel_id}",
        "category": category,
        "published_at": published_at,
    }
    row.update({name: "" if value is None else str(value) for name in FEATURES})
    return row


def write_dataset(path: Path, rows: list[Row], features_date: str = "2026-09-01") -> Path:
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, REQUIRED_COLUMNS, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    path.with_suffix(".meta.json").write_text(json.dumps({"featuresDate": features_date}))
    return path


@pytest.fixture
def dataset_path(tmp_path: Path) -> Path:
    return write_dataset(tmp_path / "videos.tsv", [video_row(*v) for v in VIDEOS])


class FakePipeline:
    """Stands in for the research scripts: no network, no ffmpeg.

    Every video gets the same features unless `features` says otherwise, and the channel
    UC-live unless `channels` says otherwise; `fail` makes a
    step fail for a video; `during(step, video_id, workdir)` runs inside each step.
    """

    def __init__(self) -> None:
        self.features: dict[str, dict[str, float | None]] = {}
        self.channels: dict[str, str] = {}  # id -> channel ID
        self.fail: dict[str, tuple[str, ErrorCode | None]] = {}  # id -> (step, code or crash)
        self.during: Callable[[str, str, Path | None], None] | None = None
        self.workdirs: list[Path] = []
        self.links: dict[str, tuple[str, str]] = {}  # channel lookups: URL -> (ID, name)
        self.channel_calls: list[str] = []

    def _step(self, step: str, video_id: str, workdir: Path | None = None) -> None:
        if workdir is not None:
            self.workdirs.append(workdir)
            (workdir / f"{step}.tmp").write_text("clip")
        if self.during:
            self.during(step, video_id, workdir)
        failing = self.fail.get(video_id)
        if failing and failing[0] == step:
            if failing[1] is None:
                raise RuntimeError("pipeline crashed")
            raise AnalysisError(failing[1])

    def lookup(self, video_id: str) -> VideoInfo:
        self._step("lookup", video_id)
        channel_id = self.channels.get(video_id, "UC-live")
        return VideoInfo(title=f"Live {video_id}", channel_id=channel_id, channel="Live channel")

    def channel(self, url: str) -> tuple[str, str]:
        """The channel for a link, from `links` (URL -> (ID, name)); unknown links fail."""
        self.channel_calls.append(url)
        if url not in self.links:
            raise AnalysisError("unavailable")
        return self.links[url]

    def download(self, video_id: str, workdir: Path) -> None:
        self._step("download", video_id, workdir)

    def measure(self, video_id: str, workdir: Path) -> dict[str, float | None]:
        self._step("measure", video_id, workdir)
        return self.features.get(video_id, dict.fromkeys(FEATURES, 5.5))

    def cancel(self) -> None:
        pass


@pytest.fixture
def pipeline() -> FakePipeline:
    return FakePipeline()


@pytest.fixture
def make_client(
    tmp_path_factory: pytest.TempPathFactory, pipeline: FakePipeline
) -> Iterator[Callable[..., TestClient]]:
    clients: list[TestClient] = []

    def make(
        path: Path,
        analysis_dir: Path | None = None,
        limit_per_ip: int = 5,
        limit_per_day: int = 0,
        api_docs: bool = True,
        fetch_thumbnail: Fetch | None = None,
        collected_dir: Path | None = None,
        usage_dir: Path | None = None,
    ) -> TestClient:
        settings = Settings(
            dataset_path=path,
            cors_origin=ORIGIN,
            analysis_dir=analysis_dir or tmp_path_factory.mktemp("analyses"),
            thumbnail_dir=tmp_path_factory.mktemp("thumbnails"),
            analysis_limit_per_ip=limit_per_ip,
            analysis_limit_per_day=limit_per_day,
            api_docs=api_docs,
            collected_dir=collected_dir,
            usage_dir=usage_dir,
        )
        # Not used as a context manager, so the worker thread doesn't start: tests run
        # the queue themselves with `analyzer.run_next()`.
        client = TestClient(
            create_app(settings, pipeline, fetch_thumbnail or (lambda video_id, size: None))
        )
        clients.append(client)
        return client

    yield make
    for client in clients:
        client.close()


@pytest.fixture
def client(dataset_path: Path, make_client: Callable[..., TestClient]) -> TestClient:
    return make_client(dataset_path)
