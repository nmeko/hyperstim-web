"""The channel behind a YouTube channel link (plans 007, 008).

The compare page's channel field and the rankings search take channel links as well as
names. A channel ID link costs nothing; a handle, `/c/` or `/user/` link asks YouTube
through the pipeline, counts toward the live check's per-IP limit, and is remembered for a
day. Video links are not taken (plan 008).
"""

import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

from hyperstim_api.analysis import AnalysisError, Analyzer, Pipeline
from hyperstim_api.dataset import Dataset

CACHE_S = 24 * 3600

CHANNEL_ID = re.compile(r"^UC[A-Za-z0-9_-]{22}$")
HOSTS = {"youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "youtu.be"}
NAMED_PREFIXES = {"c", "user"}


@dataclass(frozen=True)
class Link:
    """A parsed link: a channel ID, or a channel page we must ask YouTube about."""

    kind: Literal["channel", "page"]
    value: str  # the channel ID, or the page's canonical URL


@dataclass(frozen=True)
class Found:
    channel_id: str
    name: str | None  # None when only YouTube knows it and we didn't need to ask
    in_dataset: bool
    video_count: int  # its videos in the dataset; 0 when it isn't in it


class NotALink(Exception):
    """Not a YouTube channel link (a video link isn't one)."""


class NotFound(Exception):
    """YouTube has no channel for the link (removed, private, unknown handle)."""


def parse_link(text: str) -> Link | None:
    """A YouTube channel link: `/channel/UC…`, `/@handle`, `/c/…` or `/user/…`."""
    text = text.strip()
    if not text:
        return None
    url = urlsplit(text if re.match(r"^https?://", text, re.I) else f"https://{text}")
    host = (url.hostname or "").lower().removeprefix("www.")
    if host not in HOSTS or host == "youtu.be":
        return None
    parts = [p for p in url.path.split("/") if p]
    if not parts:
        return None
    first = parts[0]
    if first == "channel":
        return Link("channel", parts[1]) if len(parts) > 1 and CHANNEL_ID.match(parts[1]) else None
    if first.startswith("@") and len(first) > 1:
        return Link("page", f"https://www.youtube.com/{first}")
    if first in NAMED_PREFIXES and len(parts) > 1:
        return Link("page", f"https://www.youtube.com/{first}/{parts[1]}")
    return None


class ChannelLookup:
    def __init__(
        self,
        dataset: Callable[[], Dataset],  # the current one; it's reloaded as it grows
        analyzer: Analyzer,
        pipeline: Pipeline,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._dataset = dataset
        self._analyzer = analyzer
        self._pipeline = pipeline
        self._clock = clock
        self._lock = threading.Lock()
        self._cache: dict[Link, tuple[float, str, str]] = {}  # link -> (when, channel ID, name)

    def find(self, text: str, ip: str) -> Found:
        """Raises NotALink, NotFound, or TooManyRequests (over the live check's limit)."""
        link = parse_link(text)
        if link is None:
            raise NotALink
        if link.kind == "channel":
            return self._found(link.value, None)
        now = self._clock()
        with self._lock:
            cached = self._cache.get(link)
        if cached is not None and now - cached[0] < CACHE_S:
            return self._found(cached[1], cached[2])
        self._analyzer.count_request(ip)
        try:
            channel_id, name = self._pipeline.channel(link.value)
        except AnalysisError as exc:
            raise NotFound from exc
        with self._lock:
            self._cache[link] = (now, channel_id, name)
        return self._found(channel_id, name)

    def _found(self, channel_id: str, name: str | None) -> Found:
        channel = self._dataset().channels_by_id.get(channel_id)
        if channel is not None:
            return Found(channel_id, channel.name, True, channel.video_count)
        return Found(channel_id, name or None, False, 0)
