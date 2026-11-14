import asyncio
import logging
import re
import threading
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hyperstim_api.config import load_settings
from hyperstim_api.scoring import FEATURES, build_pools, percentile_rank
from tests.conftest import ORIGIN, VIDEOS, Row, video_row, write_dataset

N = len(VIDEOS)


def pct(rank_from_bottom: int) -> float:
    """Expected score of the video with the given 0-based rank from the lowest value."""
    return round(100 * rank_from_bottom / (N - 1), 1)


def test_health(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}


def test_access_log_is_off(client: TestClient) -> None:
    """uvicorn would log every visitor's IP; the policy promises only the proxy's 14-day logs."""
    assert logging.getLogger("uvicorn.access").disabled


def test_meta(client: TestClient) -> None:
    assert client.get("/api/meta").json() == {
        "videoCount": N,
        "channelCount": 3,
        "updatedAt": "2026-09-01",
        "addedLast7Days": 0,
        "channelCount7DaysAgo": 3,
        "lastAddedAt": None,
        "referenceCount": N,
        "channelsCheckedAt": None,
    }


def summary(item: dict[str, object]) -> dict[str, object]:
    return {k: item[k] for k in ("id", "rank", "score")}


def test_videos_most_stimulating_first(client: TestClient) -> None:
    body = client.get("/api/videos", params={"sort": "score", "limit": 3}).json()
    assert body["total"] == N
    first = body["items"][0]
    assert {k: v for k, v in first.items() if k != "features"} == {
        "id": "vid-c1",
        "title": "Title of vid-c1",
        "channelId": "chan-c",
        "channel": "Channel chan-c",
        "category": "music",
        "rank": 1,
        "score": 100.0,
    }
    assert [f["key"] for f in first["features"]] == list(FEATURES)
    assert first["features"][0] == {"key": FEATURES[0], "value": 11.0, "percentile": 100.0}
    assert [summary(v) for v in body["items"][1:]] == [
        {"id": "vid-a1", "rank": 2, "score": pct(10)},
        {"id": "vid-a2", "rank": 3, "score": pct(9)},
    ]


def test_videos_least_stimulating_first(client: TestClient) -> None:
    body = client.get("/api/videos", params={"order": "asc", "limit": 3}).json()
    assert [summary(v) for v in body["items"]] == [
        {"id": "vid-c2", "rank": 1, "score": 0.0},  # counted from the calm end
        {"id": "vid-b5", "rank": 2, "score": pct(1)},
        {"id": "vid-b4", "rank": 3, "score": pct(2)},
    ]


def test_videos_default_sort_and_limit(client: TestClient) -> None:
    body = client.get("/api/videos").json()
    assert len(body["items"]) == N  # fewer than the default limit of 20
    assert body["items"][0]["id"] == "vid-c1"


def test_video_ties_keep_a_stable_order(
    tmp_path: Path, make_client: Callable[[Path], TestClient]
) -> None:
    rows = [video_row(v, "chan", 1.0) for v in ("vid-y", "vid-x", "vid-z")]
    client = make_client(write_dataset(tmp_path / "ties.tsv", rows))
    desc = [v["id"] for v in client.get("/api/videos").json()["items"]]
    asc = [v["id"] for v in client.get("/api/videos", params={"order": "asc"}).json()["items"]]
    assert desc == ["vid-x", "vid-y", "vid-z"]
    assert asc == list(reversed(desc))


def test_scores_are_percentiles_of_the_composite(
    tmp_path: Path, make_client: Callable[[Path], TestClient]
) -> None:
    # Only cuts_per_min differs; the 11 equal features put every video at 100 for them,
    # so the composites bunch up (91.7, 95.8, 100) while the scores still span 0-100.
    rows = []
    for video_id, cuts in (("vid-1", 1.0), ("vid-2", 2.0), ("vid-3", 3.0)):
        row = video_row(video_id, "chan", 5.0)
        row["cuts_per_min"] = str(cuts)
        rows.append(row)
    client = make_client(write_dataset(tmp_path / "videos.tsv", rows))
    items = client.get("/api/videos", params={"order": "asc"}).json()["items"]
    assert [v["score"] for v in items] == [0.0, 50.0, 100.0]


