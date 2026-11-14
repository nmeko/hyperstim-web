"""Alert issues (plan 013, decision 12): an hourly check that opens a GitHub issue when the
collector, or one of its jobs, hasn't worked for a day, comments when that changes or drags on,
and closes the issue when it works again.

The repo is public, so nothing but fixed text goes out: each title, body and comment is a
template below, and the only values filled in are typed slots (a time, a date, a count, or a
word from a fixed list). A value that doesn't match its slot's type is posted as "unknown".
Error messages, log lines, paths and addresses never reach a slot; the details stay on the
server (`status` and the log).
"""

import calendar
import json
import logging
import re
import subprocess
import time
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from hyperstim_api.collector.store import Store
from hyperstim_api.collector.youtube import quota_day

log = logging.getLogger(__name__)

HOUR_S = 3600
DAY_S = 24 * HOUR_S
OPEN_AFTER_S = DAY_S  # nothing is reported before something has not worked for a day
REOPEN_AFTER_S = DAY_S  # the same kind waits this long after its issue closed
OPENED_PER_DAY = 3  # new issues a day, across all kinds
MARK_DAYS = (3, 7)  # "still not working after n days" comments; none after the last
STATE_CHECKS = 2  # a new state is reported once it has held for this many checks
WAITING_GRACE_S = 6 * DAY_S  # with OPEN_AFTER_S: `waiting-channels` after 7 days without a success
HEARTBEAT_S = HOUR_S  # the collector ticks every minute or so; an hour without one: not running

# --- Typed slots ------------------------------------------------------------------------

STATES = ("running", "blocked", "paused", "waiting-for-quota", "not-running")
JOBS = (
    "upload-lists",
    "details",
    "discovery",
    "waiting-channels",
    "offline-check",
    "repair",
    "export",
    "backup",
    "data-commit",
)
MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec"
SLOT_TYPES = {
    "time": r"\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC",
    "date": rf"\d{{1,2}} (?:{MONTHS}) \d{{4}}",
    "count": r"\d{1,7}",
    "state": "|".join(STATES),
    "job": "|".join(JOBS),
}
UNKNOWN = "unknown"


def slot(kind: str, value: object) -> str:
    """`value` as text if it fits the slot's type, else "unknown"."""
    text = str(value)
    return text if re.fullmatch(SLOT_TYPES[kind], text) else UNKNOWN


def time_slot(t: float | None) -> str:
    return slot("time", time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(t)) if t else "")


def date_slot(t: float | None) -> str:
    if not t:
        return UNKNOWN
    day = time.gmtime(t)
    return slot("date", f"{day.tm_mday} {time.strftime('%b %Y', day)}")


# --- The templates (fixed text; {name} = a slot) -----------------------------------------

STATE_MEANING = {
    "running": "The collector runs, but no video has made it through download and measuring.",
    "blocked": "YouTube is refusing our downloads. The collector waits and tries again by itself.",
    "paused": "Downloads are paused: the clips volume is low on space, or several downloads "
    "failed in a row.",
    "waiting-for-quota": "The day's Data API units are used up; the collector waits for the "
    "next quota day.",
    "not-running": "The collector service has stopped. Someone needs to look at it on the server.",
    UNKNOWN: "",
}
JOB_MEANING = {
    "upload-lists": "Reads the channels' upload lists, so new uploads can be picked.",
    "details": "Checks picked uploads (made for kids, length, not a Short) before they're "
    "downloaded.",
    "discovery": "Searches for new channels, weekly.",
    "waiting-channels": "Reads the subscribers of the channels waiting to join, weekly; they set "
    "the order the channels join in. Reported after a week without a good run.",
    "offline-check": "Checks monthly that the dataset's videos are still online.",
    "repair": "Fills in missing titles, channel names and dates, so waiting videos can go on "
    "the site.",
    "export": "Writes the files the site's API reads; new videos don't show until it works.",
    "backup": "Copies the collector's database to the clips volume, daily.",
    "data-commit": "Copies the day's new videos into this repo. Nothing is lost: the next good "
    "run copies everything since the last one.",
    UNKNOWN: "",
}
DETAILS = "Details: the collector's `status` command and its log on the server."

STALLED_TITLE = "Collector: no video added since {since_date}"
STALLED_BODY = (
    "No video has been added to the dataset since {since}.\n\n"
    "- State: `{state}`. {state_meaning}\n"
    "- Waiting for a retry: {retrying} videos\n\n"
    "This issue closes by itself when videos are added again.\n" + DETAILS
)
STALLED_STATE = "Still no new video. State is now `{state}`. {state_meaning}"
STALLED_MARK = "Still no new video after {days} days. State: `{state}`."

