import io
import urllib.error
import urllib.request
from collections.abc import Callable
from email.message import Message
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hyperstim_api.thumbnails import (
    BLOG_VIDEOS,
    KEEP_S,
    MISSING_S,
    OFFLINE_HINTS,
    UNREACHABLE_S,
    Size,
    ThumbnailCache,
    Unavailable,
    fetch_from_youtube,
)
from tests.conftest import ORIGIN, video_row, write_dataset

KNOWN = "data0000000"
LIVE = "live0000000"
BLOG = "blog0000000"
UNKNOWN = "else0000000"


class FakeYouTube:
    """Stands in for YouTube's image server: `images` maps (id, size) to bytes; anything else
    is missing, or raises Unavailable while `down` is set."""

    def __init__(self) -> None:
        self.images: dict[tuple[str, Size], bytes] = {}
        self.calls: list[tuple[str, Size]] = []
        self.down = False

    def __call__(self, video_id: str, size: Size) -> bytes | None:
        self.calls.append((video_id, size))
        if self.down:
            raise Unavailable
        return self.images.get((video_id, size))


@pytest.fixture
def youtube() -> FakeYouTube:
    fake = FakeYouTube()
    fake.images[(KNOWN, "hq")] = b"hq-image"
    fake.images[(KNOWN, "mq")] = b"mq-image"
    fake.images[(LIVE, "hq")] = b"live-image"
    fake.images[(BLOG, "hq")] = b"blog-image"
    return fake


@pytest.fixture
def client(
    tmp_path: Path, make_client: Callable[..., TestClient], youtube: FakeYouTube
) -> TestClient:
    dataset = write_dataset(tmp_path / "videos.tsv", [video_row(KNOWN, "UC-data", 1.0)])
    return make_client(dataset, analysis_dir=tmp_path / "analyses", fetch_thumbnail=youtube)


def hints(tmp_path: Path) -> list[str]:
    folder = tmp_path / "analyses" / OFFLINE_HINTS
    return sorted(p.name for p in folder.iterdir()) if folder.exists() else []


def test_serves_a_dataset_videos_thumbnail_fetched_once(
    client: TestClient, youtube: FakeYouTube
) -> None:
    for _ in range(2):
        response = client.get(f"/api/thumbnails/{KNOWN}")
        assert response.status_code == 200
        assert response.content == b"hq-image"
        assert response.headers["content-type"] == "image/jpeg"
        assert response.headers["cache-control"] == "public, max-age=86400"
    assert client.get(f"/api/thumbnails/{KNOWN}?size=mq").content == b"mq-image"
    assert youtube.calls == [(KNOWN, "hq"), (KNOWN, "mq")]  # the second hq came from the cache


def test_serves_a_live_checked_video_but_no_unknown_one(
    client: TestClient, youtube: FakeYouTube
) -> None:
    assert client.get(f"/api/thumbnails/{LIVE}").status_code == 404
    client.post(f"/api/analyses/{LIVE}")
    assert client.get(f"/api/thumbnails/{LIVE}").content == b"live-image"
    assert client.get(f"/api/thumbnails/{UNKNOWN}").status_code == 404
    assert youtube.calls == [(LIVE, "hq")]  # unknown videos never reach YouTube


def test_serves_a_blog_posts_video_listed_next_to_the_dataset(
    tmp_path: Path, make_client: Callable[..., TestClient], youtube: FakeYouTube
) -> None:
    dataset = write_dataset(tmp_path / "videos.tsv", [video_row(KNOWN, "UC-data", 1.0)])
    (tmp_path / BLOG_VIDEOS).write_text(f"# The blog's videos\n{BLOG}  # a post\n\n")
    client = make_client(dataset, fetch_thumbnail=youtube)
    assert client.get(f"/api/thumbnails/{BLOG}").content == b"blog-image"
    assert client.get(f"/api/thumbnails/{UNKNOWN}").status_code == 404
    assert client.get(f"/api/videos/{BLOG}").status_code == 404  # only its thumbnail


@pytest.mark.parametrize("path", [f"{KNOWN}?size=maxres", "../../etc/passwd", "short"])
def test_rejects_bad_sizes_and_ids(client: TestClient, path: str) -> None:
    assert client.get(f"/api/thumbnails/{path}").status_code in (404, 422)


