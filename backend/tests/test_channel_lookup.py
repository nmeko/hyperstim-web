from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from hyperstim_api.analysis import AnalysisError, parse_channel
from hyperstim_api.channel_lookup import Link, parse_link
from tests.conftest import FakePipeline, video_row, write_dataset

CHANNEL = "UCaaaaaaaaaaaaaaaaaaaaaa"
DATASET_CHANNEL = "UCdddddddddddddddddddddd"


@pytest.mark.parametrize(
    ("text", "link"),
    [
        (f"https://www.youtube.com/channel/{CHANNEL}", Link("channel", CHANNEL)),
        (f"youtube.com/channel/{CHANNEL}/videos", Link("channel", CHANNEL)),
        (
            "https://www.youtube.com/@KitAndKate",
            Link("page", "https://www.youtube.com/@KitAndKate"),
        ),
        ("m.youtube.com/@KitAndKate/featured", Link("page", "https://www.youtube.com/@KitAndKate")),
        (
            "https://www.youtube.com/c/KitAndKate",
            Link("page", "https://www.youtube.com/c/KitAndKate"),
        ),
        (
            "https://www.youtube.com/user/kitkate",
            Link("page", "https://www.youtube.com/user/kitkate"),
        ),
        # Video links aren't taken (plan 008).
        ("https://www.youtube.com/watch?v=Bfy4GDe4-gI&t=3", None),
        ("https://youtu.be/Bfy4GDe4-gI", None),
        ("youtube.com/shorts/Bfy4GDe4-gI", None),
        ("kit and kate", None),
        ("https://example.com/@KitAndKate", None),
        ("https://www.youtube.com/channel/nope", None),
        ("https://www.youtube.com/", None),
    ],
)
def test_parse_link(text: str, link: Link | None) -> None:
    assert parse_link(text) == link


def test_parse_channel() -> None:
    assert parse_channel('{"channel_id": "UCx", "channel": "Kit"}\n') == ("UCx", "Kit")
    with pytest.raises(AnalysisError):
        parse_channel('{"channel_id": null}')


def lookup(client: TestClient, url: str) -> Any:  # the test client's response
    return client.get("/api/channel-lookup", params={"url": url})


@pytest.fixture
def real_ids(tmp_path: Path, make_client: Callable[..., TestClient]) -> TestClient:
    """A dataset with YouTube-shaped IDs, so links to it parse."""
    rows = [video_row(f"vidvidvid0{i}", DATASET_CHANNEL, float(i)) for i in range(3)]
    return make_client(write_dataset(tmp_path / "videos.tsv", rows))


def test_channel_link_needs_no_youtube(real_ids: TestClient, pipeline: FakePipeline) -> None:
    body = lookup(real_ids, f"https://www.youtube.com/channel/{DATASET_CHANNEL}").json()
    assert body == {
        "channelId": DATASET_CHANNEL,
        "name": f"Channel {DATASET_CHANNEL}",
        "inDataset": True,
        "videoCount": 3,
    }
    # Not in the dataset: no name, and still no YouTube call.
    body = lookup(real_ids, f"https://www.youtube.com/channel/{CHANNEL}").json()
    assert body == {"channelId": CHANNEL, "name": None, "inDataset": False, "videoCount": 0}
    assert pipeline.channel_calls == []


def test_handle_asks_youtube_once_and_counts_toward_the_limit(
    dataset_path: Path, make_client: Callable[..., TestClient], pipeline: FakePipeline
) -> None:
    client = make_client(dataset_path, limit_per_ip=1)
    pipeline.links["https://www.youtube.com/@KitAndKate"] = (CHANNEL, "Kit and Kate")
    body = lookup(client, "https://www.youtube.com/@KitAndKate").json()
    assert body == {
        "channelId": CHANNEL,
        "name": "Kit and Kate",
        "inDataset": False,
        "videoCount": 0,
    }
    # Cached: no second call, and it doesn't count again.
    assert lookup(client, "youtube.com/@KitAndKate/videos").status_code == 200
    assert pipeline.channel_calls == ["https://www.youtube.com/@KitAndKate"]
    # The limit (1) is used up: a new lookup, or a new analysis, is refused.
    assert lookup(client, "https://www.youtube.com/@Other").status_code == 429
    assert client.post("/api/analyses/aaaaaaaaaaa").status_code == 429


def test_unknown_channel_and_bad_links(client: TestClient) -> None:
    assert lookup(client, "https://www.youtube.com/@Nobody").status_code == 404
    assert lookup(client, "kit and kate").status_code == 422
    assert lookup(client, "https://youtu.be/Bfy4GDe4-gI").status_code == 422
    assert client.get("/api/channel-lookup").status_code == 422