JOB_TITLE = "Collector: {job} not working since {since_date}"
JOB_BODY = (
    "The job `{job}` hasn't worked since {since}.\n\n"
    "- What it does: {job_meaning}\n"
    "- Failures in a row: {failures}\n\n"
    "This issue closes by itself when the job works again.\n" + DETAILS
)
JOB_MARK = "`{job}` still not working after {days} days."

LAST_MARK = " This is the last reminder; the next comment will be when it works again."
RECOVERED = "Working again since {time}."


def fill(template: str, **slots: str) -> str:
    """The template with its slots, each already checked by `slot`; meanings come from the
    fixed lists, looked up by the checked word."""
    values = dict(slots)
    if "state" in values:
        values["state_meaning"] = STATE_MEANING.get(values["state"], "")
    if "job" in values:
        values["job_meaning"] = JOB_MEANING.get(values["job"], "")
    return template.format_map(values)


# --- What the check sees ---------------------------------------------------------------


@dataclass
class Job:
    """`last_ok`: when it last worked; `due_since`: since when it's been due without working
    (None: not due, or not known yet)."""

    last_ok: float | None
    due_since: float | None
    failures: int = 0


@dataclass
class Seen:
    last_added: float | None  # the newest video on the site
    state: str
    retrying: int
    jobs: dict[str, Job] = field(default_factory=dict)


# The collector's Data API jobs (`ok:<name>` after each successful tick), by the job word.
API_JOBS = {
    "upload-lists": ("refresh_uploads", "finish_listings"),
    "details": ("check_candidates",),
    "discovery": ("discover", "check_near_misses"),
    "offline-check": ("check_online",),
    "repair": ("repair",),
}


def parse_utc(text: str) -> float | None:
    try:
        return float(calendar.timegm(time.strptime(text, "%Y-%m-%dT%H:%M:%SZ")))
    except ValueError:
        return None


def observe(store: Store, now: float, data_commit: Job | None) -> Seen:
    """The collector's state from its database, plus the daily commit's (from systemd)."""
    newest = store.db.execute("SELECT MAX(added_at) FROM collected").fetchone()[0]
    tick = float(store.get("tick_at", "0") or 0)
    if now - tick > HEARTBEAT_S:
        state = "not-running"
    elif float(store.get("blocked_until", "0") or 0) > now:
        state = "blocked"
    elif float(store.get("paused_until", "0") or 0) > now or store.get("low_space"):
        state = "paused"
    elif store.get("out_of_units") == quota_day(now):
        state = "waiting-for-quota"
    else:
        state = "running"
    jobs: dict[str, Job] = {}
    for word, names in API_JOBS.items():
        oks = [parse_utc(store.get(f"ok:{name}")) for name in names]
        if all(ok is not None for ok in oks):
            last = min(ok for ok in oks if ok is not None)
            failures = max(int(store.get(f"api_failures:{name}", "0") or 0) for name in names)
            jobs[word] = Job(last, last, failures)  # due on every tick
    # Weekly, retried daily after a failure: reported only after a week without a success.
    if (waiting_ok := parse_utc(store.get("ok:refresh_waiting"))) is not None:
        jobs["waiting-channels"] = Job(
            waiting_ok,
            waiting_ok + WAITING_GRACE_S,
            int(store.get("api_failures:refresh_waiting", "0") or 0),
        )
    if failed_since := store.get("export_failed_since"):
        jobs["export"] = Job(
            parse_utc(store.get("ok:export")),
            float(failed_since),
            int(store.get("export_failures", "0") or 0),
        )
    else:
        jobs["export"] = Job(parse_utc(store.get("ok:export")), None)
    backed_up = parse_utc(store.get("ok:back_up"))
    if backed_up is None and (day := store.get("backed_up")):
        backed_up = parse_utc(f"{day}T00:00:00Z")
    if backed_up is not None:
        jobs["backup"] = Job(
            backed_up, backed_up + DAY_S, int(store.get("backup_failures", "0") or 0)
        )
    if data_commit is not None:
        jobs["data-commit"] = data_commit
    return Seen(
        last_added=parse_utc(newest) if newest else None,
        state=state,
        retrying=len(store.retrying(now)),
        jobs=jobs,
    )


def data_commit_job(memory: dict[str, Any], unit: str, show: Callable[[str], str]) -> Job | None:
    """The daily commit's last success, from systemd's record of its last run (`show`), kept
    in `memory` between checks since systemd only remembers the last run."""
    try:
        fields = dict(line.split("=", 1) for line in show(unit).splitlines() if "=" in line)
        ran = float(fields.get("ExecMainExitTimestamp", "").lstrip("@") or 0)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    if ran > float(memory.get("last_run", 0)):
        memory["last_run"] = ran
        if fields.get("Result") == "success":
            memory.update(last_ok=ran, failures=0, failed_since=None)
        else:
            memory["failures"] = int(memory.get("failures", 0)) + 1
            memory["failed_since"] = memory.get("failed_since") or ran
    last_ok = memory.get("last_ok")
    if last_ok is not None:
        return Job(last_ok, last_ok + DAY_S, int(memory.get("failures", 0)))
    if memory.get("failed_since"):  # it has never worked since we've been watching
        return Job(None, float(memory["failed_since"]), int(memory.get("failures", 0)))
    return None


