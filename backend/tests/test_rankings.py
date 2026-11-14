"""Rankings by score or feature, category filter, search and paging (plan 007)."""

import random
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hyperstim_api.dataset import EVENT_FEATURES
from hyperstim_api.ranking import CRITERIA, Added, Order, Ranking, fold, rank_value
from hyperstim_api.scoring import FEATURES
from tests.conftest import Row, video_row, write_dataset

# (id, channel, value of every feature, category); overrides below.
VIDEOS = [
    ("vid-1", "chan-m", 9.0, "music"),
    ("vid-2", "chan-m", 7.0, "music"),
    ("vid-3", "chan-m", 5.0, "narrative"),
    ("vid-4", "chan-n", 8.0, "narrative"),
    ("vid-5", "chan-n", 6.0, "narrative"),
    ("vid-6", "chan-n", 4.0, "play & activity"),
]


def rows() -> list[Row]:
    out = []
    for video_id, channel_id, value, category in VIDEOS:
        out.append(video_row(video_id, channel_id, value, category=category))
    by_id = {r["video_id"]: r for r in out}
    by_id["vid-1"]["cuts_per_min"] = "0"  # no cuts: a count of 0
    by_id["vid-5"]["cuts_per_min"] = "0.0"
    by_id["vid-4"]["lufs"] = ""  # not measured
    by_id["vid-2"]["title"] = "Café Crayón Song"
    for r in out:
        if r["channel_id"] == "chan-n":
            r["channel_title"] = "Zoë's Zoo"
    return out


@pytest.fixture
def client(tmp_path: Path, make_client: Callable[..., TestClient]) -> TestClient:
    return make_client(write_dataset(tmp_path / "videos.tsv", rows()))


def videos(client: TestClient, **params: str | int) -> tuple[list[tuple[str, int | None]], int]:
    response = client.get("/api/videos", params={"limit": 100, **params})
    assert response.status_code == 200, response.text
    body = response.json()
    return [(v["id"], v["rank"]) for v in body["items"]], body["total"]


def channels(client: TestClient, **params: str | int) -> tuple[list[tuple[str, int | None]], int]:
    response = client.get("/api/channels", params={"limit": 100, "minVideos": 1, **params})
    assert response.status_code == 200, response.text
    body = response.json()
    return [(c["id"], c["rank"]) for c in body["items"]], body["total"]


def test_counts_of_zero_rank_last_and_share_a_rank(client: TestClient) -> None:
    desc, total = videos(client, sort="cuts_per_min")
    assert total == 6
    assert desc == [
        ("vid-4", 1),
        ("vid-2", 2),
        ("vid-3", 3),
        ("vid-6", 4),
        ("vid-1", 5),  # a count of 0 (percentile 0), ties by id
        ("vid-5", 5),
    ]
    asc, _ = videos(client, sort="cuts_per_min", order="asc")
    # Reversed, ranks counted from the calm end.
    assert asc == [
        ("vid-5", 1),
        ("vid-1", 1),
        ("vid-6", 3),
        ("vid-3", 4),
        ("vid-2", 5),
        ("vid-4", 6),
    ]


def test_missing_values_are_unranked(client: TestClient) -> None:
    desc, _ = videos(client, sort="lufs")
    assert desc[-1] == ("vid-4", None)
    assert [rank for _, rank in desc[:-1]] == [1, 2, 3, 4, 5]
    # A zero on a feature that isn't per minute is a value like any other.
    assert "lufs" not in EVENT_FEATURES


@pytest.mark.parametrize("criterion", CRITERIA)
def test_every_criterion_ranks_by_percentile_with_ties_by_id(
    client: TestClient, criterion: str
) -> None:
    body = client.get("/api/videos", params={"sort": criterion, "limit": 100}).json()
    ranked = [v for v in body["items"] if v["rank"] is not None]

    def value(v: dict[str, object]) -> float:
        if criterion == "score":
            return float(v["score"])  # type: ignore[arg-type]
        features = v["features"]
        assert isinstance(features, list)
        return float(next(f["percentile"] for f in features if f["key"] == criterion))

    def ranks(rows: list[dict[str, object]]) -> list[int]:
        """Positions, with equal values sharing the first one's rank."""
        out: list[int] = []
        for i, v in enumerate(rows):
            out.append(out[-1] if i > 0 and value(v) == value(rows[i - 1]) else i + 1)
        return out

    assert [v["rank"] for v in ranked] == ranks(ranked)
    keys = [(-value(v), v["id"]) for v in ranked]
    assert keys == sorted(keys)
    asc = client.get(
        "/api/videos", params={"sort": criterion, "order": "asc", "limit": 100}
    ).json()["items"]
    assert [v["id"] for v in asc[: len(ranked)]] == [v["id"] for v in reversed(ranked)]
    assert [v["rank"] for v in asc[: len(ranked)]] == ranks(asc[: len(ranked)])


