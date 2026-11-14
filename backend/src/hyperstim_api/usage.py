"""Counts of how the site is used, for the team (plan 014). Nothing about who.

Daily totals of what visitors look at, check, look up and search for, counted as the API
answers and kept as one TSV file a day (`<date>.tsv`: kind, key, extra, count) in the
usage folder, rewritten once a minute. No IP address, cookie or visitor ID is stored.

Searches: the search boxes search as the visitor types, so the requests include half-typed
words. Each IP's last search is held in memory for a few seconds; a search that extends or
shortens it replaces it, and only the last of such a chain is counted. The IP is never
written anywhere.
"""

import csv
import logging
import os
import re
import threading
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

CHAIN_S = 10.0  # a search typed on within this many seconds belongs to the same chain
FLUSH_S = 60.0
MAX_TEXT = 80
# Pasted links and IDs aren't searches by name; they aren't kept as text.
LINK_OR_ID = re.compile(r"youtu\.?be|^[A-Za-z0-9_-]{11}$|^UC[A-Za-z0-9_-]{22}$", re.I)

Key = tuple[str, str, str]  # kind, key, extra


def normalize(text: str) -> str:
    return " ".join(text.lower().split())[:MAX_TEXT]


@dataclass
class _Search:
    kind: str  # search_videos | search_channels
    text: str
    found: bool
    at: float


class UsageLog:
    def __init__(self, directory: Path, clock: Callable[[], float] = time.time) -> None:
        self._dir = directory
        self._clock = clock
        self._lock = threading.Lock()
        self._day = self._today()
        self._counts: Counter[Key] = self._read(self._day)  # so a restart keeps today's
        self._pending: dict[str, _Search] = {}  # IP -> its search chain's latest search
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        directory.mkdir(parents=True, exist_ok=True)

    def _today(self) -> str:
        return time.strftime("%Y-%m-%d", time.gmtime(self._clock()))

    # --- what's counted ------------------------------------------------------------------

    def count(self, kind: str, key: str, extra: str = "") -> None:
        with self._lock:
            self._roll_day()
            self._counts[(kind, key, extra)] += 1

    def search(self, ip: str, kind: str, text: str, found: bool) -> None:
        """A search request; counted once its chain ends (see the module's docstring)."""
        text = normalize(text)
        if not text or LINK_OR_ID.search(text):
            return
        now = self._clock()
        with self._lock:
            self._roll_day()
            self._settle(now)
            last = self._pending.get(ip)
            same_chain = (
                last is not None
                and last.kind == kind
                and (text.startswith(last.text) or last.text.startswith(text))
            )
            if last is not None and not same_chain:
                self._add_search(last)
            self._pending[ip] = _Search(kind, text, found, now)

    def _add_search(self, search: _Search) -> None:
        self._counts[(search.kind, search.text, "found" if search.found else "nothing")] += 1

    def _settle(self, now: float) -> None:
        """Count the chains nobody has typed on for `CHAIN_S`. Hold the lock."""
        for ip, search in list(self._pending.items()):
            if now - search.at >= CHAIN_S:
                self._add_search(search)
                del self._pending[ip]

    # --- the files -----------------------------------------------------------------------

    def _path(self, day: str) -> Path:
        return self._dir / f"{day}.tsv"

    def _read(self, day: str) -> Counter[Key]:
        counts: Counter[Key] = Counter()
        try:
            with self._path(day).open(newline="", encoding="utf-8") as fh:
                for row in csv.DictReader(fh, delimiter="\t"):
                    counts[(row["kind"], row["key"], row["extra"])] += int(row["count"])
        except (OSError, KeyError, ValueError):
            pass
        return counts

    def _roll_day(self) -> None:
        """At midnight UTC: write yesterday's file and start today's. Hold the lock."""
        today = self._today()
        if today != self._day:
            self._write(self._day, self._counts)
            self._day, self._counts = today, self._read(today)

    def _write(self, day: str, counts: Counter[Key]) -> None:
        path = self._path(day)
        tmp = path.with_suffix(".tsv.tmp")
        with tmp.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh, delimiter="\t", lineterminator="\n")
            writer.writerow(["kind", "key", "extra", "count"])
            for (kind, key, extra), n in sorted(counts.items()):
                writer.writerow([kind, key.replace("\t", " "), extra, n])
        os.replace(tmp, path)

    def flush(self) -> None:
        with self._lock:
            self._settle(self._clock())
            self._roll_day()
            if self._counts:
                self._write(self._day, self._counts)

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name="usage", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=10)
        with self._lock:  # chains still being typed count as they are
            for search in self._pending.values():
                self._add_search(search)
            self._pending.clear()
        self.flush()

    def _loop(self) -> None:
        while not self._stop.wait(FLUSH_S):
            try:
                self.flush()
            except OSError:
                log.exception("Couldn't write the usage counts")