def systemctl_show(unit: str) -> str:
    return subprocess.run(
        ["systemctl", "show", unit, "-p", "Result", "-p", "ExecMainExitTimestamp",
         "--timestamp=unix"],
        capture_output=True, text=True, timeout=30, check=True,
    ).stdout  # fmt: skip


# --- Deciding what to post --------------------------------------------------------------


@dataclass
class Post:
    """One thing to send: open an issue (`title`, `labels`), or comment on or close the
    issue open for `key`."""

    action: str  # "open", "comment" or "close"
    key: str
    body: str
    title: str = ""
    labels: tuple[str, ...] = ()
    number: int | None = None  # the issue's, for a comment or close


@dataclass
class Problem:
    key: str  # "stalled" or "job:<job>"
    since: float  # when it last worked: names the issue, and tells a new problem from it
    title: str
    body: str
    labels: tuple[str, ...]
    state: str = ""  # stalled only


def problems(seen: Seen, now: float) -> dict[str, Problem]:
    """What has not worked for a day. A stopped collector is one problem, not one per job."""
    found: dict[str, Problem] = {}
    if seen.last_added is not None and now - seen.last_added >= OPEN_AFTER_S:
        state = slot("state", seen.state)
        found["stalled"] = Problem(
            "stalled",
            seen.last_added,
            fill(STALLED_TITLE, since_date=date_slot(seen.last_added)),
            fill(
                STALLED_BODY,
                since=time_slot(seen.last_added),
                state=state,
                retrying=slot("count", seen.retrying),
            ),
            ("alert", "alert:stalled"),
            state,
        )
    for word, job in seen.jobs.items():
        if job.due_since is None or now - job.due_since < OPEN_AFTER_S:
            continue
        if seen.state == "not-running" and word != "data-commit":
            continue  # `stalled` says so
        name = slot("job", word)
        since = job.last_ok if job.last_ok is not None else job.due_since
        found[f"job:{word}"] = Problem(
            f"job:{word}",
            since,
            fill(JOB_TITLE, job=name, since_date=date_slot(since)),
            fill(JOB_BODY, job=name, since=time_slot(since), failures=slot("count", job.failures)),
            ("alert", "alert:job-failing", f"job:{name}"),
        )
    return found


def good_since(seen: Seen, key: str) -> float | None:
    """When the thing behind `key` last worked: the time "Working again since" names."""
    if key == "stalled":
        return seen.last_added
    job = seen.jobs.get(key.removeprefix("job:"))
    return job.last_ok if job else None


