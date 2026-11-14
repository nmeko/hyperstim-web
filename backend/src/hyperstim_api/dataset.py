"""The video dataset, loaded into memory and ranked.

It is the reference set (`data/videos.tsv`, v2's 16,375 videos), which defines every
percentile and score, plus the videos the collector added since and minus the ones it took
out (plan 013). Added videos are scored against the reference set like live checks, so a
video's score never changes as the dataset grows. Removed videos stay in memory with the
time they were removed, so a list can be shown as it was at an earlier time (`as_of`).
"""

import csv
import json
import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from pathlib import Path

from hyperstim_api import scoring
from hyperstim_api.ranking import Added, Order, Ranked, Ranking

# When added (UTC, ISO 8601): from (inclusive) and before (exclusive); None = open.

log = logging.getLogger(__name__)

# The dataset's categories by their API key (the frontend's `lib/categories.ts`).
CATEGORIES: dict[str, str] = {
    "music": "music",
    "narrative": "narrative",
    "play & activity": "play",
    "educational": "educational",
    "gaming": "gaming",
}

# Per-minute counts (plan 004). A count of 0 is the least stimulating value there is, so it shows as
# percentile 0: in the pool thousands of videos tie at 0, and "at or below" puts them in the
# middle (e.g. 60). Shown values only; the score uses the pool percentiles (scoring.py).
EVENT_FEATURES = frozenset(
    {
        "cuts_per_min",
        "palette_change_per_min",
        "lstar_flash_per_min",
        "loudness_jumps_per_min",
        "build_resolve_per_min",
        "loudness_jump_at_cut_per_min",
    }
)

REQUIRED_COLUMNS = (
    "video_id",
    "title",
    "channel_id",
    "channel_title",
    "category",
    "published_at",
    *scoring.FEATURES,
)


@dataclass(frozen=True)
class Feature:
    key: str  # one of scoring.FEATURES
    value: float | None  # raw value; None if not measured
    percentile: float | None  # within the dataset, unrounded; None when value is


@dataclass(frozen=True)
class Video:
    id: str
    title: str
    channel_id: str
    channel: str
    category: str | None  # a CATEGORIES key; None for a video analyzed live
    score: float  # percentile of its composite among the dataset's, unrounded
    features: tuple[Feature, ...]  # the 12, in scoring.FEATURES order
    published_at: str | None  # ISO date; None for a video analyzed live
    added_at: str | None = None  # UTC, ISO 8601, when the collector added it; None: reference set
    removed_at: str | None = None  # when the collector took it out (offline); None: in

    def visible(self, as_of: str | None) -> bool:
        """In the dataset now (`as_of` None), or at the time `as_of` (UTC, ISO 8601)."""
        if as_of is None:
            return self.removed_at is None
        added = self.added_at is None or self.added_at <= as_of
        return added and (self.removed_at is None or self.removed_at > as_of)


@dataclass(frozen=True)
class Channel:
    id: str
    name: str
    score: float  # unrounded mean of its videos' scores
    features: tuple[Feature, ...]  # the 12: mean raw value and mean percentile of its videos
    videos: tuple[Video, ...]  # oldest first; ties by id
    categories: frozenset[str]  # its videos' categories
    added_at: str | None  # when its first video was added; None: it's in the reference set

    @property
    def video_count(self) -> int:
        return len(self.videos)


