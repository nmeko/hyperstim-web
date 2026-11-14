"""The alert issues (plan 013, decision 12): fixed text with typed slots, nothing before a day,
comments only on a change or at 3 and 7 days, closing on recovery, and the limits."""

import json
from pathlib import Path
from typing import Any

import pytest

from hyperstim_api.collector import alerts
from hyperstim_api.collector.alerts import DAY_S, HOUR_S, Job, Seen
from hyperstim_api.collector.collector import utc
from hyperstim_api.collector.store import Store
from tests.conftest import FakePipeline
from tests.test_collector import Clock, FakeYouTube, make_collector

T0 = 1_793_000_000.0  # 2026-10-26 (a Monday), 07:33 UTC


def seen(
    last_added: float | None = T0, state: str = "running", jobs: dict[str, Job] | None = None
) -> Seen:
    return Seen(last_added=last_added, state=state, retrying=2, jobs=jobs or {})


class FakeIssues:
    def __init__(self) -> None:
        self.log: list[tuple[Any, ...]] = []
        self.number = 40

    def find_open(self, labels: tuple[str, ...]) -> int | None:
        return None

    def open(self, title: str, body: str, labels: tuple[str, ...]) -> int:
        self.number += 1
        self.log.append(("open", self.number, title, body, labels))
        return self.number

    def comment(self, number: int, body: str) -> None:
        self.log.append(("comment", number, body))

    def close(self, number: int, body: str) -> None:
        self.log.append(("close", number, body))


def hourly(start: float, hours: int, see: Any, memory: dict[str, Any]) -> list[alerts.Post]:
    """Runs `decide` every hour from `start`; `see(now)` gives what the check sees."""
    posts = []
    for h in range(hours):
        now = start + h * HOUR_S
        posts += alerts.decide(see(now), memory, now)
    return posts


@pytest.mark.parametrize(
    ("kind", "value", "expected"),
    [
        ("count", 3, "3"),
        ("count", "3 (see https://rr2---sn-x.googlevideo.com/…)", "unknown"),
        ("state", "blocked", "blocked"),
        ("state", "ERROR: HTTP Error 403 (from 203.0.113.7)", "unknown"),
        ("job", "backup", "backup"),
        ("job", "/srv/x/collector.db: database is locked", "unknown"),
        ("time", "2026-11-03 09:14 UTC", "2026-11-03 09:14 UTC"),
        ("time", "2026-11-03 09:14 UTC on host-1", "unknown"),
        ("date", "3 Nov 2026", "3 Nov 2026"),
        ("date", "3 Nov 2026\nmore", "unknown"),
    ],
)
def test_a_slot_takes_only_its_type(kind: str, value: object, expected: str) -> None:
    assert alerts.slot(kind, value) == expected


def test_every_template_fills_from_slots_only() -> None:
    title = alerts.fill(alerts.STALLED_TITLE, since_date=alerts.date_slot(T0))
    assert title == "Collector: no video added since 26 Oct 2026"
    body = alerts.fill(
        alerts.STALLED_BODY, since=alerts.time_slot(T0), state="blocked", retrying="3"
    )
    assert "since 2026-10-26 07:33 UTC" in body
    assert "YouTube is refusing our downloads" in body
    job = alerts.fill(alerts.JOB_BODY, job="data-commit", since="unknown", failures="2")
    assert "Nothing is lost" in job
    assert alerts.fill(alerts.STALLED_BODY, since="x", state="unknown", retrying="1")


def test_nothing_is_opened_before_a_day() -> None:
    memory: dict[str, Any] = {}
    assert alerts.decide(seen(), memory, T0 + 23 * HOUR_S) == []
    [post] = alerts.decide(seen(), memory, T0 + DAY_S)
    assert post.action == "open"
    assert post.title == "Collector: no video added since 26 Oct 2026"
    assert post.labels == ("alert", "alert:stalled")


def test_an_unchanged_problem_gets_no_comments_until_3_and_7_days() -> None:
    memory: dict[str, Any] = {}
    posts = hourly(T0 + DAY_S, 8 * 24, lambda now: seen(), memory)
    assert [p.action for p in posts] == ["open", "comment", "comment"]
    assert posts[1].body == "Still no new video after 3 days. State: `running`."
    assert posts[2].body.startswith("Still no new video after 7 days.")
    assert posts[2].body.endswith("the next comment will be when it works again.")
    assert hourly(T0 + 9 * DAY_S, 24 * 5, lambda now: seen(), memory) == []


