"""Rankings of videos or channels by the score or one feature (plan 007).

Each criterion's order is computed once: most stimulating first, ties by ID, rows with no
value last, also for the default view's rows alone. A request keeps the rows in its
category (or takes the default view's), applies the search, reads them in reverse for
`asc`, and slices a page; only the page's rows get their rank (equal values share one,
counted from the least stimulating end for `asc`), by binary search on the values. A search matches
names, or a row's exact ID (a pasted link, plan 007).
"""

import re
import unicodedata
from bisect import bisect_left, bisect_right
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from itertools import islice
from typing import Literal, Protocol

from hyperstim_api import scoring

Order = Literal["desc", "asc"]

CRITERIA: tuple[str, ...] = ("score", *scoring.FEATURES)


class FeatureLike(Protocol):
    @property
    def key(self) -> str: ...
    @property
    def value(self) -> float | None: ...
    @property
    def percentile(self) -> float | None: ...


class Rankable(Protocol):
    @property
    def id(self) -> str: ...
    @property
    def score(self) -> float: ...
    @property
    def features(self) -> tuple[FeatureLike, ...]: ...


def rank_value(item: Rankable, criterion: str) -> float | None:
    """What `criterion` ranks `item` by: its score or a feature percentile; None = no value."""
    if criterion == "score":
        return item.score
    for f in item.features:
        if f.key == criterion:
            return f.percentile
    return None


def fold(text: str) -> str:
    """Case, accents and repeated spaces removed, for search: "Café  Bar" and "cafe bar"
    match. Pages show a name's repeated spaces as one, so that's what visitors type."""
    decomposed = unicodedata.normalize("NFKD", text)
    plain = "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()
    return re.sub(r"\s+", " ", plain)


@dataclass(frozen=True)
class Ranked[T]:
    item: T
    rank: int | None  # by the criterion within the category, 1 = first in the order asked for


type Added = tuple[str | None, str | None]  # [from, before), UTC, either open


class Ranking[T: Rankable]:
    """Rows ranked by every criterion; `names` are what a search matches, `added_at` when a
    row was added (for the `added` filter). `base` selects the default view's rows (e.g. the
    videos in the dataset now), which are kept ready, so a request for that view only builds
    the rows it returns, however many rows there are (plan 007)."""

    def __init__(
        self,
        items: Iterable[T],
        names: Callable[[T], Iterable[str]],
        added_at: Callable[[T], str],
        base: Callable[[T], bool] = lambda _: True,
    ) -> None:
        rows = list(items)
        self._text = {item.id: "\n".join(fold(n) for n in names(item)) for item in rows}
        self._added_at = added_at
        self._orders: dict[str, _Rows[T]] = {}
        self._base: dict[str, _Rows[T]] = {}
        for criterion in CRITERIA:
            valued = [(item, rank_value(item, criterion)) for item in rows]
            valued.sort(key=lambda r: (r[1] is None, -(r[1] or 0), r[0].id))
            rows_all = _Rows.split(valued)
            self._orders[criterion] = rows_all
            self._base[criterion] = rows_all.keep(base)
        # When each of the default view's rows was added, sorted: its counts by `added`.
        self._base_added = sorted(added_at(item) for item in rows if base(item))

    def page(
        self,
        criterion: str,
        order: Order,
        keep: Callable[[T], bool] | None,
        query: str | None,
        offset: int,
        limit: int,
        added: Added | None = None,
    ) -> tuple[list[Ranked[T]], int]:
        """One page of the rows `keep` selects (None: the default view's) that `query` and
        `added` match, and their count. `query` and `added` only hide rows: the ranks stay
        those among all `keep` selects."""
        rows = self._base[criterion] if keep is None else self._orders[criterion].keep(keep)
        if added == (None, None):
            added = None
        if not query and added is None:
            n = len(rows)
            return [rows.ranked(i, order) for i in range(n)[offset : offset + limit]], n
        match = self._matcher(query, added)
        if keep is None and not query and added is not None:
            # Counted from the sorted add times, so no row is visited past the page.
            total = _count_between(self._base_added, added)
            found = (i for i in range(len(rows)) if match(rows.at(i, order)))
            return [rows.ranked(i, order) for i in islice(found, offset, offset + limit)], total
        hits = [i for i in range(len(rows)) if match(rows.at(i, order))]
        return [rows.ranked(i, order) for i in hits[offset : offset + limit]], len(hits)

    def _matcher(self, query: str | None, added: Added | None) -> Callable[[T], bool]:
        q = fold(query) if query else None
        start, end = added or (None, None)

        def match(item: T) -> bool:
            if q is not None and item.id != query and q not in self._text[item.id]:
                return False
            if added is not None:
                at = self._added_at(item)
                return (start is None or at >= start) and (end is None or at < end)
            return True

        return match


def _count_between(times: list[str], added: Added) -> int:
    start, end = added
    lo = 0 if start is None else bisect_left(times, start)
    hi = len(times) if end is None else bisect_left(times, end)
    return max(0, hi - lo)


@dataclass(frozen=True)
class _Rows[T]:
    """Rows in one criterion's order: those with a value, most stimulating first (ties by ID),
    then those without. The rows are shared, not copied, so a request that filters them makes
    no row objects of its own; ranks are worked out only for the rows a page returns."""

    valued: list[T]
    negated: list[float]  # -value of each valued row: ascending, for binary search
    unranked: list[T]

    @staticmethod
    def split(rows: list[tuple[T, float | None]]) -> "_Rows[T]":
        valued = [(item, value) for item, value in rows if value is not None]
        return _Rows(
            [item for item, _ in valued],
            [-value for _, value in valued],
            [item for item, value in rows if value is None],
        )

    def keep(self, keep: Callable[[T], bool]) -> "_Rows[T]":
        kept = [i for i, item in enumerate(self.valued) if keep(item)]
        return _Rows(
            [self.valued[i] for i in kept],
            [self.negated[i] for i in kept],
            [item for item in self.unranked if keep(item)],
        )

    def __len__(self) -> int:
        return len(self.valued) + len(self.unranked)

    def at(self, i: int, order: Order) -> T:
        """The `i`th row in `order`: least stimulating first, rows with no value still come last."""
        n = len(self.valued)
        if i >= n:
            return self.unranked[i - n]
        return self.valued[i] if order == "desc" else self.valued[n - 1 - i]

    def ranked(self, i: int, order: Order) -> Ranked[T]:
        """The `i`th row with its rank. Equal values share the rank of the first of them in
        `order` (e.g. the many videos with a count of 0), so 1, 2, 2, 4 either way."""
        n = len(self.valued)
        item = self.at(i, order)
        if i >= n:
            return Ranked(item, None)
        value = self.negated[i if order == "desc" else n - 1 - i]
        if order == "desc":
            return Ranked(item, bisect_left(self.negated, value) + 1)
        return Ranked(item, n - bisect_right(self.negated, value) + 1)
