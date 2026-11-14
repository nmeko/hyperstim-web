"""The collector's state: one SQLite file (`collector.db`), used by one process at a time.

Channels and their upload lists, each upload's number and what became of it, the added
videos with their measurements and provenance, removals, download attempts and the Data
API units used per day.
"""

import json
import os
import sqlite3
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from hyperstim_api.collector import sampling
from hyperstim_api.collector.sampling import (
    FIRST_VIDEOS_PER_DAY,
    KIDS_ANSWERS_MIN,
    PER_YEAR_MIN,
    left_out,
    rank,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    subscriber_count INTEGER,
    video_count INTEGER,
    tier TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,              -- in | near_miss | rejected
    source TEXT NOT NULL,              -- v2 | discovery
    queries TEXT NOT NULL DEFAULT '',  -- the discovery queries that found it
    joined_at TEXT,                    -- when it became `in` (v2's: the v2 scan)
    checked_at TEXT,                   -- last time its stats were read
    listed_at REAL,                    -- last time its newest uploads were read
    api_failures INTEGER NOT NULL DEFAULT 0,  -- Data API errors in a row reading its uploads
    retry_at REAL NOT NULL DEFAULT 0,  -- after an error: not read again before this
    full_listing TEXT,                 -- reading all its uploads: '' or the next page; else NULL
    catching_up INTEGER NOT NULL DEFAULT 0,  -- 1 from its first video until it caught up
    named_at TEXT                      -- last time its name was read (dataset channels, weekly)
);
CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    published_at TEXT NOT NULL,
    r REAL NOT NULL,
    -- new | v2 | eligible | ineligible | measured | collected | failed | removed
    -- (measured: measured, but waiting for a missing title, channel name or date)
    state TEXT NOT NULL DEFAULT 'new',
    reason TEXT NOT NULL DEFAULT '',
    -- not before: `new`, checked; `eligible`, downloaded; `v2`/`collected`, checked online
    retry_at REAL NOT NULL DEFAULT 0,
    unsure INTEGER NOT NULL DEFAULT 0, -- answers that couldn't settle its state, in a row
    api_failures INTEGER NOT NULL DEFAULT 0,  -- Data API errors in a row checking it
    checked_at REAL,
    online_at REAL,                    -- dataset videos: last seen online (monthly check)
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    channel_title TEXT NOT NULL DEFAULT '',
    duration_s INTEGER,
    -- why it was checked: level (rule v2); before 2026-11-02, sample (under t) | floor
    pick TEXT NOT NULL DEFAULT 'sample',
    score REAL                         -- dataset videos: their score, for the download order
);
CREATE INDEX IF NOT EXISTS uploads_state_r ON uploads (state, r);
CREATE INDEX IF NOT EXISTS uploads_channel ON uploads (channel_id);
CREATE TABLE IF NOT EXISTS collected (
    video_id TEXT PRIMARY KEY,
    added_at TEXT NOT NULL,            -- UTC, ISO 8601
    category TEXT,                     -- None: no keyword placed it
    features TEXT NOT NULL,            -- JSON: the 12 raw values
    cutoff REAL NOT NULL,              -- the cut-off when it was picked (rule v1; 0 under v2)
    provenance TEXT NOT NULL           -- JSON
);
CREATE TABLE IF NOT EXISTS removed (
    video_id TEXT PRIMARY KEY,
    removed_at TEXT NOT NULL,
    reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY,
    video_id TEXT NOT NULL,
    at REAL NOT NULL,
    outcome TEXT NOT NULL,             -- collected | unavailable | blocked | failed
    message TEXT NOT NULL DEFAULT '',
    explore INTEGER NOT NULL DEFAULT 0 -- 1: an exploring download (a first video or a catch-up)
);
CREATE INDEX IF NOT EXISTS attempts_at ON attempts (at);
CREATE TABLE IF NOT EXISTS units (day TEXT PRIMARY KEY, used INTEGER NOT NULL);
-- Channels left out for their kids share (decision 1), worked out at each export.
CREATE TABLE IF NOT EXISTS left_out (
    channel_id TEXT PRIMARY KEY,
    kids INTEGER NOT NULL,             -- of its answers, made for kids
    answers INTEGER NOT NULL,          -- checked uploads whose made-for-kids answer is known
    per_year REAL,                     -- estimated eligible uploads per active year
    reason TEXT NOT NULL DEFAULT 'kids_share'  -- kids_share | per_year | both
);
-- Who was left out and when (decision 10): a row each time a judging leaves a channel out
-- (`out`, with its reason), lets it back in (`in`), or changes its reason (`out` again). It
-- starts with the channels left out at its first judging (kv `left_out_log_from`).
CREATE TABLE IF NOT EXISTS left_out_log (
    channel_id TEXT NOT NULL, at REAL NOT NULL, change TEXT NOT NULL, reason TEXT
);
CREATE INDEX IF NOT EXISTS left_out_log_channel ON left_out_log (channel_id, at);
-- The changelog's counts that can't be worked out again later (decision 10), one row per UTC
-- day, recorded when the day is closed: channels not on the site yet with a video waiting, and
-- channels left out (NULL on the days before it was recorded); `at`, the time they stand for
-- (the next midnight when they're the day's end; NULL when recorded before it was kept).
CREATE TABLE IF NOT EXISTS daily (
    day TEXT PRIMARY KEY, ch_ready INTEGER NOT NULL, ch_out INTEGER, at REAL, ch_yr_2nd REAL,
    ch_yr_med REAL
);
-- The changelog's notes (decision 10): each dated the first day the collector ran with it.
CREATE TABLE IF NOT EXISTS notes (note TEXT PRIMARY KEY, day TEXT NOT NULL);
"""
# Columns added since the first release (plan 013, decision 12), added to an older database
# when it's opened: table -> column -> its definition.
ADDED_COLUMNS = {
    "channels": {
        "api_failures": "INTEGER NOT NULL DEFAULT 0",
        "retry_at": "REAL NOT NULL DEFAULT 0",
        "full_listing": "TEXT",
        "catching_up": "INTEGER NOT NULL DEFAULT 0",  # the channels in before count as caught up
        "named_at": "TEXT",
    },
    "attempts": {"explore": "INTEGER NOT NULL DEFAULT 0"},
    "uploads": {
        "unsure": "INTEGER NOT NULL DEFAULT 0",
        "api_failures": "INTEGER NOT NULL DEFAULT 0",
        "pick": "TEXT NOT NULL DEFAULT 'sample'",  # everything checked before was `sample`
        "score": "REAL",  # filled in when the collector starts
    },
    "daily": {"ch_out": "INTEGER", "at": "REAL", "ch_yr_2nd": "REAL", "ch_yr_med": "REAL"},
    "left_out": {"per_year": "REAL", "reason": "TEXT NOT NULL DEFAULT 'kids_share'"},
}
V2_JOINED = "2026-08-26"
# A channel's videos in the dataset or on their way: what the floor counts.
# A channel's videos in the dataset (measured ones too: they wait only for a name).
IN_STATES = "('v2', 'measured', 'collected')"
KEPT = "NOT IN (SELECT channel_id FROM left_out)"  # a channel not left out: `<id column> {KEPT}`
# Each channel with videos in the dataset: how many, and its score as the site ranks it (the
# mean of its videos' scores).
HAVE = (
    "WITH have AS (SELECT channel_id, COUNT(*) AS n, AVG(score) AS score FROM uploads "
    f"WHERE state IN {IN_STATES} GROUP BY channel_id) "
)
# Each channel-year with videos in the dataset (to append to `HAVE`): how many.
YEARS = (
    ", cy AS (SELECT channel_id, SUBSTR(published_at, 1, 4) AS y, COUNT(*) AS n FROM uploads "
    f"WHERE state IN {IN_STATES} GROUP BY channel_id, y) "
)
# Uploads whose made-for-kids answer is known: those that passed that check (the later checks
# need it), those that failed it, and the floor's eligible ones put back unchecked (`trimmed`).
# v2's picks don't count: they were picked for being made for kids.
ANSWERED = (
    "state IN ('eligible', 'measured', 'collected', 'failed') OR (state = 'ineligible' "
    "AND reason IN ('not_for_kids', 'duration', 'short')) OR (state = 'new' AND reason = 'trimmed')"
)


@dataclass(frozen=True)
class Upload:
    id: str
    channel_id: str
    published_at: str
    r: float
    state: str
    title: str
    description: str
    tags: str
    channel_title: str
    duration_s: int | None
    unsure: int = 0
    api_failures: int = 0
    pick: str = "sample"

    def complete(self) -> bool:
        """Everything the site shows about it is in place (plan 013, decision 12)."""
        return all(
            v.strip() for v in (self.title, self.channel_id, self.channel_title, self.published_at)
        )


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, isolation_level=None)  # autocommit; `transaction()`
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        # With WAL this can lose the last moments on a power cut, never corrupt the file.
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.executescript(SCHEMA)
        self._migrate()

    def _migrate(self) -> None:
        """Adds the columns an older database lacks. Channels that joined after v2's scan were
        read in one go, and a read that failed partway was never finished: they're read again
        in full (adding only the uploads still missing)."""
        for table, columns in ADDED_COLUMNS.items():
            have = {r["name"] for r in self.db.execute(f"PRAGMA table_info({table})")}
            for name, definition in columns.items():
                if name in have:
                    continue
                self.db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
                if (table, name) == ("channels", "full_listing"):
                    self.db.execute(
                        "UPDATE channels SET full_listing = '' "
                        "WHERE status = 'in' AND joined_at > ?",
                        (V2_JOINED,),
                    )

    def close(self) -> None:
        self.db.close()

    def backup(self, path: Path) -> None:
        """A consistent copy of the whole database, made while it's in use (SQLite's online
        backup), written whole and renamed into place."""
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.unlink(missing_ok=True)
        target = sqlite3.connect(tmp)
        try:
            self.db.backup(target)
        finally:
            target.close()
        os.replace(tmp, path)

    @contextmanager
    def transaction(self) -> Iterator[None]:
        self.db.execute("BEGIN")
        done = False
        try:
            yield
            done = True
        finally:
            # Also rolls back when the generator is closed without finishing the block.
            self.db.execute("COMMIT" if done else "ROLLBACK")

    # --- small values --------------------------------------------------------------

    def get(self, key: str, default: str = "") -> str:
        row = self.db.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return str(row["value"]) if row else default

    def set(self, key: str, value: object) -> None:
        self.db.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) "
            "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            (key, str(value)),
        )

    # --- Data API units ------------------------------------------------------------

    def units_used(self, day: str) -> int:
        row = self.db.execute("SELECT used FROM units WHERE day = ?", (day,)).fetchone()
        return int(row["used"]) if row else 0

    def add_units(self, day: str, units: int) -> None:
        self.db.execute(
            "INSERT INTO units (day, used) VALUES (?, ?) "
            "ON CONFLICT (day) DO UPDATE SET used = used + excluded.used",
            (day, units),
        )

    # --- channels ------------------------------------------------------------------

    def upsert_channel(self, **fields: Any) -> None:
        keys = list(fields)
        updates = ", ".join(f"{k} = excluded.{k}" for k in keys if k != "id")
        self.db.execute(
            f"INSERT INTO channels ({', '.join(keys)}) VALUES ({', '.join('?' for _ in keys)}) "
            f"ON CONFLICT (id) DO UPDATE SET {updates}",
            [fields[k] for k in keys],
        )

    def update_channel(self, channel_id: str, **fields: Any) -> None:
        sets = ", ".join(f"{k} = ?" for k in fields)
        self.db.execute(f"UPDATE channels SET {sets} WHERE id = ?", [*fields.values(), channel_id])

    def channel_status(self, channel_id: str) -> str | None:
        row = self.db.execute("SELECT status FROM channels WHERE id = ?", (channel_id,)).fetchone()
        return str(row["status"]) if row else None

    def channels(self, status: str) -> list[sqlite3.Row]:
        return self.db.execute(
            "SELECT * FROM channels WHERE status = ? ORDER BY id", (status,)
        ).fetchall()

    # --- uploads -------------------------------------------------------------------

    def add_uploads(self, channel_id: str, uploads: Iterable[tuple[str, str]]) -> int:
        """Adds uploads not seen before; returns how many were new."""
        before = self.db.total_changes
        self.db.executemany(
            "INSERT OR IGNORE INTO uploads (id, channel_id, published_at, r) VALUES (?, ?, ?, ?)",
            [(vid, channel_id, published, rank(vid)) for vid, published in uploads],
        )
        return self.db.total_changes - before

    def known(self, video_id: str) -> bool:
        return (
            self.db.execute("SELECT 1 FROM uploads WHERE id = ?", (video_id,)).fetchone()
            is not None
        )

    def upload(self, video_id: str) -> Upload | None:
        row = self.db.execute("SELECT * FROM uploads WHERE id = ?", (video_id,)).fetchone()
        return _upload(row) if row else None

    def year_rows(self, now: float, settled_before: str, until: str) -> list[sqlite3.Row]:
        """Each year of the channels that are in, as the channel-first rule and the filters see
        it (decisions 1 and 2), with uploads up to the day `until`: `channel_id`, `y`, its
        videos in the dataset (`videos`) and on the site (`site`), v2's picks (`v2`), the
        eligible uploads the collector found (`found`; also the floor's put back unchecked),
        the uploads whose made-for-kids answer is known (`answers`), all eligible ones
        (`eligible`), those waiting to be downloaded (`waiting`) and ready now (`ready`), the
        unchecked ones (`unchecked`; `fresh` without the floor's put back) and those due for a
        check (`due`; a day old), whether one of those is asked again after an answer that
        couldn't settle it (`unsure`), the lowest number of the eligible ones ready now
        (`low_r`), and its first and last upload (`first`, `last`). One pass over the uploads."""
        return self.db.execute(
            "SELECT channel_id, CAST(SUBSTR(published_at, 1, 4) AS INTEGER) AS y, "
            f"SUM(state IN {IN_STATES}) AS videos, SUM(state IN ('v2', 'collected')) AS site, "
            "SUM(state = 'v2') AS v2, SUM(state IN ('eligible', 'measured', 'collected', "
            "'failed') OR (state = 'new' AND reason = 'trimmed')) AS found, "
            f"SUM({ANSWERED}) AS answers, SUM(state IN ('eligible', 'v2', 'measured', "
            "'collected', 'failed')) AS eligible, SUM(state = 'eligible') AS waiting, "
            "SUM(state = 'eligible' AND retry_at <= :now) AS ready, "
            "SUM(state = 'new') AS unchecked, SUM(state = 'new' AND reason != 'trimmed') AS fresh, "
            "SUM(state = 'new' AND retry_at <= :now AND published_at < :settled) AS due, "
            "MAX(state = 'new' AND retry_at <= :now AND published_at < :settled AND unsure > 0) "
            "AS unsure, "
            "MIN(CASE WHEN state = 'eligible' AND retry_at <= :now THEN r END) AS low_r, "
            "MIN(published_at) AS first, MAX(published_at) AS last FROM uploads "
            "WHERE channel_id IN (SELECT id FROM channels WHERE status = 'in') "
            "AND published_at != '' AND SUBSTR(published_at, 1, 10) <= :until "
            "GROUP BY channel_id, y",
            {"now": now, "settled": settled_before, "until": until},
        ).fetchall()

    def channel_scores(self) -> dict[str, float | None]:
        """Each channel with videos in the dataset: its score as the site ranks it."""
        return {r["channel_id"]: r["score"] for r in self.db.execute(HAVE + "SELECT * FROM have")}

    def left_out_ids(self) -> frozenset[str]:
        return frozenset(r[0] for r in self.db.execute("SELECT channel_id FROM left_out"))

    def lowest_unchecked(
        self, channel_id: str, year: str | None, now: float, settled_before: str, n: int
    ) -> list[str]:
        """The channel's `n` due uploads not checked yet, from `year` (all years from 2015 if
        None): those asked again after an answer that couldn't settle it first, then the
        lowest numbers."""
        first, end = (year, str(int(year) + 1)) if year else ("2015", "9999")
        rows = self.db.execute(
            "SELECT id FROM uploads WHERE channel_id = ? AND state = 'new' AND retry_at <= ? "
            "AND published_at >= ? AND published_at < ? AND published_at < ? "
            "ORDER BY unsure = 0, r LIMIT ?",
            (channel_id, now, first, end, settled_before, n),
        ).fetchall()
        return [str(r["id"]) for r in rows]

    def ready_upload(self, channel_id: str, year: int, now: float) -> Upload | None:
        """The channel's eligible upload from `year` with the lowest number, not waiting for a
        retry."""
        row = self.db.execute(
            "SELECT * FROM uploads WHERE channel_id = ? AND state = 'eligible' AND retry_at <= ? "
            "AND published_at >= ? AND published_at < ? ORDER BY r LIMIT 1",
            (channel_id, now, str(year), str(year + 1)),
        ).fetchone()
        return _upload(row) if row else None

    def first_video(self, now: float) -> Upload | None:
        """A channel's first video (decision 2): of the channels that are in, have no video in
        the dataset, have been judged by the filters (`KIDS_ANSWERS_MIN` answers) and aren't
        left out, the one with the most subscribers (on a tie, the lowest number) that has an
        eligible upload not waiting for a retry; its eligible upload with the lowest number."""
        row = self.db.execute(
            "SELECT u.* FROM uploads u JOIN channels c ON c.id = u.channel_id "
            "WHERE u.state = 'eligible' AND u.retry_at <= ? AND c.status = 'in' "
            f"AND u.channel_id {KEPT} AND u.channel_id NOT IN (SELECT channel_id FROM uploads "
            f"WHERE state IN {IN_STATES}) AND u.channel_id IN (SELECT channel_id FROM uploads "
            f"WHERE {ANSWERED} GROUP BY channel_id HAVING COUNT(*) >= ?) "
            "ORDER BY COALESCE(c.subscriber_count, 0) DESC, u.r LIMIT 1",
            (now, KIDS_ANSWERS_MIN),
        ).fetchone()
        return _upload(row) if row else None

    def subscribers(self) -> dict[str, int]:
        """Each channel's subscribers, as last read (0 when never read)."""
        rows = self.db.execute("SELECT id, COALESCE(subscriber_count, 0) FROM channels")
        return {r[0]: int(r[1]) for r in rows}

    def waiting_channels(self) -> list[sqlite3.Row]:
        """The channels waiting for their first video (in, none in the dataset, not left out),
        in the order they get it: the most subscribers first (decision 2)."""
        return self.db.execute(
            "SELECT id, title, COALESCE(subscriber_count, 0) AS subscribers FROM channels "
            f"WHERE status = 'in' AND id {KEPT} AND id NOT IN (SELECT channel_id FROM uploads "
            f"WHERE state IN {IN_STATES}) ORDER BY subscribers DESC, id"
        ).fetchall()

    def ready(self, now: float) -> int:
        """Eligible uploads that can be downloaded now (not waiting for a retry, not of a
        left-out channel, not a first video once today's are taken)."""
        row = self.db.execute(
            "SELECT COUNT(*) AS n FROM uploads WHERE state = 'eligible' AND retry_at <= ? "
            f"AND channel_id {KEPT} AND (? OR channel_id IN "
            f"(SELECT channel_id FROM uploads WHERE state IN {IN_STATES}))",
            (now, self.first_video_left(now)),
        )
        return int(row.fetchone()["n"])

    def first_videos_today(self, now: float) -> int:
        """Channels that got their first video today (UTC): their first video added today and
        none of v2's."""
        row = self.db.execute(
            "SELECT COUNT(*) FROM (SELECT u.channel_id FROM attempts a "
            "JOIN uploads u ON u.id = a.video_id WHERE a.outcome = 'collected' "
            "GROUP BY u.channel_id HAVING MIN(a.at) >= ?) f WHERE NOT EXISTS "
            "(SELECT 1 FROM uploads v WHERE v.channel_id = f.channel_id AND v.state = 'v2')",
            (now - now % 86400,),
        ).fetchone()
        return int(row[0])

    def has_videos(self, channel_id: str) -> bool:
        """Whether the channel has a video in the dataset."""
        row = self.db.execute(
            f"SELECT 1 FROM uploads WHERE channel_id = ? AND state IN {IN_STATES} LIMIT 1",
            (channel_id,),
        ).fetchone()
        return row is not None

    def catching_up(self) -> frozenset[str]:
        """The channels catching up (decision 2): from their first video until they caught up
        with the channels in."""
        rows = self.db.execute("SELECT id FROM channels WHERE catching_up = 1")
        return frozenset(r[0] for r in rows)

    def set_catching_up(self, channel_id: str, on: bool) -> None:
        self.db.execute("UPDATE channels SET catching_up = ? WHERE id = ?", (int(on), channel_id))

    def first_video_left(self, now: float) -> bool:
        return self.first_videos_today(now) < FIRST_VIDEOS_PER_DAY

    def set_scores(self, scores: Iterable[tuple[str, float | None]]) -> None:
        """Dataset videos' scores, where not set yet (they never change)."""
        self.db.executemany(
            "UPDATE uploads SET score = ? WHERE id = ? AND score IS NULL",
            [(score, video_id) for video_id, score in scores],
        )

    def unscored(self) -> list[sqlite3.Row]:
        """Added videos without a score: `video_id`, `features` (JSON)."""
        return self.db.execute(
            "SELECT c.video_id, c.features FROM collected c JOIN uploads u ON u.id = c.video_id "
            "WHERE u.score IS NULL"
        ).fetchall()

    # --- the changelog's counts and notes (decision 10) ----------------------------

    def ready_to_join(self) -> int:
        """Channels with no video in the dataset but an eligible upload waiting to download;
        left-out channels not counted."""
        row = self.db.execute(
            "SELECT COUNT(DISTINCT channel_id) FROM uploads "
            f"WHERE state = 'eligible' AND channel_id {KEPT} AND channel_id NOT IN "
            "(SELECT channel_id FROM uploads WHERE state IN ('v2', 'collected'))"
        ).fetchone()
        return int(row[0])

    def record_daily(
        self,
        day: str,
        ch_ready: int,
        ch_out: int,
        at: float,
        years: tuple[float | None, float | None] = (None, None),
    ) -> None:
        """The day's counts that can't be worked out again; `years`: `ch_yr_2nd`, `ch_yr_med`."""
        self.db.execute(
            "INSERT OR REPLACE INTO daily (day, ch_ready, ch_out, at, ch_yr_2nd, ch_yr_med) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (day, ch_ready, ch_out, at, *years),
        )

    def fill_years(self, day: str, years: tuple[float | None, float | None]) -> None:
        """Fills in a recorded day's `ch_yr_2nd` and `ch_yr_med` where they're blank."""
        self.db.execute(
            "UPDATE daily SET ch_yr_2nd = COALESCE(ch_yr_2nd, ?), "
            "ch_yr_med = COALESCE(ch_yr_med, ?) WHERE day = ?",
            (*years, day),
        )

    def left_out_at(self, at: float) -> int | None:
        """The channels left out just before `at`, from the log; None if the log began later."""
        start = self.get("left_out_log_from")
        if not start or float(start) >= at:
            return None
        return int(
            self.db.execute(
                "SELECT COUNT(*) FROM left_out_log WHERE change = 'out' AND rowid IN ("
                "SELECT MAX(rowid) FROM left_out_log WHERE at < ? GROUP BY channel_id)",
                (at,),
            ).fetchone()[0]
        )

    def daily(self) -> dict[str, sqlite3.Row]:
        """The recorded counts by day: `ch_ready`, `ch_out`, `ch_yr_2nd` and `ch_yr_med` (None
        before each was recorded) and `at`, the time they stand for (None before it was kept)."""
        return {r["day"]: r for r in self.db.execute("SELECT * FROM daily")}

    def date_notes(self, notes: Iterable[tuple[str, str | None]], today: str) -> None:
        """Dates each note not seen before: its own date if it has one, else today."""
        self.db.executemany(
            "INSERT OR IGNORE INTO notes VALUES (?, ?)",
            [(note, day or today) for note, day in notes],
        )

    def notes(self) -> dict[str, list[str]]:
        """The notes by day, in the order they were dated."""
        out: dict[str, list[str]] = {}
        for r in self.db.execute("SELECT note, day FROM notes ORDER BY rowid"):
            out.setdefault(r["day"], []).append(r["note"])
        return out

    # --- the kids share (decision 1) -----------------------------------------------

    def update_left_out(self, today: str, at: float) -> list[sqlite3.Row]:
        """Works out each channel's kids share and eligible uploads per active year (on `today`)
        from its answers, and keeps the channels left out by either (decision 1), logging at `at`
        who left, came back or changed reason (decision 10); returns them (`channel_id`, `kids`,
        `answers`, `per_year`, `reason`), by ID."""
        kids = {
            r["channel_id"]: (int(r["kids"]), int(r["answers"]))
            for r in self.db.execute(
                "SELECT channel_id, SUM(reason != 'not_for_kids') AS kids, COUNT(*) AS answers "
                f"FROM uploads WHERE {ANSWERED} GROUP BY channel_id"
            )
        }
        per_year = sampling.channel_estimates(self.year_rows(0, "", today), today)
        out = []
        for channel_id in sorted(set(kids) | set(per_year)):
            k, answers = kids.get(channel_id, (0, 0))
            estimate = per_year.get(channel_id)
            reasons = [
                name
                for name, hit in (
                    ("kids_share", left_out(k, answers)),
                    ("per_year", estimate is not None and estimate < PER_YEAR_MIN),
                )
                if hit
            ]
            if reasons:
                out.append(
                    (channel_id, k, answers, estimate, "both" if len(reasons) == 2 else reasons[0])
                )
        logged = bool(self.get("left_out_log_from"))  # before its first judging: all are new
        before = dict(self.db.execute("SELECT channel_id, reason FROM left_out")) if logged else {}
        after = {r[0]: r[4] for r in out}
        changes: list[tuple[str, float, str, str | None]] = [
            (c, at, "out", r) for c, r in after.items() if before.get(c) != r
        ]
        changes += [(c, at, "in", None) for c in before if c not in after]
        with self.transaction():
            self.db.execute("DELETE FROM left_out")
            self.db.executemany(
                "INSERT INTO left_out (channel_id, kids, answers, per_year, reason) "
                "VALUES (?, ?, ?, ?, ?)",
                out,
            )
            self.db.executemany("INSERT INTO left_out_log VALUES (?, ?, ?, ?)", changes)
            if not logged:
                self.set("left_out_log_from", at)
        return self.db.execute("SELECT * FROM left_out ORDER BY channel_id").fetchall()

    def left_out_list(self) -> list[sqlite3.Row]:
        """The channels left out at the last `update_left_out`, by ID: `channel_id`, `title`,
        `kids`, `answers`, `per_year`, `reason`, `since` (when it was last left out, from the
        log; None before it) and `videos` (its videos in the dataset, as the site would count
        them)."""
        return self.db.execute(
            "SELECT l.channel_id, COALESCE(c.title, '') AS title, l.kids, l.answers, l.per_year, "
            "l.reason, "
            "(SELECT MIN(g.at) FROM left_out_log g WHERE g.channel_id = l.channel_id "
            "AND g.at > COALESCE((SELECT MAX(i.at) FROM left_out_log i "
            "WHERE i.channel_id = l.channel_id AND i.change = 'in'), 0)) AS since, "
            "(SELECT COUNT(*) FROM uploads u WHERE u.channel_id = l.channel_id "
            "AND u.state IN ('v2', 'collected')) AS videos "
            "FROM left_out l LEFT JOIN channels c ON c.id = l.channel_id ORDER BY l.channel_id"
        ).fetchall()

    def retrying(self, now: float) -> list[float]:
        """When the uploads waiting for a retry are due, soonest first."""
        rows = self.db.execute(
            "SELECT retry_at FROM uploads WHERE state = 'eligible' AND retry_at > ? "
            "ORDER BY retry_at",
            (now,),
        )
        return [float(r["retry_at"]) for r in rows]

    def requeue_failed(self, below: int) -> int:
        """Failed uploads with fewer than `below` failed downloads become eligible again, due at
        once (those given up before failures were retried); returns how many."""
        before = self.db.total_changes
        self.db.execute(
            "UPDATE uploads SET state = 'eligible', retry_at = 0 WHERE state = 'failed' AND "
            "(SELECT COUNT(*) FROM attempts a WHERE a.video_id = uploads.id "
            "AND a.outcome = 'failed') < ?",
            (below,),
        )
        return self.db.total_changes - before

    def count(self, state: str) -> int:
        row = self.db.execute("SELECT COUNT(*) AS n FROM uploads WHERE state = ?", (state,))
        return int(row.fetchone()["n"])

    def set_state(self, video_id: str, state: str, reason: str = "", **fields: Any) -> None:
        sets = ", ".join(["state = ?", "reason = ?", *(f"{k} = ?" for k in fields)])
        self.db.execute(
            f"UPDATE uploads SET {sets} WHERE id = ?",
            [state, reason, *fields.values(), video_id],
        )

    def in_dataset(self, checked_before: float, now: float, n: int) -> list[Upload]:
        """Dataset videos (v2's and added) not seen online since `checked_before`, and not
        waiting to be checked again."""
        rows = self.db.execute(
            "SELECT * FROM uploads WHERE state IN ('v2', 'collected') "
            "AND COALESCE(online_at, 0) < ? AND retry_at <= ? "
            "ORDER BY COALESCE(online_at, 0), id LIMIT ?",
            (checked_before, now, n),
        ).fetchall()
        return [_upload(r) for r in rows]

    # --- added and removed videos --------------------------------------------------

    def add_collected(
        self,
        video_id: str,
        added_at: str,
        category: str | None,
        features: dict[str, float | None],
        cutoff: float,
        provenance: dict[str, object],
    ) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO collected VALUES (?, ?, ?, ?, ?, ?)",
            (video_id, added_at, category, json.dumps(features), cutoff, json.dumps(provenance)),
        )

    def collected_rows(self) -> list[sqlite3.Row]:
        return self.db.execute(
            "SELECT c.*, u.channel_id, u.channel_title, u.title, u.published_at, u.duration_s, "
            "u.r, u.pick FROM collected c JOIN uploads u ON u.id = c.video_id "
            "WHERE u.state IN ('collected', 'removed') ORDER BY c.added_at, u.id"
        ).fetchall()

    def add_removed(self, video_id: str, removed_at: str, reason: str) -> None:
        self.db.execute(
            "INSERT OR IGNORE INTO removed VALUES (?, ?, ?)", (video_id, removed_at, reason)
        )

    def removed_rows(self) -> list[sqlite3.Row]:
        return self.db.execute("SELECT * FROM removed ORDER BY removed_at, video_id").fetchall()

    # --- download attempts ---------------------------------------------------------

    def log_attempt(self, video_id: str, at: float, outcome: str, message: str = "") -> None:
        """A download attempt; an exploring one (decision 2) if its channel is catching up or
        has no video in the dataset (a first video)."""
        self.db.execute(
            "INSERT INTO attempts (video_id, at, outcome, message, explore) VALUES (?, ?, ?, ?, "
            "COALESCE((SELECT c.catching_up = 1 OR NOT EXISTS (SELECT 1 FROM uploads v "
            f"WHERE v.channel_id = c.id AND v.state IN {IN_STATES}) FROM uploads u "
            "JOIN channels c ON c.id = u.channel_id WHERE u.id = ?), 0))",
            (video_id, at, outcome, message[-500:], video_id),
        )

    def downloads_today(self, now: float) -> tuple[int, int]:
        """Today's (UTC) exploring download attempts and all of them (decision 2)."""
        row = self.db.execute(
            "SELECT COALESCE(SUM(explore), 0), COUNT(*) FROM attempts WHERE at >= ?",
            (now - now % 86400,),
        ).fetchone()
        return int(row[0]), int(row[1])

    def failures(self, video_id: str) -> int:
        """Failed downloads of the video (blocks not counted)."""
        row = self.db.execute(
            "SELECT COUNT(*) AS n FROM attempts WHERE video_id = ? AND outcome = 'failed'",
            (video_id,),
        )
        return int(row.fetchone()["n"])

    def attempts_since(self, since: float) -> int:
        row = self.db.execute("SELECT COUNT(*) AS n FROM attempts WHERE at >= ?", (since,))
        return int(row.fetchone()["n"])


def _upload(row: sqlite3.Row) -> Upload:
    return Upload(
        id=row["id"],
        channel_id=row["channel_id"],
        published_at=row["published_at"],
        r=row["r"],
        state=row["state"],
        title=row["title"],
        description=row["description"],
        tags=row["tags"],
        channel_title=row["channel_title"],
        duration_s=row["duration_s"],
        unsure=row["unsure"],
        api_failures=row["api_failures"],
        pick=row["pick"],
    )