def test_channels_ranked_by_mean_score(client: TestClient) -> None:
    body = client.get("/api/channels", params={"sort": "score", "limit": 3, "minVideos": 5}).json()
    assert body["total"] == 2  # chan-c has only 2 videos
    assert [{k: v for k, v in c.items() if k != "features"} for c in body["items"]] == [
        {"id": "chan-a", "name": "Channel chan-a", "score": pct(8), "videoCount": 5, "rank": 1},
        {"id": "chan-b", "name": "Channel chan-b", "score": pct(3), "videoCount": 5, "rank": 2},
    ]
    assert [f["key"] for f in body["items"][0]["features"]] == list(FEATURES)


def test_channels_least_stimulating_first(client: TestClient) -> None:
    body = client.get("/api/channels", params={"order": "asc", "limit": 1, "minVideos": 5}).json()
    assert [(c["name"], c["rank"]) for c in body["items"]] == [("Channel chan-b", 1)]
    assert body["total"] == 2


def test_channels_ranks_every_channel_by_default(client: TestClient) -> None:
    body = client.get("/api/channels").json()
    assert body["total"] == 3
    assert [c["name"] for c in body["items"]][1] == "Channel chan-c"  # mean of 100 and 0 = 50


@pytest.mark.parametrize(
    ("path", "params"),
    [
        ("/api/videos", {"sort": "score_desc"}),
        ("/api/videos", {"sort": "toString"}),
        ("/api/videos", {"sort": "lufs|score"}),
        ("/api/videos", {"order": "up"}),
        ("/api/videos", {"category": "sports"}),
        ("/api/videos", {"category": "play & activity"}),
        ("/api/videos", {"q": ""}),
        ("/api/videos", {"q": "a" * 101}),
        ("/api/videos", {"offset": -1}),
        ("/api/videos", {"limit": 0}),
        ("/api/videos", {"limit": 101}),
        ("/api/videos", {"limit": "many"}),
        ("/api/channels", {"sort": "name"}),
        ("/api/channels", {"order": "asc ", "category": "music"}),
        ("/api/channels", {"minVideos": 0}),
        ("/api/channels", {"minVideos": 1001}),
    ],
)
def test_bad_params_are_rejected(
    client: TestClient, path: str, params: dict[str, str | int]
) -> None:
    assert client.get(path, params=params).status_code == 422


def test_rows_without_id_or_features_are_skipped(
    tmp_path: Path, make_client: Callable[[Path], TestClient]
) -> None:
    rows = [
        video_row("vid-1", "chan", 1.0),
        video_row("vid-2", "chan", 2.0),
        video_row("", "chan", 3.0),
        video_row("vid-empty", "chan", None),
    ]
    client = make_client(write_dataset(tmp_path / "videos.tsv", rows))
    assert client.get("/api/meta").json()["videoCount"] == 2


def test_cors_allows_only_the_configured_origin(client: TestClient) -> None:
    allowed = client.get("/api/meta", headers={"Origin": ORIGIN})
    other = client.get("/api/meta", headers={"Origin": "https://example.org"})
    assert allowed.headers["access-control-allow-origin"] == ORIGIN
    assert "access-control-allow-origin" not in other.headers


def test_settings_require_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATASET_PATH", raising=False)
    monkeypatch.setenv("CORS_ORIGIN", ORIGIN)
    with pytest.raises(RuntimeError, match="DATASET_PATH"):
        load_settings()


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    monkeypatch.setenv("DATASET_PATH", "data/videos.tsv")
    monkeypatch.setenv("CORS_ORIGIN", ORIGIN + "/")
    monkeypatch.setenv("ANALYSIS_DIR", "analysis")
    monkeypatch.setenv("THUMBNAIL_DIR", "thumbnails")
    monkeypatch.delenv("YTDLP_COOKIES", raising=False)
    monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)
    monkeypatch.delenv("ANALYSIS_LIMIT_PER_IP", raising=False)
    monkeypatch.delenv("ANALYSIS_LIMIT_PER_DAY", raising=False)
    monkeypatch.delenv("API_DOCS", raising=False)
    return monkeypatch