def test_a_missing_thumbnail_is_a_404(client: TestClient, youtube: FakeYouTube) -> None:
    del youtube.images[(KNOWN, "hq")]
    assert client.get(f"/api/thumbnails/{KNOWN}").status_code == 404


def test_the_site_can_read_a_missing_or_failed_thumbnails_status(
    client: TestClient, youtube: FakeYouTube
) -> None:
    # The frontend asks again after an image fails, to tell a gone video (404) from an outage
    # (502), so both answers carry the CORS header (plan 009, Thumbnails).
    del youtube.images[(KNOWN, "mq")]
    gone = client.get(f"/api/thumbnails/{KNOWN}?size=mq", headers={"Origin": ORIGIN})
    assert gone.status_code == 404
    assert gone.headers["access-control-allow-origin"] == ORIGIN
    youtube.down = True
    down = client.get(f"/api/thumbnails/{KNOWN}", headers={"Origin": ORIGIN})
    assert down.status_code == 502
    assert down.headers["access-control-allow-origin"] == ORIGIN


def test_youtube_down_is_a_502_the_browser_doesnt_keep(
    client: TestClient, youtube: FakeYouTube
) -> None:
    youtube.down = True
    response = client.get(f"/api/thumbnails/{KNOWN}")
    assert response.status_code == 502
    assert response.headers["cache-control"] == "no-store"
    youtube.down = False
    # Within 10 minutes YouTube isn't asked again, but the size not tried yet is.
    assert client.get(f"/api/thumbnails/{KNOWN}").status_code == 502
    assert client.get(f"/api/thumbnails/{KNOWN}?size=mq").status_code == 200
    assert youtube.calls == [(KNOWN, "hq"), (KNOWN, "mq")]


def test_a_dataset_videos_missing_thumbnail_tells_the_collector(
    tmp_path: Path, client: TestClient, youtube: FakeYouTube
) -> None:
    del youtube.images[(KNOWN, "hq")]
    assert client.get(f"/api/thumbnails/{KNOWN}").status_code == 404
    assert hints(tmp_path) == [KNOWN]
    (tmp_path / "analyses" / OFFLINE_HINTS / KNOWN).unlink()  # the collector took it
    assert client.get(f"/api/thumbnails/{KNOWN}").status_code == 404  # remembered: no new hint
    assert hints(tmp_path) == []


def test_no_hint_for_a_live_check_or_while_youtube_is_down(
    tmp_path: Path, client: TestClient, youtube: FakeYouTube
) -> None:
    del youtube.images[(LIVE, "hq")]
    client.post(f"/api/analyses/{LIVE}")
    assert client.get(f"/api/thumbnails/{LIVE}").status_code == 404
    youtube.down = True
    assert client.get(f"/api/thumbnails/{KNOWN}").status_code == 502
    assert hints(tmp_path) == []


DAY = 24 * 3600


@pytest.fixture
def cache(tmp_path: Path, youtube: FakeYouTube) -> ThumbnailCache:
    return ThumbnailCache(tmp_path / "thumbs", youtube, clock=lambda: 1_000_000.0)


def test_cache_keeps_an_image_for_30_days(cache: ThumbnailCache, youtube: FakeYouTube) -> None:
    start = cache.clock()
    assert cache.get(KNOWN, "hq") == b"hq-image"
    youtube.images[(KNOWN, "hq")] = b"new-image"
    cache.clock = lambda: start + KEEP_S - 1
    assert cache.get(KNOWN, "hq") == b"hq-image"
    cache.clock = lambda: start + KEEP_S
    assert cache.get(KNOWN, "hq") == b"new-image"
    assert youtube.calls == [(KNOWN, "hq"), (KNOWN, "hq")]


def test_cache_survives_a_restart(tmp_path: Path, youtube: FakeYouTube) -> None:
    ThumbnailCache(tmp_path, youtube).get(KNOWN, "hq")
    assert ThumbnailCache(tmp_path, youtube).get(KNOWN, "hq") == b"hq-image"
    assert youtube.calls == [(KNOWN, "hq")]


def test_cache_remembers_a_missing_thumbnail_for_a_day(
    cache: ThumbnailCache, youtube: FakeYouTube
) -> None:
    start = cache.clock()
    assert cache.get(UNKNOWN, "hq") is None
    assert cache.get(UNKNOWN, "hq") is None
    youtube.images[(UNKNOWN, "hq")] = b"late-image"
    cache.clock = lambda: start + MISSING_S
    assert cache.get(UNKNOWN, "hq") == b"late-image"
    assert youtube.calls == [(UNKNOWN, "hq"), (UNKNOWN, "hq")]


