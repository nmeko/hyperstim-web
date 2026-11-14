"""Which uploads the dataset takes (plan 013, decision 1).

Every upload has a fixed random number `rank(video_id)` in [0, 1). The dataset is v2's picks
plus, one at a time, an eligible upload of the channel with the fewest videos per year, from
its year with the fewest videos per active year below the channel's threshold (on a tie, the
year farthest from its years with videos, then a random one), the one with the lowest number, so
a random one (`pick_order`). Eligibility is v2's: made for kids, 2-60
minutes, not a Short, online and not blocked in the US. A channel that marks only a few of its
uploads as made for kids, or makes fewer than 5 eligible videos a year, is left out with all
its videos (`left_out`). A third of the downloads goes to new channels until they catch up with
the others (`explore_turn`, `catch_up_order`).
"""

import hashlib
import math
import re
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from fractions import Fraction
from typing import Any, Literal

# The picking rule: v1, a rising cut-off on the numbers and a floor of 5 per channel (until
# 2026-11-02); v2, channel first (`pick_order`). The numbers stay v1's (`RANK_SALT`).
RULE_VERSION = "v2"
RANK_SALT = "hyperstim-sample-v1"
FIRST_YEAR = 2015  # v2's first year (YouTube Kids' launch)
SETTLE_S = 24 * 3600  # an upload is checked once it's a day old
REGION = "US"
# A third of each day's downloads (UTC) goes to exploring: new channels' first videos and their
# catch-up (`catch_up_order`); the rest to expanding the channels in (`pick_order`).
EXPLORE_SHARE = Fraction(1, 3)
FIRST_VIDEOS_PER_DAY = 3  # channels that get their first video in a day (UTC), at most
# A new channel catches up to at least this many videos, and this many a year, so it isn't
# scored from one or two (fewer only when it has nothing more to take).
CATCH_UP_MIN_VIDEOS = 5
CATCH_UP_MIN_PER_YEAR = 0.5
CHECKS_PER_YEAR = 3  # unchecked uploads of a channel-year checked at a time, lowest numbers first
# A channel whose checked uploads are under 10 % made for kids is left out (decision 1),
# judged once it has 20 answers; so is one with fewer than 5 eligible uploads per active year.
KIDS_PERCENT_MIN, KIDS_ANSWERS_MIN = 10, 20
PER_YEAR_MIN = 5
# v2's duration rules (57_enumerate_and_sample.py): <= 60 s is a Short without asking,
# 60-180 s may be one (asked at /shorts/<id>), > 180 s can't be.
MIN_DURATION_S, MAX_DURATION_S = 120, 3600
SHORT_CERTAIN_S, SHORT_POSSIBLE_S = 60, 180

Verdict = Literal["eligible", "gone", "region", "not_for_kids", "duration", "short", "wait"]


def left_out(kids: int, answers: int) -> bool:
    """Whether a channel is left out for its kids share: `kids` of its `answers` (checked
    uploads whose made-for-kids answer is known) are made for kids."""
    return answers >= KIDS_ANSWERS_MIN and kids * 100 < KIDS_PERCENT_MIN * answers  # no float


# --- the channel-first rule (plan 013, decisions 1 and 2) ----------------------------------


@dataclass(frozen=True)
class Year:
    """A channel-year as the rule sees it."""

    channel_id: str
    year: int
    videos: int  # in the dataset (v2's picks, measured, added)
    site: int  # on the site (v2's picks, added)
    eligible: int  # eligible uploads found: in the dataset, waiting, or failed
    waiting: int  # eligible, waiting to be downloaded
    ready: int  # of those, not waiting for a retry
    unchecked: int  # not checked yet
    part: float  # the part of the year the channel was active, in (0, 1]
    low_r: float | None = None  # the lowest number of its eligible uploads ready now

    @property
    def counted(self) -> bool:
        """Whether it counts towards the channel's average: it has an eligible upload, found
        or possible (not checked yet)."""
        return self.eligible > 0 or self.unchecked > 0

    @property
    def open(self) -> bool:
        """Whether it can still take a video."""
        return self.waiting > 0 or self.unchecked > 0

    @property
    def rate(self) -> float:
        """Its videos per active year."""
        return self.videos / self.part


