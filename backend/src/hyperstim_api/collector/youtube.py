"""YouTube Data API calls the collector makes, each counted against the day's units.

The collector shares the site's API project with live checks (plan 013, decision 7), so it
stops at its own daily budget, leaving the rest for them. A day is YouTube's quota day,
which starts at midnight Pacific time.
"""

import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from hyperstim_api.collector.sampling import Details, duration_s, region_blocked

API = "https://www.googleapis.com/youtube/v3/"
TIMEOUT_S = 30
QUOTA_TZ = ZoneInfo("America/Los_Angeles")
SEARCH_UNITS = 100  # every other call we make costs 1

Json = dict[str, Any]
Get = Callable[[str], Json]  # URL (without the key) -> parsed answer; raises ApiError


class ApiError(Exception):
    """The Data API answered with an error, or couldn't be reached."""

    def __init__(self, message: str, quota_exceeded: bool = False) -> None:
        super().__init__(message)
        self.quota_exceeded = quota_exceeded


class OutOfUnits(Exception):
    """The collector's units for today are used up (its budget, or YouTube's quota)."""


def quota_day(now: float) -> str:
    return datetime.fromtimestamp(now, QUOTA_TZ).date().isoformat()


def http_get(api_key: str) -> Get:
    """Calls the Data API; the key goes in a header, so it never shows up in a message."""

    def get(url: str) -> Json:
        request = urllib.request.Request(url, headers={"X-Goog-Api-Key": api_key})
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
                body: Json = json.loads(response.read().decode("utf-8"))
                return body
        except urllib.error.HTTPError as exc:
            text = exc.read().decode("utf-8", "replace")
            raise ApiError(f"HTTP {exc.code}: {text[-300:]}", "quotaExceeded" in text) from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise ApiError(str(exc)) from exc

    return get


@dataclass(frozen=True)
class ChannelStats:
    title: str
    subscriber_count: int
    video_count: int


class DataApi:
    def __init__(
        self,
        get: Get,
        spend: Callable[[int], None],
    ) -> None:
        self._get = get
        self._spend = spend  # counts units; raises OutOfUnits when the budget is used up

    def _call(self, method: str, units: int, **params: str) -> Json:
        self._spend(units)
        try:
            return self._get(API + method + "?" + urllib.parse.urlencode(params))
        except ApiError as exc:
            if exc.quota_exceeded:
                raise OutOfUnits(str(exc)) from exc
            raise

    def uploads_page(
        self, channel_id: str, page_token: str | None = None
    ) -> tuple[list[tuple[str, str]], str | None]:
        """One page (newest first) of the channel's uploads: (video ID, published at). An upload
        listed without a date has "" (the repair pass looks it up, plan 013, decision 12)."""
        params = {
            "playlistId": "UU" + channel_id[2:],  # the channel's uploads playlist
            "part": "contentDetails",
            "maxResults": "50",
        }
        if page_token:
            params["pageToken"] = page_token
        try:
            body = self._call("playlistItems", 1, **params)
        except ApiError as exc:
            if "HTTP 404" in str(exc):  # the channel is gone, or has no uploads
                return [], None
            raise
        uploads = []
        for item in body.get("items", []):
            details = item.get("contentDetails", {})
            if details.get("videoId"):
                uploads.append((details["videoId"], details.get("videoPublishedAt") or ""))
        return uploads, body.get("nextPageToken")

    def videos(self, ids: list[str]) -> dict[str, Details]:
        """Up to 50 uploads' details; a missing ID is deleted or private."""
        assert len(ids) <= 50
        body = self._call(
            "videos", 1, id=",".join(ids), part="snippet,contentDetails,status", maxResults="50"
        )
        out = {}
        for item in body.get("items", []):
            snippet = item.get("snippet", {})
            content = item.get("contentDetails", {})
            out[item["id"]] = Details(
                made_for_kids=item.get("status", {}).get("madeForKids"),
                duration_s=duration_s(content.get("duration")),
                live=snippet.get("liveBroadcastContent") in ("live", "upcoming"),
                region_blocked=region_blocked(content),
                title=snippet.get("title", ""),
                description=snippet.get("description", ""),
                tags=" | ".join(snippet.get("tags") or []),
                channel_title=snippet.get("channelTitle", ""),
                published_at=snippet.get("publishedAt", ""),
            )
        return out

    def search_channels(self, query: str) -> list[str]:
        """One page of channels for a query, as v2's discovery (56_channel_yield_probe.py)."""
        body = self._call(
            "search", SEARCH_UNITS, q=query, type="channel", part="snippet", maxResults="50"
        )
        ids = []
        for item in body.get("items", []):
            channel_id = item.get("id", {}).get("channelId") or item.get("snippet", {}).get(
                "channelId"
            )
            if channel_id:
                ids.append(channel_id)
        return ids

    def channels(self, ids: list[str]) -> dict[str, ChannelStats]:
        assert len(ids) <= 50
        body = self._call("channels", 1, id=",".join(ids), part="statistics,snippet")
        out = {}
        for item in body.get("items", []):
            stats = item.get("statistics", {})
            out[item["id"]] = ChannelStats(
                title=item.get("snippet", {}).get("title", ""),
                subscriber_count=int(stats.get("subscriberCount") or 0),
                video_count=int(stats.get("videoCount") or 0),
            )
        return out


# v2's Shorts probe (57_enumerate_and_sample.py, ShortsProbe): HEAD /shorts/<id>; 200 is a
# Short, a redirect to /watch is not. Single, jittered requests.
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.1 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/119.0.0.0 Safari/537.36",
]


# Only jitter and User-Agent picks, nothing secret; the OS source keeps code scanners quiet.
_rng = random.SystemRandom()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def is_short(video_id: str, attempts: int = 3) -> bool | None:
    """True / False, or None when the probe couldn't decide."""
    opener = urllib.request.build_opener(_NoRedirect)
    for attempt in range(attempts):
        time.sleep(1.0 + _rng.random() * 0.6)
        request = urllib.request.Request(
            f"https://www.youtube.com/shorts/{video_id}",
            method="HEAD",
            headers={"User-Agent": _rng.choice(USER_AGENTS), "Accept-Language": "en-US,en"},
        )
        try:
            with opener.open(request, timeout=10) as response:
                return bool(response.status == 200)
        except urllib.error.HTTPError as exc:
            if exc.code in (301, 302, 303, 307, 308):
                return False
            if exc.code in (429, 503):
                time.sleep(30 * 2**attempt + _rng.random() * 10)
                continue
            return None
        except (urllib.error.URLError, TimeoutError):
            continue
    return None