def test_cache_serves_a_stale_image_while_youtube_is_down(
    cache: ThumbnailCache, youtube: FakeYouTube
) -> None:
    start = cache.clock()
    cache.get(KNOWN, "hq")
    youtube.down = True
    cache.clock = lambda: start + KEEP_S + DAY
    assert cache.get(KNOWN, "hq") == b"hq-image"
    with pytest.raises(Unavailable):
        cache.get(KNOWN, "mq")  # nothing cached to fall back on


def test_cache_waits_10_minutes_after_youtube_cant_be_reached(
    cache: ThumbnailCache, youtube: FakeYouTube
) -> None:
    start = cache.clock()
    youtube.down = True
    with pytest.raises(Unavailable):
        cache.get(KNOWN, "hq")
    youtube.down = False
    cache.clock = lambda: start + UNREACHABLE_S - 1
    with pytest.raises(Unavailable):
        cache.get(KNOWN, "hq")
    assert youtube.calls == [(KNOWN, "hq")]
    cache.clock = lambda: start + UNREACHABLE_S
    assert cache.get(KNOWN, "hq") == b"hq-image"
    assert youtube.calls == [(KNOWN, "hq"), (KNOWN, "hq")]


def test_cache_serves_a_stale_image_while_waiting(
    cache: ThumbnailCache, youtube: FakeYouTube
) -> None:
    start = cache.clock()
    cache.get(KNOWN, "hq")
    youtube.down = True
    cache.clock = lambda: start + KEEP_S
    assert cache.get(KNOWN, "hq") == b"hq-image"  # YouTube down: the stale copy
    cache.clock = lambda: start + KEEP_S + 60
    assert cache.get(KNOWN, "hq") == b"hq-image"  # waiting: the stale copy, YouTube not asked
    assert youtube.calls == [(KNOWN, "hq"), (KNOWN, "hq")]


def test_cache_tells_only_youtubes_answer_that_its_missing(
    tmp_path: Path, youtube: FakeYouTube
) -> None:
    told: list[str] = []
    cache = ThumbnailCache(tmp_path, youtube, on_missing=told.append)
    cache.get(UNKNOWN, "hq")
    cache.get(UNKNOWN, "hq")  # remembered, not asked
    cache.get(KNOWN, "hq")
    assert told == [UNKNOWN]


def test_cache_holds_only_finished_images(tmp_path: Path, youtube: FakeYouTube) -> None:
    cache = ThumbnailCache(tmp_path, youtube)
    cache.get(KNOWN, "hq")
    cache.get(KNOWN, "mq")
    cache.get(UNKNOWN, "hq")
    names = sorted(p.name for p in tmp_path.iterdir())
    assert names == [f"{KNOWN}_hq.jpg", f"{KNOWN}_mq.jpg", f"{UNKNOWN}_hq.missing"]  # no .tmp


# fetch_from_youtube, with YouTube's image server faked


class FakeResponse(io.BytesIO):
    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


def http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("https://i.ytimg.com/", code, "error", Message(), None)


def test_fetch_from_youtube_returns_the_image(monkeypatch: pytest.MonkeyPatch) -> None:
    urls: list[str] = []

    def fake(url: str, timeout: float) -> FakeResponse:
        urls.append(url)
        return FakeResponse(b"jpeg")

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    assert fetch_from_youtube(KNOWN, "mq") == b"jpeg"
    assert urls == [f"https://i.ytimg.com/vi/{KNOWN}/mqdefault.jpg"]


@pytest.mark.parametrize(
    ("error", "result"),
    [
        (http_error(404), None),
        (http_error(500), Unavailable),
        (http_error(429), Unavailable),
        (urllib.error.URLError("no route"), Unavailable),
        (TimeoutError("timed out"), Unavailable),
    ],
)
def test_fetch_from_youtube_errors(
    monkeypatch: pytest.MonkeyPatch, error: Exception, result: type[Exception] | None
) -> None:
    def fake(url: str, timeout: float) -> FakeResponse:
        raise error

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    if result is None:
        assert fetch_from_youtube(KNOWN, "hq") is None
    else:
        with pytest.raises(result):
            fetch_from_youtube(KNOWN, "hq")