def active_part(year: int, first: date, last: date, today: date) -> float:
    """The part of `year` a channel was active: from its first upload, and up to today in the
    running year or to its last upload in the year it stopped. At least a day."""
    start, end = date(year, 1, 1), date(year + 1, 1, 1)
    days = (end - start).days
    if first > start:
        start = first
    if year == today.year:
        end = min(end, today + timedelta(days=1))
    elif last.year == year:
        end = last + timedelta(days=1)
    return max(1, (end - start).days) / days


def average(years: Iterable[Year], site: bool = False) -> float | None:
    """A channel's videos per year: its videos (on the site, with `site`) over the active
    parts of its counted years; None without counted years."""
    counted = [y for y in years if y.counted]
    part = sum(y.part for y in counted)
    return sum(y.site if site else y.videos for y in counted) / part if part else None


def _lines(
    years: Iterable[Year],
) -> tuple[dict[str, list[Year]], dict[str, float], dict[str, list[Year]], dict[str, list[Year]]]:
    """The channels' years (`by`), and of the channels on the site: their averages, their
    open years, and their open years below their threshold (`pick_order`)."""
    by: dict[str, list[Year]] = {}
    for y in years:
        by.setdefault(y.channel_id, []).append(y)
    avgs = {c: average(ys) or 0.0 for c, ys in by.items() if any(y.videos > 0 for y in ys)}
    can = {c: [y for y in by[c] if y.counted and y.open] for c in avgs}
    lows = sorted((a, c) for c, a in avgs.items() if can[c])[:2]
    below = {}
    for c in avgs:
        threshold = max(avgs[c], next((a for a, o in lows if o != c), math.inf))
        below[c] = [y for y in can[c] if y.rate < threshold]
    return by, avgs, can, below


def explore_turn(explored: int, downloads: int) -> bool:
    """Whether the next download is an exploring one: while exploring has had under
    `EXPLORE_SHARE` of the day's downloads so far, counting the next one (decision 2)."""
    return explored < (downloads + 1) * EXPLORE_SHARE


def _spread(by: Mapping[str, list[Year]]) -> Callable[[Year], tuple[float, float, int]]:
    """The tie-break between a channel's years: the one farthest from its years with videos
    first, so its videos spread evenly over time; still tied, the one with the lowest number
    (`low_r`), so a random one."""
    filled = {c: [y.year for y in ys if y.videos > 0] for c, ys in by.items()}

    def key(y: Year) -> tuple[float, float, int]:
        gap = min((abs(y.year - f) for f in filled[y.channel_id]), default=math.inf)
        return (-gap, 1.0 if y.low_r is None else y.low_r, y.year)

    return key


