"""FastAPI app. Run with: uvicorn --factory hyperstim_api.main:create_app"""

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Path, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from hyperstim_api.analysis import (
    Analyzer,
    Busy,
    ErrorCode,
    Pipeline,
    Record,
    ResearchPipeline,
    Status,
    TooManyRequests,
    estimate,
)
from hyperstim_api.channel_lookup import ChannelLookup, NotALink, NotFound
from hyperstim_api.config import Settings, load_settings
from hyperstim_api.dataset import CATEGORIES, Channel, Feature, Video
from hyperstim_api.ranking import CRITERIA, Order, Ranked
from hyperstim_api.reload import DatasetStore
from hyperstim_api.thumbnails import (
    OFFLINE_HINTS,
    Fetch,
    Size,
    ThumbnailCache,
    Unavailable,
    fetch_from_youtube,
    load_blog_videos,
)
from hyperstim_api.usage import UsageLog

VIDEO_ID_PATTERN = r"^[A-Za-z0-9_-]{11}$"  # a YouTube video ID
VideoId = Annotated[str, Path(pattern=VIDEO_ID_PATTERN)]
CHANNEL_ID_PATTERN = r"^UC[A-Za-z0-9_-]{22}$"  # a YouTube channel ID
ChannelId = Annotated[str, Path(pattern=CHANNEL_ID_PATTERN)]