@dataclass(frozen=True)
class Dataset:
    videos: tuple[Video, ...]  # in the dataset now; highest score first, ties by id
    channels: tuple[Channel, ...]  # highest score first; ties by id
    updated_at: str  # ISO date
    videos_by_id: dict[str, Video]  # also removed ones, so their pages keep working
    channels_by_id: dict[str, Channel]
    pools: scoring.Pools  # the reference set's sorted values per feature
    composite_pool: list[float]  # the reference set's composites, sorted
    video_ranking: Ranking[Video]  # over every video, removed ones too (for `as_of`)
    channel_ranking: Ranking[Channel]
    version: str = ""  # UTC time of the last addition or removal, else the reference set's date
    reference_count: int = 0
    all_videos: tuple[Video, ...] = ()
    reference_at: str = ""  # UTC: when the reference set counts as added (its features date)
    _channels_at: dict[str, Ranking[Channel]] = field(default_factory=dict, compare=False)

    @property
    def channel_count(self) -> int:
        return len(self.channels)

    def current(self, as_of: str | None) -> str | None:
        """`as_of` for a list, None when it's not before the latest change."""
        return None if as_of is None or as_of >= self.version else as_of

    def added_since(self, since: str) -> int:
        """Videos in the dataset now that were added at or after `since`."""
        return sum(1 for v in self.videos if v.added_at is not None and v.added_at >= since)

    def channel_count_at(self, as_of: str) -> int:
        return len({v.channel_id for v in self.all_videos if v.visible(as_of)})

    def last_added_at(self) -> str | None:
        return max((v.added_at for v in self.all_videos if v.added_at), default=None)

    def ranked_videos(
        self,
        sort: str,
        order: Order,
        category: str | None,
        query: str | None,
        offset: int,
        limit: int,
        as_of: str | None = None,
        added: Added | None = None,
    ) -> tuple[list[Ranked[Video]], int]:
        """A page of videos by `sort` (score or a feature), ranked within `category`; as the
        dataset was at `as_of` if given. `added` only hides rows, like `query`."""
        as_of = self.current(as_of)
        # Every video now, in every category: the ranking's ready-made default view.
        default = as_of is None and category is None
        return self.video_ranking.page(
            sort,
            order,
            None
            if default
            else lambda v: v.visible(as_of) and (category is None or v.category == category),
            query,
            offset,
            limit,
            added,
        )

    def ranked_channels(
        self,
        sort: str,
        order: Order,
        category: str | None,
        query: str | None,
        offset: int,
        limit: int,
        min_videos: int,
        as_of: str | None = None,
        added: Added | None = None,
    ) -> tuple[list[Ranked[Channel]], int]:
        """A page of channels with `min_videos`+ videos and at least one in `category`; as the
        dataset was at `as_of` if given. `added` (when a channel's first video was added) only
        hides rows, like `query`."""
        as_of = self.current(as_of)
        ranking = self.channel_ranking if as_of is None else self._channel_ranking_at(as_of)
        return ranking.page(
            sort,
            order,
            lambda c: (
                c.video_count >= min_videos and (category is None or category in c.categories)
            ),
            query,
            offset,
            limit,
            added,
        )

    def _channel_ranking_at(self, as_of: str) -> Ranking[Channel]:
        """Channels as they were at `as_of`, from the videos in the dataset then. Scores never
        change, so this is exactly what a visitor saw at that time."""
        ranking = self._channels_at.get(as_of)
        if ranking is None:
            if len(self._channels_at) >= 16:
                self._channels_at.clear()
            channels = _channels(v for v in self.all_videos if v.visible(as_of))
            ranking = Ranking(channels, _names, _added_at(self.reference_at))
            self._channels_at[as_of] = ranking
        return ranking

    def score_video(
        self, id: str, title: str, channel_id: str, channel: str, features: scoring.Features
    ) -> Video | None:
        """A video outside the dataset, scored against it; the dataset is unchanged.

        None if it has no feature value.
        """
        return _video(
            id, title, channel_id, channel, None, None, features, self.pools, self.composite_pool
        )


def _video(
    id: str,
    title: str,
    channel_id: str,
    channel: str,
    category: str | None,
    published_at: str | None,
    features: scoring.Features,
    pools: scoring.Pools,
    composite_pool: list[float],
) -> Video | None:
    value = scoring.composite(features, pools)
    if value is None:
        return None
    score = scoring.percentile_rank(value, composite_pool)
    if score is None:
        return None
    percentiles = scoring.feature_percentiles(features, pools)
    return Video(
        id=id,
        title=title,
        channel_id=channel_id,
        channel=channel,
        category=category,
        score=score,
        features=tuple(_shown(name, features, percentiles) for name in scoring.FEATURES),
        published_at=published_at,
    )