def test_settings_from_env(env: pytest.MonkeyPatch) -> None:
    settings = load_settings()
    assert settings.dataset_path == Path("data/videos.tsv")
    assert settings.cors_origin == ORIGIN
    assert settings.analysis_dir == Path("analysis")
    assert settings.thumbnail_dir == Path("thumbnails")
    assert settings.ytdlp_cookies is None
    assert settings.youtube_api_key is None  # no made-for-kids check
    assert settings.analysis_limit_per_ip == 20  # unset: limited all the same
    assert settings.analysis_limit_per_day == 1000
    assert settings.api_docs


@pytest.mark.parametrize("name", ["ANALYSIS_DIR", "THUMBNAIL_DIR"])
def test_settings_require_the_data_folders(env: pytest.MonkeyPatch, name: str) -> None:
    env.delenv(name)
    with pytest.raises(RuntimeError, match=name):
        load_settings()


def test_settings_optional_analysis_values(env: pytest.MonkeyPatch) -> None:
    env.setenv("YTDLP_COOKIES", "/secret/cookies.txt")
    env.setenv("ANALYSIS_LIMIT_PER_IP", "0")
    env.setenv("ANALYSIS_LIMIT_PER_DAY", "0")
    env.setenv("API_DOCS", "0")
    env.setenv("YOUTUBE_API_KEY", " key ")
    settings = load_settings()
    assert settings.ytdlp_cookies == Path("/secret/cookies.txt")
    assert settings.youtube_api_key == "key"
    assert settings.analysis_limit_per_ip == 0
    assert settings.analysis_limit_per_day == 0
    assert not settings.api_docs


@pytest.mark.parametrize("name", ["ANALYSIS_LIMIT_PER_IP", "ANALYSIS_LIMIT_PER_DAY"])
@pytest.mark.parametrize("raw", ["-1", "five", "2.5"])
def test_settings_reject_a_bad_limit(env: pytest.MonkeyPatch, name: str, raw: str) -> None:
    env.setenv(name, raw)
    with pytest.raises(RuntimeError, match=name):
        load_settings()


@pytest.mark.parametrize("raw", ["yes", "true", "2"])
def test_settings_reject_a_bad_flag(env: pytest.MonkeyPatch, raw: str) -> None:
    env.setenv("API_DOCS", raw)
    with pytest.raises(RuntimeError, match="API_DOCS"):
        load_settings()


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_api_docs_can_be_turned_off(
    dataset_path: Path, make_client: Callable[..., TestClient], path: str
) -> None:
    assert make_client(dataset_path).get(path).status_code == 200
    assert make_client(dataset_path, api_docs=False).get(path).status_code == 404


DETAIL_IDS = ("aaaaaaaaaa1", "aaaaaaaaaa2", "aaaaaaaaaa3")


def detail_rows() -> list[Row]:
    """Feature i of video n is n * (i + 1); the last video has no motion_frac."""
    rows = []
    for n, video_id in enumerate(DETAIL_IDS, start=1):
        row = video_row(video_id, "UC-chan", 0.0)
        row.update({name: str(n * (i + 1)) for i, name in enumerate(FEATURES)})
        rows.append(row)
    rows[-1]["motion_frac"] = ""
    return rows


@pytest.fixture
def detail_client(tmp_path: Path, make_client: Callable[[Path], TestClient]) -> TestClient:
    return make_client(write_dataset(tmp_path / "videos.tsv", detail_rows()))


def test_video_detail(detail_client: TestClient) -> None:
    body = detail_client.get("/api/videos/aaaaaaaaaa2").json()
    assert {k: v for k, v in body.items() if k != "features"} == {
        "id": "aaaaaaaaaa2",
        "title": "Title of aaaaaaaaaa2",
        "channelId": "UC-chan",
        "channel": "Channel UC-chan",
        "score": 50.0,
        "channelInDataset": True,
    }
    assert [f["key"] for f in body["features"]] == list(FEATURES)
    assert body["features"][0] == {"key": "cuts_per_min", "value": 2.0, "percentile": 50.0}
    # motion_frac is missing for the third video, so the second is the pool's top.
    assert body["features"][4] == {"key": "motion_frac", "value": 10.0, "percentile": 100.0}