def test_a_state_change_is_reported_once_it_held_for_two_checks() -> None:
    memory: dict[str, Any] = {}
    alerts.decide(seen(state="not-running"), memory, T0 + DAY_S)
    # A one-check flicker isn't reported.
    assert alerts.decide(seen(state="blocked"), memory, T0 + DAY_S + HOUR_S) == []
    assert alerts.decide(seen(state="not-running"), memory, T0 + DAY_S + 2 * HOUR_S) == []
    assert alerts.decide(seen(state="blocked"), memory, T0 + DAY_S + 3 * HOUR_S) == []
    [post] = alerts.decide(seen(state="blocked"), memory, T0 + DAY_S + 4 * HOUR_S)
    assert post.body.startswith("Still no new video. State is now `blocked`.")
    assert alerts.decide(seen(state="blocked"), memory, T0 + DAY_S + 5 * HOUR_S) == []


def test_recovery_closes_and_the_kind_waits_a_day_before_opening_again() -> None:
    memory: dict[str, Any] = {}
    alerts.decide(seen(), memory, T0 + DAY_S)
    back = T0 + DAY_S + 30 * 60
    [close] = alerts.decide(seen(last_added=back), memory, T0 + DAY_S + HOUR_S)
    assert close.action == "close"
    assert close.body == "Working again since 2026-10-27 08:03 UTC."
    # Stalled again a day later, but the issue closed under 24 h ago: held back for an hour.
    assert alerts.decide(seen(last_added=back), memory, back + DAY_S) == []
    [again] = alerts.decide(seen(last_added=back), memory, back + DAY_S + HOUR_S)
    assert again.action == "open"


def test_at_most_3_issues_a_day() -> None:
    memory: dict[str, Any] = {}
    jobs = {w: Job(T0, T0) for w in ("repair", "details", "discovery", "upload-lists")}
    posts = alerts.decide(seen(jobs=jobs), memory, T0 + DAY_S)
    assert [p.key for p in posts] == ["stalled", "job:repair", "job:details"]
    assert alerts.decide(seen(jobs=jobs), memory, T0 + DAY_S + HOUR_S) == []
    later = alerts.decide(seen(jobs=jobs), memory, T0 + 2 * DAY_S + HOUR_S)
    assert [p.key for p in later] == ["job:discovery", "job:upload-lists"]


def test_a_failing_job_is_named_by_when_it_last_worked() -> None:
    memory: dict[str, Any] = {}
    backup = Job(T0, T0 + DAY_S, failures=26)  # daily: due a day after it last worked

    def at(now: float) -> list[alerts.Post]:
        return alerts.decide(
            seen(now - HOUR_S, jobs={"backup": backup}), memory, now
        )  # videos come in

    assert at(T0 + 47 * HOUR_S) == []
    [post] = at(T0 + 2 * DAY_S)
    assert post.title == "Collector: backup not working since 26 Oct 2026"
    assert "- Failures in a row: 26" in post.body
    assert post.labels == ("alert", "alert:job-failing", "job:backup")
    [mark] = at(T0 + 3 * DAY_S)
    assert mark.body == "`backup` still not working after 3 days."


def test_a_failing_waiting_channels_refresh_is_retried_daily_and_reported_after_a_week(
    tmp_path: Path, pipeline: FakePipeline
) -> None:
    clock = Clock()
    youtube = FakeYouTube()
    collector = make_collector(tmp_path, youtube, pipeline, clock)
    store = collector.store
    waiting = "UC" + "w" * 22
    store.upsert_channel(id=waiting, title="W", status="in", source="discovery")
    youtube.channels[waiting] = ("W", 50_000, 200)
    start = clock()
    collector.api_job(collector.refresh_waiting, start)  # a good run
    store.update_channel(waiting, checked_at=utc(start - 8 * DAY_S))  # due again
    youtube.fails = lambda method, params: method == "channels"
    youtube.calls.clear()
    memory: dict[str, Any] = {}
    reported: list[float] = []
    for h in range(1, 8 * 24 + 1):
        now = start + h * HOUR_S
        collector.api_job(collector.refresh_waiting, now)
        store.set("tick_at", now)
        for post in alerts.decide(alerts.observe(store, now, None), memory, now):
            if post.key == "job:waiting-channels" and post.action == "open":
                reported.append(h)
                assert post.title == "Collector: waiting-channels not working since 26 Oct 2026"
                assert post.labels == ("alert", "alert:job-failing", "job:waiting-channels")
    # Tried at hour 1, again 1 hour and then 6 hours later, then once a day: 1, 2, 8, 32, …
    assert len(youtube.calls) == len([1, 2, *range(8, 8 * 24 + 1, 24)])
    assert reported == [7 * 24]  # not before a whole week without a good run
    youtube.fails = lambda method, params: False
    later = start + 8 * DAY_S + DAY_S
    collector.api_job(collector.refresh_waiting, later)
    assert "waiting-channels" in alerts.observe(store, later, None).jobs
    closes = alerts.decide(alerts.observe(store, later, None), memory, later)
    assert [p.action for p in closes if p.key == "job:waiting-channels"] == ["close"]