@pytest.mark.parametrize("criterion", ["score", "cuts_per_min"])
def test_category_ranks_videos_among_their_category(client: TestClient, criterion: str) -> None:
    everything, _ = videos(client, sort=criterion)
    narrative, total = videos(client, sort=criterion, category="narrative")
    assert total == 3
    expected = [id for id, _ in everything if id in {"vid-3", "vid-4", "vid-5"}]
    assert [id for id, _ in narrative] == expected
    ranked = [rank for _, rank in narrative if rank is not None]
    assert ranked == list(range(1, len(ranked) + 1))
    assert videos(client, sort=criterion, category="")[1] == 6  # empty = all
    play, total = videos(client, sort=criterion, category="play")
    assert (play, total) == ([("vid-6", 1)], 1)


def test_category_lists_channels_with_a_video_in_it_and_keeps_their_scores(
    client: TestClient,
) -> None:
    all_channels = client.get("/api/channels", params={"minVideos": 1}).json()["items"]
    scores = {c["id"]: c["score"] for c in all_channels}
    assert channels(client, category="music") == ([("chan-m", 1)], 1)
    assert channels(client, category="play") == ([("chan-n", 1)], 1)
    assert channels(client, category="narrative")[1] == 2
    body = client.get("/api/channels", params={"minVideos": 1, "category": "play"}).json()
    assert body["items"][0]["score"] == scores["chan-n"]  # whole-channel score
    assert body["items"][0]["videoCount"] == 3


def test_channels_need_min_videos(client: TestClient) -> None:
    assert channels(client, minVideos=4) == ([], 0)
    assert channels(client, minVideos=3)[1] == 2


def test_search_ignores_case_and_accents_and_keeps_ranks(client: TestClient) -> None:
    everything = dict(videos(client)[0])
    for q in ("cafe crayon", "CAFÉ", "crayón so"):
        assert videos(client, q=q) == ([("vid-2", everything["vid-2"])], 1)
    assert videos(client, q="nothing like it") == ([], 0)
    calm_first = dict(videos(client, order="asc")[0])
    assert videos(client, q="cafe", order="asc") == ([("vid-2", calm_first["vid-2"])], 1)


def test_search_matches_a_videos_channel_name(client: TestClient) -> None:
    found, total = videos(client, q="zoe")
    assert total == 3
    assert {id for id, _ in found} == {"vid-4", "vid-5", "vid-6"}


def test_search_channels_by_name(client: TestClient) -> None:
    everything = dict(channels(client)[0])
    assert channels(client, q="ZOË") == ([("chan-n", everything["chan-n"])], 1)
    assert channels(client, q="cafe") == ([], 0)  # a video title, not a channel name


def test_search_matches_an_exact_id_and_keeps_its_rank(client: TestClient) -> None:
    # A pasted link is searched by its ID; vid-2's title and chan-n's name don't contain it.
    everything = dict(videos(client)[0])
    assert videos(client, q="vid-2") == ([("vid-2", everything["vid-2"])], 1)
    assert videos(client, q="vid-2", category="narrative") == ([], 0)
    by_channel = dict(channels(client)[0])
    assert channels(client, q="chan-n") == ([("chan-n", by_channel["chan-n"])], 1)


def test_search_with_category(client: TestClient) -> None:
    found, total = videos(client, q="zoe", category="narrative")
    assert total == 2
    assert {id for id, _ in found} == {"vid-4", "vid-5"}


def test_offset_and_limit(client: TestClient) -> None:
    everything, _ = videos(client)
    body = client.get("/api/videos", params={"offset": 2, "limit": 2}).json()
    assert [(v["id"], v["rank"]) for v in body["items"]] == everything[2:4]
    assert body["total"] == 6
    beyond = client.get("/api/videos", params={"offset": 50}).json()
    assert beyond == {"items": [], "total": 6, "asOf": "2026-09-01T00:00:00Z"}


def test_unknown_category_in_the_dataset_is_an_error(
    tmp_path: Path, make_client: Callable[..., TestClient]
) -> None:
    path = write_dataset(tmp_path / "videos.tsv", [video_row("vid-1", "c", 1.0, category="x")])
    with pytest.raises(ValueError, match="unknown category"):
        make_client(path)


@dataclass(frozen=True)
class Feat:
    key: str
    value: float | None
    percentile: float | None