def test_video_detail_missing_value_is_null(detail_client: TestClient) -> None:
    features = detail_client.get("/api/videos/aaaaaaaaaa3").json()["features"]
    assert features[4] == {"key": "motion_frac", "value": None, "percentile": None}
    assert all(f["value"] is not None for i, f in enumerate(features) if i != 4)


def test_video_detail_percentiles_match_scoring(detail_client: TestClient) -> None:
    rows = detail_rows()
    pools = build_pools({k: float(row[k]) if row[k] else None for k in FEATURES} for row in rows)
    for row in rows:
        features = detail_client.get(f"/api/videos/{row['video_id']}").json()["features"]
        for f in features:
            expected = None if f["value"] is None else percentile_rank(f["value"], pools[f["key"]])
            assert f["percentile"] == (None if expected is None else round(expected, 1))


def test_video_detail_unknown_id(detail_client: TestClient) -> None:
    response = detail_client.get("/api/videos/zzzzzzzzzzz")
    assert response.status_code == 404
    assert response.json() == {"detail": "Video not found"}


@pytest.mark.parametrize("video_id", ["short", "aaaaaaaaaa12", "aaaaaaaaa.1", "aaaaaaaaa%201"])
def test_video_detail_malformed_id(detail_client: TestClient, video_id: str) -> None:
    assert detail_client.get(f"/api/videos/{video_id}").status_code == 422


def test_counts_of_zero_show_as_percentile_0(
    tmp_path: Path, make_client: Callable[[Path], TestClient]
) -> None:
    """Shown values only: the score still uses the pool percentiles."""
    rows = detail_rows()
    channel_id = "UC" + "c" * 22
    for row in rows:
        row["channel_id"] = channel_id
    for row in rows[:2]:
        row["cuts_per_min"] = "0"
    # A clip without sound: no loudness, so no loudness jumps either.
    rows[0]["loudness_jumps_per_min"] = rows[0]["lufs"] = ""
    client = make_client(write_dataset(tmp_path / "videos.tsv", rows))
    features = {f["key"]: f for f in client.get("/api/videos/aaaaaaaaaa1").json()["features"]}
    # In the pool the two zeros tie at 50; shown as 0.
    assert features["cuts_per_min"] == {"key": "cuts_per_min", "value": 0.0, "percentile": 0.0}
    assert features["loudness_jumps_per_min"] == {
        "key": "loudness_jumps_per_min",
        "value": 0.0,
        "percentile": 0.0,
    }
    assert features["lufs"] == {"key": "lufs", "value": None, "percentile": None}
    channel = client.get(f"/api/channels/{channel_id}").json()
    chan = {f["key"]: f for f in channel["features"]}
    assert chan["cuts_per_min"]["percentile"] == round((0 + 0 + 100) / 3, 1)
    # The score is unchanged: video 1's composite still ranks lowest of the three.
    scores = [client.get(f"/api/videos/{i}").json()["score"] for i in DETAIL_IDS]
    assert scores == sorted(scores)


CHAN_A = "UC" + "a" * 22
CHAN_B = "UC" + "b" * 22
# (video ID, channel, value of every feature, publish date); rows out of date order.
CHANNEL_VIDEOS = [
    ("aaaaaaaaaa1", CHAN_A, 3.0, "2022-07-08"),
    ("aaaaaaaaaa2", CHAN_A, 1.0, "2018-02-03"),
    ("aaaaaaaaaa3", CHAN_A, 2.0, "2020-05-01"),
    ("bbbbbbbbbb1", CHAN_B, 4.0, "2021-01-01"),
    ("bbbbbbbbbb2", CHAN_B, 5.0, "2021-01-01"),
]


def channel_rows() -> list[Row]:
    """motion_frac is missing for one video of channel A; lufs for all of them."""
    rows = [video_row(*v) for v in CHANNEL_VIDEOS]
    rows[0]["motion_frac"] = ""
    for row in rows[:3]:
        row["lufs"] = ""
    return rows


def pct_of(rank_from_bottom: float, n: int) -> float:
    return round(100 * rank_from_bottom / (n - 1), 1)


@pytest.fixture
def channel_client(tmp_path: Path, make_client: Callable[[Path], TestClient]) -> TestClient:
    return make_client(write_dataset(tmp_path / "videos.tsv", channel_rows()))