def _shown(name: str, features: scoring.Features, percentiles: dict[str, float | None]) -> Feature:
    """A feature as the site shows it (see EVENT_FEATURES)."""
    value = features.get(name)
    # A clip without sound has no loudness (2.3 blank), so no loudness jumps either.
    if name == "loudness_jumps_per_min" and value is None and features.get("lufs") is None:
        value = 0.0
    if value == 0 and name in EVENT_FEATURES:
        return Feature(key=name, value=value, percentile=0.0)
    return Feature(key=name, value=value, percentile=percentiles[name])


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _channel(members: list[Video]) -> Channel:
    """A channel from its videos; each feature is the mean over the videos that have it."""
    features = []
    for i, name in enumerate(scoring.FEATURES):
        measured = [v.features[i] for v in members if v.features[i].value is not None]
        features.append(
            Feature(
                key=name,
                value=_mean([f.value for f in measured if f.value is not None]),
                percentile=_mean([f.percentile for f in measured if f.percentile is not None]),
            )
        )
    return Channel(
        id=members[0].channel_id,
        name=next((v.channel for v in members if v.channel.strip()), members[0].channel),
        score=sum(v.score for v in members) / len(members),
        features=tuple(features),
        videos=tuple(sorted(members, key=lambda v: (v.published_at or "", v.id))),
        categories=frozenset(v.category for v in members if v.category is not None),
        added_at=None
        if any(v.added_at is None for v in members)
        else min(v.added_at for v in members if v.added_at is not None),
    )


def _channels(videos: Iterable[Video]) -> list[Channel]:
    """Channels from their videos (in score order), highest score first."""
    by_channel: dict[str, list[Video]] = {}
    for video in videos:
        by_channel.setdefault(video.channel_id, []).append(video)
    channels = [_channel(members) for members in by_channel.values()]
    channels.sort(key=lambda c: (-c.score, c.id))
    return channels


def _names(c: Channel) -> tuple[str]:
    return (c.name,)


def _category(path: Path, raw: str) -> str:
    key = CATEGORIES.get(raw.strip())
    if key is None:
        raise ValueError(f"{path}: unknown category {raw!r}")
    return key


def meta_path(dataset_path: Path) -> Path:
    return dataset_path.with_suffix(".meta.json")


def names_path(dataset_path: Path) -> Path:
    return dataset_path.with_suffix(".channel-names.tsv")


def _channel_name(row: dict[str, str], names: dict[str, str]) -> str:
    """The channel's current name, looked up on YouTube, or the row's own when none is known
    (a row keeps the name its channel had when the video was collected)."""
    name = names.get(row["channel_id"], "")
    return name if name.strip() else row["channel_title"]


def _channel_names(path: Path) -> dict[str, str]:
    """Channel names looked up on YouTube (plan 013, decision 9): ours next to the reference
    set (channels whose videos carry none, and renamed ones), or the collector's (every
    dataset channel, read weekly); optional."""
    if not path.is_file():
        return {}
    with path.open(newline="", encoding="utf-8") as fh:
        return {r["channel_id"]: r["channel_title"] for r in csv.DictReader(fh, delimiter="\t")}


def _left_out(path: Path) -> set[str]:
    """The channels the collector left out for their kids share; optional."""
    if not path.is_file():
        return set()
    with path.open(newline="", encoding="utf-8") as fh:
        return {r["channel_id"] for r in csv.DictReader(fh, delimiter="\t")}


def _float(raw: str | None) -> float | None:
    raw = (raw or "").strip()
    return float(raw) if raw else None