def test_a_stopped_collector_is_one_issue_not_one_per_job() -> None:
    memory: dict[str, Any] = {}
    jobs = {"repair": Job(T0, T0), "data-commit": Job(T0, T0 + DAY_S)}
    posts = alerts.decide(seen(state="not-running", jobs=jobs), memory, T0 + 2 * DAY_S)
    assert [p.key for p in posts] == ["stalled", "job:data-commit"]


def test_the_daily_commit_is_followed_through_systemds_last_run() -> None:
    memory: dict[str, Any] = {}

    def run(at: float, result: str) -> Job | None:
        return alerts.data_commit_job(
            memory, "x-data.service", lambda unit: f"Result={result}\nExecMainExitTimestamp=@{at}"
        )

    assert run(T0, "success") == Job(T0, T0 + DAY_S, 0)
    assert run(T0 + DAY_S, "exit-code") == Job(T0, T0 + DAY_S, 1)
    assert run(T0 + DAY_S, "exit-code") == Job(T0, T0 + DAY_S, 1)  # the same run, seen again
    assert run(T0 + 2 * DAY_S, "exit-code") == Job(T0, T0 + DAY_S, 2)
    assert run(T0 + 3 * DAY_S, "success") == Job(T0 + 3 * DAY_S, T0 + 4 * DAY_S, 0)


def test_the_check_reads_the_collector_and_sends(tmp_path: Path) -> None:
    store = Store(tmp_path / "collector.db")
    store.db.execute("INSERT INTO collected VALUES ('v1', ?, 'music', '{}', 0.1, '{}')", (utc(T0),))
    store.set("tick_at", T0 + 2 * DAY_S)  # running
    store.set("blocked_until", T0 + 3 * DAY_S)
    store.set("ok:repair", utc(T0 + 2 * DAY_S))
    issues = FakeIssues()
    memory = tmp_path / "alerts.json"
    alerts.check(store, memory, issues, T0 + 2 * DAY_S)
    [(action, number, title, body, labels)] = issues.log
    assert (action, number, title) == ("open", 41, "Collector: no video added since 26 Oct 2026")
    assert "State: `blocked`" in body
    assert json.loads(memory.read_text())["issues"]["stalled"]["number"] == 41

    store.db.execute(
        "INSERT INTO collected VALUES ('v2', ?, 'music', '{}', 0.1, '{}')",
        (utc(T0 + 2 * DAY_S + 600),),
    )
    alerts.check(store, memory, issues, T0 + 2 * DAY_S + HOUR_S)
    assert issues.log[-1] == ("close", 41, "Working again since 2026-10-28 07:43 UTC.")
    assert json.loads(memory.read_text())["issues"] == {}


def test_a_failed_send_is_tried_again_at_the_next_check(tmp_path: Path) -> None:
    store = Store(tmp_path / "collector.db")
    store.db.execute("INSERT INTO collected VALUES ('v1', ?, 'music', '{}', 0.1, '{}')", (utc(T0),))

    class Down(FakeIssues):
        def open(self, title: str, body: str, labels: tuple[str, ...]) -> int:
            raise OSError("network down")

    memory = tmp_path / "alerts.json"
    alerts.check(store, memory, Down(), T0 + DAY_S)
    assert json.loads(memory.read_text())["issues"] == {}
    issues = FakeIssues()
    alerts.check(store, memory, issues, T0 + DAY_S + HOUR_S)
    assert issues.log[0][0] == "open"


def test_the_collector_records_what_the_check_reads(tmp_path: Path, pipeline: FakePipeline) -> None:
    """The heartbeat, the backup's time and the export's failures (collector.py)."""
    clock = Clock()
    collector = make_collector(tmp_path, FakeYouTube(), pipeline, clock)
    store = collector.store
    collector.tick()
    assert float(store.get("tick_at")) == clock()
    assert store.get("ok:back_up") == utc(clock())
    folder = tmp_path / "data" / "collected"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "removed.tsv").unlink(missing_ok=True)
    (folder / "removed.tsv").mkdir()  # the export can't replace a folder
    collector.export()
    assert store.get("export_failures") == "1"
    assert float(store.get("export_failed_since")) == clock()