@dataclass(frozen=True)
class Item:
    id: str
    name: str
    score: float
    features: tuple[Feat, ...]
    added_at: str
    current: bool


def random_items(seed: int) -> list[Item]:
    """Rows with many ties, missing values, names, add times, and some not in the default view."""
    rng = random.Random(seed)
    out = []
    for i in range(60):
        feats = []
        for key in FEATURES:
            value = rng.choice([None, 0.0, 0.0, *(float(rng.randint(1, 8)) for _ in range(4))])
            feats.append(Feat(key, value, value))
        out.append(
            Item(
                id=f"r{rng.randint(0, 10**6):07d}-{i}",
                name=rng.choice(["Cocomelon", "Café", "Blippi", "Zoë"]),
                score=float(rng.randint(0, 9)),
                features=tuple(feats),
                added_at=f"2026-10-{rng.randint(10, 30)}T00:00:00Z",
                current=rng.random() > 0.2,
            )
        )
    return out


def reference_page(
    rows: list[Item],
    criterion: str,
    order: Order,
    keep: Callable[[Item], bool],
    query: str | None,
    offset: int,
    limit: int,
    added: Added | None,
) -> tuple[list[tuple[str, int | None]], int]:
    """Plan 007's rules, the plain way: rank every kept row, then hide and slice."""
    kept = [r for r in rows if keep(r)]
    kept.sort(
        key=lambda r: (rank_value(r, criterion) is None, -(rank_value(r, criterion) or 0), r.id)
    )
    valued = [r for r in kept if rank_value(r, criterion) is not None]
    if order == "asc":
        valued.reverse()
    ranked: list[tuple[Item, int | None]] = []
    for i, r in enumerate(valued):
        tied = i > 0 and rank_value(r, criterion) == rank_value(valued[i - 1], criterion)
        ranked.append((r, ranked[-1][1] if tied else i + 1))
    ranked += [(r, None) for r in kept if rank_value(r, criterion) is None]
    if query:
        ranked = [(r, n) for r, n in ranked if r.id == query or fold(query) in fold(r.name)]
    if added:
        start, end = added
        ranked = [
            (r, n)
            for r, n in ranked
            if (start is None or r.added_at >= start) and (end is None or r.added_at < end)
        ]
    return [(r.id, n) for r, n in ranked[offset : offset + limit]], len(ranked)


@pytest.mark.parametrize("seed", range(5))
def test_both_paths_match_the_rules(seed: int) -> None:
    """The default view (ready-made) and a filtered view give the plain way's pages."""
    rows = random_items(seed)
    ranking = Ranking(rows, lambda r: (r.name,), lambda r: r.added_at, lambda r: r.current)
    in_view: Callable[[Item], bool] = lambda r: r.current  # noqa: E731
    some: Callable[[Item], bool] = lambda r: r.current and r.name != "Blippi"  # noqa: E731
    windows: list[Added | None] = [
        None,
        ("2026-10-20T00:00:00Z", None),
        (None, "2026-10-15T00:00:00Z"),
    ]
    for criterion in CRITERIA:
        for order in ("desc", "asc"):
            for query in (None, "cafe", rows[3].id):
                for added in windows:
                    for offset, limit in ((0, 100), (0, 3), (5, 7)):
                        expected = reference_page(
                            rows, criterion, order, in_view, query, offset, limit, added
                        )
                        page, total = ranking.page(
                            criterion, order, None, query, offset, limit, added
                        )
                        assert ([(r.item.id, r.rank) for r in page], total) == expected
                        expected = reference_page(
                            rows, criterion, order, some, query, offset, limit, added
                        )
                        page, total = ranking.page(
                            criterion, order, some, query, offset, limit, added
                        )
                        assert ([(r.item.id, r.rank) for r in page], total) == expected


def test_fold() -> None:
    assert fold("Café Crayón") == "cafe crayon"
    assert fold("STRASSE Straße") == "strasse strasse"
    assert fold("Song  Maddie\tand  Kids") == "song maddie and kids"


def test_event_features_match_the_frontend() -> None:
    """The counts shown as percentile 0 at zero are the per-minute units in `lib/features.ts`."""
    source = Path(__file__).parents[2] / "frontend" / "src" / "lib" / "features.ts"
    text = source.read_text(encoding="utf-8")
    entries = re.findall(r"^  (\w+): \{(.*?)^  \},", text, re.MULTILINE | re.DOTALL)
    units = {key: re.search(r'unit: "?(\w+)"?', body) for key, body in entries}
    assert set(units) == set(FEATURES)
    per_minute = {key for key, m in units.items() if m and m[1] in ("perMin", "cutsPerMin")}
    assert per_minute == EVENT_FEATURES