def load_dataset(path: Path, collected_dir: Path | None = None) -> Dataset:
    """The reference set at `path`, plus the collector's files in `collected_dir` if given."""
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"{path}: missing columns {', '.join(missing)}")
        rows = list(reader)
    names = _channel_names(names_path(path))
    if collected_dir is not None:
        names |= _channel_names(collected_dir / NAMES_FILE)  # the collector's are newer

    kept: list[tuple[dict[str, str], dict[str, float | None]]] = []
    skipped = 0
    for row in rows:
        features = {name: _float(row[name]) for name in scoring.FEATURES}
        if not row["video_id"].strip() or all(v is None for v in features.values()):
            skipped += 1
            continue
        kept.append((row, features))

    pools = scoring.build_pools(features for _, features in kept)
    composites = []
    for _, features in kept:
        value = scoring.composite(features, pools)
        assert value is not None  # every kept row has a feature value
        composites.append(value)
    composite_pool = sorted(composites)
    videos = []
    for row, features in kept:
        video = _video(
            row["video_id"].strip(),
            row["title"],
            row["channel_id"],
            _channel_name(row, names),
            _category(path, row["category"]),
            row["published_at"].strip() or None,
            features,
            pools,
            composite_pool,
        )
        assert video is not None  # every kept row has a feature value
        videos.append(video)
    reference_count = len(videos)
    if collected_dir is not None:
        videos = _with_collected(videos, collected_dir, pools, composite_pool, names)
        # Channels left out for their kids share: never there, reference videos too; the
        # pools above keep them, so no score moves (plan 013, decision 1).
        left_out = _left_out(collected_dir / LEFT_OUT_FILE)
        videos = [v for v in videos if v.channel_id not in left_out]
    videos.sort(key=lambda v: (-v.score, v.id))
    current = [v for v in videos if v.removed_at is None]
    channels = _channels(current)
    meta = json.loads(meta_path(path).read_text(encoding="utf-8"))
    # The reference set's date stands for "nothing added or removed yet".
    reference_at = f"{meta['featuresDate']}T00:00:00Z"
    version = max(
        (t for v in videos for t in (v.added_at, v.removed_at) if t is not None),
        default=reference_at,
    )
    log.info(
        "Loaded %d videos (%d in the reference set, %d removed), %d channels from %s "
        "(%d rows skipped: no ID or no feature values)",
        len(current),
        reference_count,
        len(videos) - len(current),
        len(channels),
        path,
        skipped,
    )
    return Dataset(
        videos=tuple(current),
        channels=tuple(channels),
        updated_at=max(meta["featuresDate"], version[:10]),
        videos_by_id={v.id: v for v in videos},
        channels_by_id={c.id: c for c in channels},
        pools=pools,
        composite_pool=composite_pool,
        video_ranking=Ranking(
            videos,
            lambda v: (v.title, v.channel),
            _added_at(reference_at),
            lambda v: v.removed_at is None,
        ),
        channel_ranking=Ranking(channels, _names, _added_at(reference_at)),
        version=version,
        reference_count=reference_count,
        all_videos=tuple(videos),
        reference_at=reference_at,
    )


def _added_at(reference_at: str) -> Callable[[Video | Channel], str]:
    """When a video or channel was added; the reference set's rows count as added on its date."""
    return lambda item: item.added_at or reference_at


NAMES_FILE = "channel-names.tsv"
LEFT_OUT_FILE = "excluded-channels.tsv"


def collected_files(directory: Path) -> list[Path]:
    """The collector's files the dataset is built from (plan 013): `<year>.tsv`, `removed.tsv`,
    `channel-names.tsv` and `excluded-channels.tsv`."""
    files = [
        *directory.glob("[0-9][0-9][0-9][0-9].tsv"),
        directory / "removed.tsv",
        directory / NAMES_FILE,
        directory / LEFT_OUT_FILE,
    ]
    return sorted(p for p in files if p.is_file())


# A collected video's fields that must not be empty; the channel's name may come from the names.
GAPS = ("title", "channel_id", "published_at")


def _with_collected(
    videos: list[Video],
    directory: Path,
    pools: scoring.Pools,
    composite_pool: list[float],
    names: dict[str, str],
) -> list[Video]:
    """The reference videos plus the collector's added ones (scored against the reference
    set), with the removed ones marked."""
    by_id = {v.id: v for v in videos}
    removed: dict[str, str] = {}
    for path in collected_files(directory):
        if path.name in (NAMES_FILE, LEFT_OUT_FILE):
            continue  # read on their own
        with path.open(newline="", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh, delimiter="\t"))
        if path.name == "removed.tsv":
            removed.update((r["video_id"], r["removed_at"]) for r in rows)
            continue
        for row in rows:
            video_id = row["video_id"].strip()
            if not video_id or video_id in by_id:
                continue
            channel = _channel_name(row, names)
            gaps = [k for k in GAPS if not row[k].strip()] + ([] if channel.strip() else ["name"])
            if gaps:  # shown only with everything in place (plan 013, decision 12)
                log.warning("Left out %s from %s: no %s", video_id, path.name, ", ".join(gaps))
                continue
            raw = row["category"].strip()
            video = _video(
                video_id,
                row["title"],
                row["channel_id"],
                channel,
                _category(path, raw) if raw else None,  # none: no keyword placed it
                row["published_at"].strip() or None,
                {name: _float(row[name]) for name in scoring.FEATURES},
                pools,
                composite_pool,
            )
            if video is not None:
                by_id[video_id] = replace(video, added_at=row["added_at"])
    for video_id, removed_at in removed.items():
        if video_id in by_id:
            by_id[video_id] = replace(by_id[video_id], removed_at=removed_at)
    return list(by_id.values())