def decide(seen: Seen, memory: dict[str, Any], now: float) -> list[Post]:
    """What to post now, updating `memory` (the open issues and when kinds last closed) as if
    every post went out."""
    issues: dict[str, dict[str, Any]] = memory.setdefault("issues", {})
    closed: dict[str, float] = memory.setdefault("closed_at", {})
    opened = [t for t in memory.get("opened", []) if now - t < DAY_S]
    current = problems(seen, now)
    posts: list[Post] = []
    for key, issue in list(issues.items()):
        problem = current.get(key)
        if problem is None or problem.since != issue["since"]:
            back = good_since(seen, key)
            text = fill(RECOVERED, time=time_slot(back or now))
            posts.append(Post("close", key, text, number=issue.get("number")))
            del issues[key]
            closed[key] = now
            continue
        if seen.state == "not-running" and key != "stalled":
            continue  # quiet while the collector is down; `stalled` speaks for it
        if problem.state and problem.state != issue["state"]:
            if problem.state == issue.get("pending"):
                issue["pending_checks"] += 1
            else:
                issue["pending"], issue["pending_checks"] = problem.state, 1
            if issue["pending_checks"] >= STATE_CHECKS:
                text = fill(STALLED_STATE, state=problem.state)
                posts.append(Post("comment", key, text, number=issue.get("number")))
                issue["state"] = problem.state
                issue.pop("pending")
        else:
            issue.pop("pending", None)
        days = int((now - issue["since"]) // DAY_S)
        for mark in MARK_DAYS:
            if days >= mark and mark not in issue["marks"]:
                issue["marks"].append(mark)
                if mark != max(m for m in MARK_DAYS if m <= days):
                    continue  # only the latest mark reached, after a gap in the checks
                if key == "stalled":
                    text = fill(STALLED_MARK, days=slot("count", mark), state=issue["state"])
                else:
                    text = fill(JOB_MARK, job=slot("job", key.removeprefix("job:")),
                                days=slot("count", mark))  # fmt: skip
                if mark == MARK_DAYS[-1]:
                    text += LAST_MARK
                posts.append(Post("comment", key, text, number=issue.get("number")))
    for key, problem in current.items():
        if key in issues or now - closed.get(key, 0) < REOPEN_AFTER_S:
            continue
        if len(opened) >= OPENED_PER_DAY:
            log.warning("Alert %s held back: %d issues opened in 24 h", key, len(opened))
            continue
        posts.append(Post("open", key, problem.body, problem.title, problem.labels))
        passed = [m for m in MARK_DAYS if now - problem.since >= m * DAY_S]  # opened late
        issues[key] = {"since": problem.since, "state": problem.state, "marks": passed}
        opened.append(now)
    memory["opened"] = opened
    return posts


# --- Sending ----------------------------------------------------------------------------


class Issues(Protocol):
    def find_open(self, labels: tuple[str, ...]) -> int | None: ...
    def open(self, title: str, body: str, labels: tuple[str, ...]) -> int: ...
    def comment(self, number: int, body: str) -> None: ...
    def close(self, number: int, body: str) -> None: ...


class GitHubIssues:
    """GitHub's REST API with a fine-grained token that may only read and write issues."""

    def __init__(self, repo: str, token: str) -> None:
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
            raise ValueError("ALERT_REPO must be <owner>/<name>")
        self.base = f"https://api.github.com/repos/{repo}"
        self.token = token

    def _call(self, method: str, path: str, data: Mapping[str, object] | None = None) -> Any:
        request = urllib.request.Request(
            self.base + path,
            method=method,
            data=json.dumps(data).encode() if data is not None else None,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "hyperstim-alerts",
            },
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    def find_open(self, labels: tuple[str, ...]) -> int | None:
        found = self._call("GET", f"/issues?state=open&labels={','.join(labels)}&per_page=1")
        return int(found[0]["number"]) if found else None

    def open(self, title: str, body: str, labels: tuple[str, ...]) -> int:
        return int(self._call("POST", "/issues", {"title": title, "body": body,
                                                  "labels": list(labels)})["number"])  # fmt: skip

    def comment(self, number: int, body: str) -> None:
        self._call("POST", f"/issues/{number}/comments", {"body": body})

    def close(self, number: int, body: str) -> None:
        self.comment(number, body)
        self._call("PATCH", f"/issues/{number}", {"state": "closed", "state_reason": "completed"})


class LogOnly:
    """No token: what would be posted goes to the log (local runs, or before the token)."""

    def __init__(self) -> None:
        self.next = 1

    def find_open(self, labels: tuple[str, ...]) -> int | None:
        return None

    def open(self, title: str, body: str, labels: tuple[str, ...]) -> int:
        log.info("Would open an issue %s: %s\n%s", ",".join(labels), title, body)
        self.next += 1
        return self.next - 1

    def comment(self, number: int, body: str) -> None:
        log.info("Would comment on #%d: %s", number, body)

    def close(self, number: int, body: str) -> None:
        log.info("Would close #%d: %s", number, body)


def send(posts: list[Post], memory: dict[str, Any], issues: Issues) -> None:
    """Sends the posts, remembering each new issue's number. One that fails is logged; the
    next check sends it again only if it's still due (opening is retried, comments aren't)."""
    for post in posts:
        try:
            if post.action == "open":
                number = issues.find_open(post.labels) or issues.open(
                    post.title, post.body, post.labels
                )
                memory["issues"][post.key]["number"] = number
                continue
            if post.number is None:  # its opening never went out
                continue
            if post.action == "comment":
                issues.comment(post.number, post.body)
            else:
                issues.close(post.number, post.body)
        except Exception as exc:  # the network, GitHub: never the content, which is fixed
            log.warning("Alert %s %s not sent: %s", post.action, post.key, type(exc).__name__)
            if post.action == "open":
                memory["issues"].pop(post.key, None)
                memory["opened"] = memory["opened"][:-1]


def check(
    store: Store,
    memory_path: Path,
    issues: Issues,
    now: float,
    data_unit: str | None = None,
    show: Callable[[str], str] = systemctl_show,
) -> list[Post]:
    """One hourly check: what's wrong, what to post, sent; `memory_path` keeps the open issues
    and the daily commit's record between checks."""
    try:
        memory: dict[str, Any] = json.loads(memory_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        memory = {}
    commit = data_commit_job(memory.setdefault("data_commit", {}), data_unit, show) \
        if data_unit else None  # fmt: skip
    posts = decide(observe(store, now, commit), memory, now)
    send(posts, memory, issues)
    tmp = memory_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(memory, indent=1), encoding="utf-8")
    tmp.replace(memory_path)
    return posts