def test_channel_detail(channel_client: TestClient) -> None:
    body = channel_client.get(f"/api/channels/{CHAN_A}").json()
    assert {k: v for k, v in body.items() if k not in ("features", "videos")} == {
        "id": CHAN_A,
        "name": f"Channel {CHAN_A}",
        "videoCount": 3,
        "score": pct_of(1, 5),  # mean of 0, 25 and 50
    }
    assert [f["key"] for f in body["features"]] == list(FEATURES)
    videos = body["videos"]  # oldest first
    assert [v["id"] for v in videos] == ["aaaaaaaaaa2", "aaaaaaaaaa3", "aaaaaaaaaa1"]
    assert videos[0] == {
        "id": "aaaaaaaaaa2",
        "title": "Title of aaaaaaaaaa2",
        "publishedAt": "2018-02-03",
        "score": 0.0,
        "features": channel_client.get("/api/videos/aaaaaaaaaa2").json()["features"],
    }


def test_channel_features_are_means_over_measured_videos(channel_client: TestClient) -> None:
    body = channel_client.get(f"/api/channels/{CHAN_A}").json()
    features = {f["key"]: f for f in body["features"]}
    # Values 1, 2, 3 rank 0, 1, 2 of 5: percentiles 0, 25, 50.
    assert features["cuts_per_min"] == {"key": "cuts_per_min", "value": 2.0, "percentile": 25.0}
    # motion_frac is missing for the video with 3.0: the mean of 1 and 2, ranked 0 and 1 of 4.
    rows = channel_rows()
    pool = sorted(float(r["motion_frac"]) for r in rows if r["motion_frac"])
    expected = (percentile_rank(1.0, pool) or 0) / 2 + (percentile_rank(2.0, pool) or 0) / 2
    assert features["motion_frac"] == {
        "key": "motion_frac",
        "value": 1.5,
        "percentile": round(expected, 1),
    }
    # No video of the channel has lufs.
    assert features["lufs"] == {"key": "lufs", "value": None, "percentile": None}


def test_channel_score_is_the_mean_of_its_video_scores(channel_client: TestClient) -> None:
    body = channel_client.get(f"/api/channels/{CHAN_B}").json()
    scores = [v["score"] for v in body["videos"]]
    assert body["score"] == round(sum(scores) / len(scores), 1)
    assert [v["id"] for v in body["videos"]] == ["bbbbbbbbbb1", "bbbbbbbbbb2"]  # same day: by id


def test_channel_detail_unknown_id(channel_client: TestClient) -> None:
    response = channel_client.get("/api/channels/UC" + "z" * 22)
    assert response.status_code == 404
    assert response.json() == {"detail": "Channel not found"}


@pytest.mark.parametrize(
    "channel_id", ["UC" + "a" * 21, "UC" + "a" * 23, "XY" + "a" * 22, "UC" + "a" * 21 + "."]
)
def test_channel_detail_malformed_id(channel_client: TestClient, channel_id: str) -> None:
    assert channel_client.get(f"/api/channels/{channel_id}").status_code == 422


def test_dataset_channel_ids_match_the_pattern() -> None:
    from hyperstim_api.dataset import load_dataset
    from hyperstim_api.main import CHANNEL_ID_PATTERN

    dataset = load_dataset(Path(__file__).parents[1] / "data" / "videos.tsv")
    assert all(re.match(CHANNEL_ID_PATTERN, c.id) for c in dataset.channels)


def test_shutdown_stops_the_worker_threads_even_after_an_error(
    tmp_path: Path, dataset_path: Path, make_client: Callable[..., TestClient]
) -> None:
    app = make_client(dataset_path, usage_dir=tmp_path / "usage").app
    assert isinstance(app, FastAPI)

    def running() -> set[str]:
        return {t.name for t in threading.enumerate()} & {"analysis", "usage"}

    async def run() -> None:
        async with app.router.lifespan_context(app):
            assert running() == {"analysis", "usage"}
            raise RuntimeError("the app failed while running")

    with pytest.raises(RuntimeError):
        asyncio.run(run())
    assert running() == set()