def catch_up_order(
    years: Iterable[Year], catching: Iterable[str], scores: Mapping[str, float | None]
) -> tuple[list[tuple[str, list[Year]]], list[str]]:
    """Exploring's order (decision 2): the channels catching up (`catching`, from their first
    video), fewest videos per year first (the higher score on a tie), each with the years it
    still needs, fewest videos per active year first: while it has fewer than
    `CATCH_UP_MIN_VIDEOS` videos or averages under `CATCH_UP_MIN_PER_YEAR`, its open years; then,
    while its average is under the level of the channels in (the lowest average of those that
    can still take a video), its open years under that level. Also the channels that need nothing
    more: they're caught up, and channel first (`pick_order`) takes them from there. `years`
    are every channel's on the site."""
    catching = set(catching)
    by: dict[str, list[Year]] = {}
    for y in years:
        by.setdefault(y.channel_id, []).append(y)
    ahead = {c: ys for c, ys in by.items() if c in catching and any(y.videos for y in ys)}
    _, avgs, _, _ = _lines(y for c, ys in by.items() if c not in ahead for y in ys)
    level = min((a for c, a in avgs.items() if any(y.counted and y.open for y in by[c])),
                default=0.0)  # fmt: skip
    spread = _spread(by)
    order, done = [], []
    for c, ys in ahead.items():
        can = [y for y in ys if y.counted and y.open]
        avg = average(ys) or 0.0
        if sum(y.videos for y in ys) < CATCH_UP_MIN_VIDEOS or avg < CATCH_UP_MIN_PER_YEAR:
            need = can
        else:
            need = [y for y in can if avg < level and y.rate < level]
        if need:
            order.append((c, sorted(need, key=lambda y: (y.rate, *spread(y)))))
        else:
            done.append(c)
    order.sort(key=lambda t: (average(by[t[0]]) or 0.0, -(scores.get(t[0]) or -1), t[0]))
    return order, sorted(done)


def pick_order(
    years: Iterable[Year], scores: Mapping[str, float | None]
) -> list[tuple[str, list[Year]]]:
    """The channel-first rule: the channels on the site by their videos per year, fewest first
    (the higher score on a tie), each with its open years below its threshold, fewest videos
    per active year first. A channel's threshold is its own average, or the lowest average of
    the other channels that can still take a video, whichever is higher: a channel whose years
    below its average have nothing left is skipped until the others have all passed it, and
    then fills its years below their level. When no channel has a year below its threshold,
    every open year in turn, fewest videos per active year first, so no year runs ahead. On a
    tie between a channel's years, the one farthest from its years with videos first, so its
    videos spread evenly over time; still tied, the one with the lowest number (`low_r`), so a
    random one."""
    by, avgs, can, below = _lines(years)

    def key(c: str) -> tuple[float, float, str]:
        return (avgs[c], -(scores.get(c) or -1), c)

    spread = _spread(by)
    order = []
    for c in sorted(avgs, key=key):
        if below[c]:
            order.append((c, sorted(below[c], key=lambda y: (y.rate, *spread(y)))))
    if not order:
        every = sorted(
            ((y, c) for c in avgs for y in can[c]),
            key=lambda t: (t[0].rate, *key(t[1]), *spread(t[0])),
        )
        order = [(c, [y]) for y, c in every]
    return order


def _dates(rows: Iterable[Any]) -> dict[str, tuple[date, date]]:
    """Each channel's first and last upload, from its rows (`year_rows`)."""
    out: dict[str, tuple[date, date]] = {}
    for r in rows:
        first, last = (
            date.fromisoformat(str(r["first"])[:10]),
            date.fromisoformat(str(r["last"])[:10]),
        )
        c = str(r["channel_id"])
        if c in out:
            first, last = min(first, out[c][0]), max(last, out[c][1])
        out[c] = (first, last)
    return out


def years_from(rows: Iterable[Any], today: str) -> list[Year]:
    """The channel-years from `FIRST_YEAR` on, from the store's rows (`year_rows`), with their
    active parts on `today`."""
    rows = list(rows)
    dates, day = _dates(rows), date.fromisoformat(today)
    return [
        Year(
            channel_id=str(r["channel_id"]),
            year=int(r["y"]),
            videos=int(r["videos"]),
            site=int(r["site"]),
            eligible=int(r["eligible"]),
            waiting=int(r["waiting"]),
            ready=int(r["ready"]),
            unchecked=int(r["unchecked"]),
            part=active_part(int(r["y"]), *dates[str(r["channel_id"])], day),
            low_r=r["low_r"],
        )
        for r in rows
        if int(r["y"]) >= FIRST_YEAR
    ]