# List parameters (plan 007).
SortKey = Annotated[str, Query(pattern=f"^({'|'.join(CRITERIA)})$")]
# Empty = all categories.
CategoryKey = Annotated[str, Query(pattern=f"^({'|'.join(CATEGORIES.values())})?$")]
Search = Annotated[str | None, Query(min_length=1, max_length=100)]
Offset = Annotated[int, Query(ge=0, le=1_000_000)]
Limit = Annotated[int, Query(ge=1, le=100)]
# The dataset's version a list page was first shown at (plan 013): later pages, sorts and
# searches answer as the dataset was then, so rows don't shift while a visitor browses.
AsOf = Annotated[
    str | None,
    Query(alias="asOf", pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"),
]
# The search box's `added:` filters (plan 007), as UTC times: from (inclusive), before (exclusive).
AddedFrom = Annotated[
    str | None,
    Query(alias="addedFrom", pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"),
]
AddedBefore = Annotated[
    str | None,
    Query(alias="addedBefore", pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"),
]
WEEK_S = 7 * 24 * 3600


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Health(ApiModel):
    status: str


class Meta(ApiModel):
    video_count: int
    channel_count: int
    updated_at: str
    # Growth (plan 013). Counts in the past week are over the last 7 x 24 hours.
    added_last_7_days: int
    channel_count_7_days_ago: int
    last_added_at: str | None  # UTC, ISO 8601; None: nothing added yet
    reference_count: int  # the videos every score is compared with
    channels_checked_at: str | None  # the collector's last full run of discovery's searches


class VideoSummary(ApiModel):
    id: str
    title: str
    channel_id: str
    channel: str
    score: float


class FeatureValue(ApiModel):
    key: str
    value: float | None
    percentile: float | None


class RankedVideo(VideoSummary):
    category: str
    rank: int | None  # within its category, 1 = first in the list's order; None = no value
    features: list[FeatureValue]


class VideoDetail(VideoSummary):
    channel_in_dataset: bool  # false for a live video from a channel we don't have
    features: list[FeatureValue]


class ChannelSummary(ApiModel):
    id: str
    name: str
    score: float
    video_count: int


class RankedChannel(ChannelSummary):
    rank: int | None
    features: list[FeatureValue]


class ChannelVideo(ApiModel):
    id: str
    title: str
    published_at: str  # YYYY-MM-DD
    score: float
    features: list[FeatureValue]


class ChannelDetail(ApiModel):
    id: str
    name: str
    video_count: int
    score: float
    features: list[FeatureValue]  # mean raw value and mean percentile of its videos
    videos: list[ChannelVideo]  # oldest first


class VideoList(ApiModel):
    items: list[RankedVideo]
    total: int  # rows matching the category and search
    as_of: str  # the dataset's version this list is from; send it back as `asOf`


class ChannelList(ApiModel):
    items: list[RankedChannel]
    total: int
    as_of: str


class ChannelFound(ApiModel):
    channel_id: str
    name: str | None  # None when we didn't need to ask YouTube and don't have the channel
    in_dataset: bool
    video_count: int  # its videos in the dataset (the rankings list channels with 5 or more)


class Analysis(ApiModel):
    status: Status
    queue_position: int | None  # videos ahead, while queued
    progress: float  # 0-1, estimated
    remaining_s: int | None  # estimated seconds left
    error: ErrorCode | None


def feature_values(features: tuple[Feature, ...]) -> list[FeatureValue]:
    return [
        FeatureValue(
            key=f.key,
            value=f.value,
            percentile=None if f.percentile is None else round(f.percentile, 1),
        )
        for f in features
    ]


def video_detail(v: Video, channel_in_dataset: bool) -> VideoDetail:
    return VideoDetail(
        id=v.id,
        title=v.title,
        channel_id=v.channel_id,
        channel=v.channel,
        score=round(v.score, 1),
        channel_in_dataset=channel_in_dataset,
        features=feature_values(v.features),
    )


def ranked_video(r: Ranked[Video]) -> RankedVideo:
    v = r.item
    return RankedVideo(
        id=v.id,
        title=v.title,
        channel_id=v.channel_id,
        channel=v.channel,
        category=v.category or "",
        rank=r.rank,
        score=round(v.score, 1),
        features=feature_values(v.features),
    )


def ranked_channel(r: Ranked[Channel]) -> RankedChannel:
    c = r.item
    return RankedChannel(
        id=c.id,
        name=c.name,
        video_count=c.video_count,
        rank=r.rank,
        score=round(c.score, 1),
        features=feature_values(c.features),
    )


def channel_detail(c: Channel) -> ChannelDetail:
    return ChannelDetail(
        id=c.id,
        name=c.name,
        video_count=c.video_count,
        score=round(c.score, 1),
        features=feature_values(c.features),
        videos=[
            ChannelVideo(
                id=v.id,
                title=v.title,
                published_at=v.published_at or "",
                score=round(v.score, 1),
                features=feature_values(v.features),
            )
            for v in c.videos
        ],
    )


def analysis(record: Record, queue_position: int | None, now: float) -> Analysis:
    progress = estimate(record, now)
    return Analysis(
        status=record.status,
        queue_position=queue_position,
        progress=round(progress.share, 3),
        remaining_s=None if progress.remaining_s is None else round(progress.remaining_s),
        error=record.error,
    )


def create_app(
    settings: Settings | None = None,
    pipeline: Pipeline | None = None,
    fetch_thumbnail: Fetch = fetch_from_youtube,
) -> FastAPI:
    """The app; `pipeline` and `fetch_thumbnail` stand in for the research scripts and YouTube
    in tests."""
    logging.basicConfig(level=logging.INFO)
    # uvicorn's access log has a line with the visitor's IP for every request, kept as long as
    # the server keeps its output. The reverse proxy already logs requests for 14 days, as the
    # privacy policy says (plan 009), so this copy is off without needing `--no-access-log`.
    logging.getLogger("uvicorn.access").disabled = True
    settings = settings or load_settings()
    store = DatasetStore(settings.dataset_path, settings.collected_dir, settings.collected_reload_s)
    blog_videos = load_blog_videos(settings.dataset_path)
    if pipeline is None:
        pipeline = ResearchPipeline(settings.ytdlp_cookies, settings.youtube_api_key)
        if settings.youtube_api_key is None:
            logging.getLogger(__name__).warning(
                "YOUTUBE_API_KEY is not set: live analysis accepts videos not made for kids"
            )
    analyzer = Analyzer(
        settings.analysis_dir,
        pipeline,
        settings.analysis_limit_per_ip,
        settings.analysis_limit_per_day,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        analyzer.start_worker()
        store.start()
        if usage is not None:
            usage.start()
        try:
            yield
        finally:
            if usage is not None:
                usage.stop()
            store.stop()
            analyzer.stop_worker()

    usage = UsageLog(settings.usage_dir) if settings.usage_dir else None

    def count(kind: str, key: str, extra: str = "") -> None:
        if usage is not None:
            usage.count(kind, key, extra)

    def count_search(request: Request, kind: str, q: str | None, offset: int, total: int) -> None:
        if usage is not None and q and offset == 0:
            usage.search(request.client.host if request.client else "", kind, q, total > 0)

    lookup = ChannelLookup(lambda: store.current, analyzer, pipeline)

    def hint_offline(video_id: str) -> None:
        """YouTube no longer has a dataset video's thumbnail: the collector checks whether the
        video is still online on its next tick (plan 013, decision 5)."""
        video = store.current.videos_by_id.get(video_id)
        if video is None or video.removed_at is not None:
            return  # a live check's, or already taken out
        hints = settings.analysis_dir / OFFLINE_HINTS
        try:
            hints.mkdir(parents=True, exist_ok=True)
            (hints / video_id).touch()
        except OSError as exc:
            logging.getLogger(__name__).warning("Couldn't leave an offline hint: %s", exc)

    thumbnails = ThumbnailCache(settings.thumbnail_dir, fetch_thumbnail, on_missing=hint_offline)

    docs = settings.api_docs  # off in prod: no need to hand out a map of the API
    app = FastAPI(
        title="HyperStim API",
        lifespan=lifespan,
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.state.analyzer = analyzer
    app.state.datasets = store
    app.state.usage = usage
    app.add_middleware(
        CORSMiddleware, allow_origins=[settings.cors_origin], allow_methods=["GET", "POST"]
    )

    @app.get("/api/health")
    def health() -> Health:
        return Health(status="ok")

    @app.get("/api/meta")
    def meta() -> Meta:
        dataset = store.current
        week_ago = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - WEEK_S))
        return Meta(
            video_count=len(dataset.videos),
            channel_count=dataset.channel_count,
            updated_at=dataset.updated_at,
            added_last_7_days=dataset.added_since(week_ago),
            channel_count_7_days_ago=dataset.channel_count_at(week_ago),
            last_added_at=dataset.last_added_at(),
            reference_count=dataset.reference_count,
            channels_checked_at=store.channels_checked_at,
        )

    @app.get("/api/videos")
    def videos(
        request: Request,
        sort: SortKey = "score",
        order: Order = "desc",
        category: CategoryKey = "",
        q: Search = None,
        offset: Offset = 0,
        limit: Limit = 20,
        as_of: AsOf = None,
        added_from: AddedFrom = None,
        added_before: AddedBefore = None,
    ) -> VideoList:
        """Videos ranked by `sort`, searched by title and channel name; as the dataset was at
        `asOf` if given. `addedFrom`/`addedBefore` show only videos added then (the reference
        set counts as added on its date); like `q`, they don't change the ranks."""
        dataset = store.current
        page, total = dataset.ranked_videos(
            sort, order, category or None, q, offset, limit, as_of, (added_from, added_before)
        )
        count_search(request, "search_videos", q, offset, total)
        return VideoList(
            items=[ranked_video(r) for r in page],
            total=total,
            as_of=dataset.current(as_of) or dataset.version,
        )

    @app.get("/api/videos/{video_id}", responses={404: {"description": "Video not found"}})
    def video(video_id: VideoId) -> VideoDetail:
        """A dataset video, or one analyzed live (scored against the dataset)."""
        dataset = store.current
        v = dataset.videos_by_id.get(video_id)
        if v is None:
            found = analyzer.snapshot(video_id)
            record = found[0] if found else None
            if record is not None and record.status == "done" and record.features is not None:
                v = dataset.score_video(
                    record.id,
                    record.title or record.id,
                    record.channel_id or "",
                    record.channel or "",
                    record.features,
                )
        if v is None:
            raise HTTPException(status_code=404, detail="Video not found")
        count("video_view", video_id, "dataset" if video_id in dataset.videos_by_id else "live")
        return video_detail(v, v.channel_id in dataset.channels_by_id)

    @app.post(
        "/api/analyses/{video_id}",
        status_code=202,
        responses={
            200: {"description": "Already done or running", "model": Analysis},
            429: {"description": "Too many new analyses from this IP address"},
            503: {"description": "The queue is full, or the day's new analyses are used up"},
        },
    )
    def start_analysis(video_id: VideoId, request: Request, response: Response) -> Analysis:
        """Start the live analysis of a video, or join it if it is stored or running."""
        if video_id in store.current.videos_by_id:
            count("live_check", video_id, "in_dataset")
            response.status_code = 200
            return Analysis(
                status="done",
                queue_position=None,
                progress=1,
                remaining_s=None,
                error=None,
            )
        ip = request.client.host if request.client else ""
        try:
            _, created = analyzer.start(video_id, ip)
        except Busy:
            raise HTTPException(status_code=503, detail="Busy") from None
        except TooManyRequests:
            raise HTTPException(status_code=429, detail="Too many requests") from None
        count("live_check", video_id, "new" if created else "repeat")
        if not created:
            response.status_code = 200
        found = analyzer.snapshot(video_id)
        assert found is not None  # just started or already there
        return analysis(*found, analyzer.clock())

    @app.get("/api/analyses/{video_id}", responses={404: {"description": "Never requested"}})
    def get_analysis(video_id: VideoId) -> Analysis:
        found = analyzer.snapshot(video_id)
        if found is None:
            raise HTTPException(status_code=404, detail="Analysis not found")
        return analysis(*found, analyzer.clock())

    @app.get("/api/channels")
    def channels(
        request: Request,
        sort: SortKey = "score",
        order: Order = "desc",
        category: CategoryKey = "",
        q: Search = None,
        offset: Offset = 0,
        limit: Limit = 20,
        min_videos: Annotated[int, Query(alias="minVideos", ge=1, le=1000)] = 1,
        as_of: AsOf = None,
        added_from: AddedFrom = None,
        added_before: AddedBefore = None,
    ) -> ChannelList:
        """Channels ranked by `sort` (whole-channel scores): all of them, unless `minVideos` asks
        for more videos (plan 013). Listed under a category when at least one of their videos is
        in it; searched by name. As the dataset was at `asOf` if given. `addedFrom`/`addedBefore`
        show only channels whose first video was added then."""
        dataset = store.current
        page, total = dataset.ranked_channels(
            sort,
            order,
            category or None,
            q,
            offset,
            limit,
            min_videos,
            as_of,
            (added_from, added_before),
        )
        count_search(request, "search_channels", q, offset, total)
        return ChannelList(
            items=[ranked_channel(r) for r in page],
            total=total,
            as_of=dataset.current(as_of) or dataset.version,
        )

    @app.get(
        "/api/channel-lookup",
        responses={
            404: {"description": "No YouTube channel for the link"},
            422: {"description": "Not a YouTube channel or video link"},
            429: {"description": "Too many new lookups and analyses from this IP address"},
        },
    )
    def channel_lookup(
        url: Annotated[str, Query(min_length=1, max_length=500)], request: Request
    ) -> ChannelFound:
        """The channel behind a YouTube channel or video link, and whether we have it."""
        ip = request.client.host if request.client else ""
        try:
            found = lookup.find(url, ip)
        except NotALink:
            raise HTTPException(status_code=422, detail="Not a YouTube link") from None
        except NotFound:
            raise HTTPException(status_code=404, detail="Channel not found") from None
        except TooManyRequests:
            raise HTTPException(status_code=429, detail="Too many requests") from None
        count("channel_lookup", found.channel_id, "in" if found.in_dataset else "not_in")
        return ChannelFound(
            channel_id=found.channel_id,
            name=found.name,
            in_dataset=found.in_dataset,
            video_count=found.video_count,
        )

    @app.get(
        "/api/thumbnails/{video_id}",
        responses={
            200: {"content": {"image/jpeg": {}}},
            404: {"description": "Not a video we know, or YouTube has no thumbnail"},
            502: {"description": "YouTube couldn't be reached"},
        },
    )
    def thumbnail(video_id: VideoId, size: Size = "hq") -> Response:
        """A video's YouTube thumbnail, served by us so visitors' browsers don't contact YouTube.
        Only for videos in the dataset, requested for live analysis, or embedded in a blog post.
        Cached on the server for 30 days; the visitor's browser keeps it for a day. While YouTube
        can't be reached, 502 without asking it again for 10 minutes."""
        known = (
            video_id in store.current.videos_by_id
            or video_id in blog_videos
            or analyzer.snapshot(video_id) is not None
        )
        if not known:
            raise HTTPException(status_code=404, detail="Video not found")
        try:
            image = thumbnails.get(video_id, size)
        except Unavailable:
            # Not kept by the browser: the next page load asks again.
            raise HTTPException(
                status_code=502, detail="YouTube unavailable", headers={"Cache-Control": "no-store"}
            ) from None
        if image is None:
            raise HTTPException(status_code=404, detail="No thumbnail")
        return Response(
            image, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"}
        )

    @app.get("/api/channels/{channel_id}", responses={404: {"description": "Channel not found"}})
    def channel(channel_id: ChannelId) -> ChannelDetail:
        c = store.current.channels_by_id.get(channel_id)
        if c is None:
            raise HTTPException(status_code=404, detail="Channel not found")
        count("channel_view", channel_id)
        return channel_detail(c)

    return app