def channel_estimates(rows: Iterable[Any], today: str) -> dict[str, float | None]:
    """Each channel's estimated eligible uploads per active year (`eligible_per_year`), from the
    store's rows (`year_rows`), over all its years from `FIRST_YEAR` on."""
    rows = list(rows)
    dates, day = _dates(rows), date.fromisoformat(today)  # a first upload before 2015 too
    rows = [r for r in rows if int(r["y"]) >= FIRST_YEAR]
    sums: dict[str, list[float]] = {}
    for r in rows:
        c = str(r["channel_id"])
        acc = sums.setdefault(c, [0, 0, 0, 0, 0.0])
        for i, key in enumerate(("v2", "found", "answers", "fresh")):
            acc[i] += int(r[key])
        acc[4] += active_part(int(r["y"]), *dates[c], day)
    return {c: eligible_per_year(int(a[0]), int(a[1]), int(a[2]), int(a[3]), a[4])
            for c, a in sums.items()}  # fmt: skip


def eligible_per_year(
    v2: int, found: int, answers: int, unchecked: int, part: float
) -> float | None:
    """A channel's estimated eligible uploads per active year: v2's picks and the eligible
    uploads found, plus its unchecked uploads at the share found eligible among the checked
    ones (v2's picks don't count towards the share: they were picked for being eligible), over
    the active parts of its years. None before `KIDS_ANSWERS_MIN` answers."""
    if answers < KIDS_ANSWERS_MIN or not part:
        return None
    return (v2 + found + unchecked * found / answers) / part


def rule_version(pick: str) -> str:
    """The rule a video was picked by, from why it was checked (`pick`)."""
    return "v2" if pick == "level" else "v1"


def rank(video_id: str) -> float:
    """The upload's fixed random number in [0, 1); anyone can recompute it."""
    digest = hashlib.sha256(f"{RANK_SALT}:{video_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


_DURATION = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$")


def duration_s(iso: str | None) -> int | None:
    """An ISO 8601 duration from the Data API ("PT1H2M3S") in seconds; None if unreadable."""
    m = _DURATION.match(iso or "")
    if not m or not any(m.groups()):
        return None
    days, hours, minutes, seconds = (int(g) if g else 0 for g in m.groups())
    return ((days * 24 + hours) * 60 + minutes) * 60 + seconds


@dataclass(frozen=True)
class Details:
    """What the Data API says about one upload (`videos.list`), or None if it's gone."""

    made_for_kids: bool | None
    duration_s: int | None
    live: bool  # still upcoming or live: can't be measured yet
    region_blocked: bool
    title: str
    description: str
    tags: str  # joined with " | ", as v2's snippets
    channel_title: str
    published_at: str = ""


def region_blocked(content_details: dict[str, object], region: str = REGION) -> bool:
    """v2's check (68_wide_pool_resample.py): blocked in `region`, or allowed elsewhere only."""
    restriction = content_details.get("regionRestriction")
    if not isinstance(restriction, dict):
        return False
    if region in (restriction.get("blocked") or []):
        return True
    allowed = restriction.get("allowed")
    return allowed is not None and region not in allowed


def needs_shorts_probe(details: Details) -> bool:
    d = details.duration_s
    return d is not None and MIN_DURATION_S <= d <= SHORT_POSSIBLE_S


def verdict(details: Details | None, is_short: bool | None = None) -> Verdict:
    """v2's checks in v2's order. `is_short` is the /shorts/ probe's answer, asked only when
    `needs_shorts_probe`; undecided counts as a Short, as in v2."""
    if details is None:
        return "gone"
    if details.live:
        return "wait"
    if details.region_blocked:
        return "region"
    if details.made_for_kids is not True:
        return "not_for_kids"
    d = details.duration_s
    if d is None or d <= SHORT_CERTAIN_S or d < MIN_DURATION_S or d > MAX_DURATION_S:
        return "duration"
    if needs_shorts_probe(details) and is_short is not False:
        return "short"
    return "eligible"
