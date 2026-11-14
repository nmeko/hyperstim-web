"""ResearchPipeline (the research scripts as subprocesses) and the analysis worker thread.

The scripts and YouTube are faked: `_run` is replaced by a recorder that plays a script's
part, and `urlopen` / `subprocess.run` by stand-ins. `_run` itself runs small real
processes.
"""

import io
import json
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from email.message import Message
from pathlib import Path
from typing import Any

import pytest

from hyperstim_api import analysis
from hyperstim_api.analysis import (
    DOWNLOAD_SCRIPT,
    EXTRACT_SCRIPT,
    MIN_CLIP_BYTES,
    AnalysisError,
    Analyzer,
    ResearchPipeline,
    VideoInfo,
)
from hyperstim_api.scoring import FEATURES
from tests.conftest import FakePipeline

VIDEO = "abcdefghijk"
KEY = "secret-api-key"

Script = Callable[[list[str]], str]


class Recorder:
    """Stands in for `ResearchPipeline._run`: records each command and runs `script` for it."""

    def __init__(self, script: Script = lambda cmd: "") -> None:
        self.script = script
        self.calls: list[tuple[list[str], float, int | None]] = []

    def __call__(self, cmd: list[str], timeout: float, cores: int | None = None) -> str:
        self.calls.append((cmd, timeout, cores))
        return self.script(cmd)


def with_run(pipeline: ResearchPipeline, script: Script = lambda cmd: "") -> Recorder:
    recorder = Recorder(script)
    pipeline._run = recorder  # type: ignore[method-assign]
    return recorder


def arg(cmd: list[str], flag: str) -> str:
    return cmd[cmd.index(flag) + 1]


def fail(code: int = 1, stderr: str = "ERROR: boom") -> Script:
    def script(cmd: list[str]) -> str:
        raise subprocess.CalledProcessError(code, cmd, "", stderr)

    return script


def timeout(cmd: list[str]) -> str:
    raise subprocess.TimeoutExpired(cmd, 60)


LOOKUP_OK = json.dumps(
    {
        "title": "Trucks",
        "channel": "Kids",
        "channel_id": "UCkids",
        "duration": 600,
        "live_status": "not_live",
    }
)


# lookup


def test_lookup_runs_yt_dlp_and_parses_its_line(tmp_path: Path) -> None:
    pipeline = ResearchPipeline(cookies=tmp_path / "cookies.txt")
    run = with_run(pipeline, lambda cmd: f"some log\n{LOOKUP_OK}\n")
    assert pipeline.lookup(VIDEO) == VideoInfo("Trucks", "UCkids", "Kids")
    [(cmd, _, cores)] = run.calls
    assert cmd[:3] == [sys.executable, "-m", "yt_dlp"]
    assert "--skip-download" in cmd
    assert arg(cmd, "--cookies") == str(tmp_path / "cookies.txt")
    assert cmd[-1] == f"https://www.youtube.com/watch?v={VIDEO}"
    assert cores is None


def test_lookup_without_cookies() -> None:
    pipeline = ResearchPipeline()
    run = with_run(pipeline, lambda cmd: LOOKUP_OK)
    pipeline.lookup(VIDEO)
    assert "--cookies" not in run.calls[0][0]


@pytest.mark.parametrize(
    ("script", "detail"),
    [
        (fail(stderr="ERROR: Private video"), "ERROR: Private video"),
        (timeout, "timed out after 60 s"),
    ],
)
def test_lookup_failure_is_unavailable(script: Script, detail: str) -> None:
    pipeline = ResearchPipeline()
    with_run(pipeline, script)
    with pytest.raises(AnalysisError) as exc:
        pipeline.lookup(VIDEO)
    assert exc.value.code == "unavailable"
    assert str(exc.value) == detail


# The made-for-kids check (YouTube Data API)


class FakeResponse(io.BytesIO):
    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


def made_for_kids(value: bool) -> bytes:
    return json.dumps({"items": [{"status": {"madeForKids": value}}]}).encode()


@pytest.fixture
def urlopen(monkeypatch: pytest.MonkeyPatch) -> list[urllib.request.Request]:
    """Answers every Data API request with "made for kids"; returns the requests."""
    requests: list[urllib.request.Request] = []

    def fake(request: urllib.request.Request, timeout: float) -> FakeResponse:
        requests.append(request)
        return FakeResponse(made_for_kids(True))

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    return requests


def test_lookup_checks_made_for_kids_with_the_key_in_a_header(
    urlopen: list[urllib.request.Request],
) -> None:
    pipeline = ResearchPipeline(youtube_api_key=KEY)
    with_run(pipeline, lambda cmd: LOOKUP_OK)
    pipeline.lookup(VIDEO)
    [request] = urlopen
    assert request.get_header("X-goog-api-key") == KEY
    assert KEY not in request.full_url
    assert VIDEO in request.full_url


def test_lookup_skips_the_check_without_a_key(urlopen: list[urllib.request.Request]) -> None:
    pipeline = ResearchPipeline()
    with_run(pipeline, lambda cmd: LOOKUP_OK)
    pipeline.lookup(VIDEO)
    assert urlopen == []


def test_lookup_refuses_a_video_not_made_for_kids_before_yt_dlp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda request, timeout: FakeResponse(made_for_kids(False)),
    )
    pipeline = ResearchPipeline(youtube_api_key=KEY)
    run = with_run(pipeline, lambda cmd: LOOKUP_OK)
    with pytest.raises(AnalysisError) as exc:
        pipeline.lookup(VIDEO)
    assert exc.value.code == "not_for_kids"
    assert run.calls == []


@pytest.mark.parametrize(
    "error",
    [
        urllib.error.URLError("no route"),
        TimeoutError("timed out"),
        urllib.error.HTTPError(
            "https://www.googleapis.com/",
            403,
            "Forbidden",
            Message(),
            None,
        ),
    ],
)
def test_data_api_failure_is_failed_and_does_not_leak_the_key(
    monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    def fake(request: urllib.request.Request, timeout: float) -> FakeResponse:
        raise error

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    pipeline = ResearchPipeline(youtube_api_key=KEY)
    with_run(pipeline, lambda cmd: LOOKUP_OK)
    with pytest.raises(AnalysisError) as exc:
        pipeline.lookup(VIDEO)
    assert exc.value.code == "failed"
    assert str(exc.value).startswith("YouTube Data API:")
    assert KEY not in str(exc.value)


# download


def write_clip(size: int) -> Script:
    """The download script's part: a clip of `size` bytes in --clips-dir."""

    def script(cmd: list[str]) -> str:
        clips = Path(arg(cmd, "--clips-dir"))
        clips.mkdir(parents=True, exist_ok=True)
        (clips / f"{VIDEO}.mp4").write_bytes(b"x" * size)
        return ""

    return script


def test_download_runs_the_script_with_a_manifest(tmp_path: Path) -> None:
    pipeline = ResearchPipeline(cookies=tmp_path / "cookies.txt")
    run = with_run(pipeline, write_clip(MIN_CLIP_BYTES + 1))
    pipeline.download(VIDEO, tmp_path)
    [(cmd, _, _)] = run.calls
    assert cmd[:2] == [sys.executable, str(DOWNLOAD_SCRIPT)]
    assert Path(arg(cmd, "--manifest")).read_text() == f"video_id\n{VIDEO}\n"
    assert arg(cmd, "--clips-dir") == str(tmp_path / "clips")
    assert arg(cmd, "--workers") == "1"
    assert arg(cmd, "--cookies") == str(tmp_path / "cookies.txt")


def test_download_without_cookies(tmp_path: Path) -> None:
    pipeline = ResearchPipeline()
    run = with_run(pipeline, write_clip(MIN_CLIP_BYTES + 1))
    pipeline.download(VIDEO, tmp_path)
    assert "--cookies" not in run.calls[0][0]


@pytest.mark.parametrize("script", [fail(), timeout])
def test_download_failure_is_unavailable(tmp_path: Path, script: Script) -> None:
    pipeline = ResearchPipeline()
    with_run(pipeline, script)
    with pytest.raises(AnalysisError) as exc:
        pipeline.download(VIDEO, tmp_path)
    assert exc.value.code == "unavailable"


def test_a_missing_or_tiny_clip_is_unavailable_with_the_logs_last_line(tmp_path: Path) -> None:
    pipeline = ResearchPipeline()
    with_run(pipeline, write_clip(MIN_CLIP_BYTES))  # the script's floor: not enough
    (tmp_path / "download-log-1.tsv").write_text("attempt 1\tok\nattempt 3\tSign in to confirm\n")
    with pytest.raises(AnalysisError) as exc:
        pipeline.download(VIDEO, tmp_path)
    assert exc.value.code == "unavailable"
    assert str(exc.value) == "attempt 3\tSign in to confirm"


def test_no_clip_and_no_log(tmp_path: Path) -> None:
    pipeline = ResearchPipeline()
    with_run(pipeline)  # exits 0 without a clip
    with pytest.raises(AnalysisError) as exc:
        pipeline.download(VIDEO, tmp_path)
    assert (exc.value.code, str(exc.value)) == ("unavailable", "unavailable")


# measure


def extract_and_derive(features: str | None = None, failures: str | None = None) -> Script:
    """The feature script's part: `derive` writes the features TSV; `extract` may note a failure."""

    def script(cmd: list[str]) -> str:
        if cmd[2] == "extract" and failures is not None:
            cache = Path(arg(cmd, "--cache-dir"))
            cache.mkdir(parents=True, exist_ok=True)
            (cache / "failures.tsv").write_text(failures)
        if cmd[2] == "derive" and features is not None:
            Path(arg(cmd, "--out")).write_text(features)
        return ""

    return script


def features_tsv(value: float) -> str:
    header = "\t".join(["video_id", *FEATURES])
    row = "\t".join([VIDEO, *[str(value)] * len(FEATURES)])
    return f"{header}\n{row}\n"


def test_measure_extracts_then_derives_on_limited_cores(tmp_path: Path) -> None:
    pipeline = ResearchPipeline()
    run = with_run(pipeline, extract_and_derive(features_tsv(1.5)))
    assert pipeline.measure(VIDEO, tmp_path) == dict.fromkeys(FEATURES, 1.5)
    (extract, t1, c1), (derive, t2, c2) = run.calls
    assert extract[:3] == [sys.executable, str(EXTRACT_SCRIPT), "extract"]
    assert derive[:3] == [sys.executable, str(EXTRACT_SCRIPT), "derive"]
    assert arg(extract, "--clips-dir") == str(tmp_path / "clips")
    assert arg(extract, "--cache-dir") == arg(derive, "--cache-dir") == str(tmp_path / "cache")
    assert c1 == c2 == analysis.MEASURE_CORES
    # One deadline for both steps.
    assert t2 <= t1 <= analysis.MEASURE_TIMEOUT_S


@pytest.mark.parametrize("script", [fail(stderr="Traceback ... ValueError"), timeout])
def test_measure_failure_is_failed(tmp_path: Path, script: Script) -> None:
    pipeline = ResearchPipeline()
    with_run(pipeline, script)
    with pytest.raises(AnalysisError) as exc:
        pipeline.measure(VIDEO, tmp_path)
    assert exc.value.code == "failed"


def test_measure_reports_why_extract_skipped_the_clip(tmp_path: Path) -> None:
    pipeline = ResearchPipeline()
    with_run(pipeline, extract_and_derive(failures=f"{VIDEO}\tno video stream\n"))
    with pytest.raises(AnalysisError) as exc:
        pipeline.measure(VIDEO, tmp_path)
    assert exc.value.code == "failed"
    assert "no video stream" in str(exc.value)


# channel


@pytest.fixture
def subprocess_run(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    """Stands in for `subprocess.run` with yt-dlp's JSON for a channel; returns the commands."""
    calls: list[list[str]] = []

    def fake(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        calls.append(cmd)
        out = json.dumps({"channel_id": "UCkids", "channel": "Kids"})
        return subprocess.CompletedProcess(cmd, 0, out, "")

    monkeypatch.setattr(subprocess, "run", fake)
    return calls


def test_channel_reads_the_channel_page(subprocess_run: list[list[str]], tmp_path: Path) -> None:
    pipeline = ResearchPipeline(cookies=tmp_path / "c.txt")
    assert pipeline.channel("https://www.youtube.com/@kids") == ("UCkids", "Kids")
    [cmd] = subprocess_run
    assert cmd[:3] == [sys.executable, "-m", "yt_dlp"]
    assert arg(cmd, "--playlist-items") == "0"
    assert arg(cmd, "--cookies") == str(tmp_path / "c.txt")
    assert cmd[-1] == "https://www.youtube.com/@kids"


def test_channel_without_cookies(subprocess_run: list[list[str]]) -> None:
    ResearchPipeline().channel("https://www.youtube.com/@kids")
    assert "--cookies" not in subprocess_run[0]


@pytest.mark.parametrize(
    "error",
    [
        subprocess.CalledProcessError(1, "yt-dlp", "", "ERROR: 404"),
        subprocess.TimeoutExpired("yt-dlp", 60),
    ],
)
def test_channel_failure_is_unavailable(monkeypatch: pytest.MonkeyPatch, error: Exception) -> None:
    def fake(cmd: list[str], **kwargs: object) -> None:
        raise error

    monkeypatch.setattr(subprocess, "run", fake)
    with pytest.raises(AnalysisError) as exc:
        ResearchPipeline().channel("https://www.youtube.com/@nobody")
    assert exc.value.code == "unavailable"


# _run and cancel: small real processes


def python(code: str) -> list[str]:
    return [sys.executable, "-c", code]


def test_run_returns_stdout_and_puts_the_venv_first_on_path() -> None:
    out = ResearchPipeline()._run(
        python("import os; print(os.environ['PATH'].split(os.pathsep)[0])"), 10
    )
    assert out.strip() == str(Path(sys.executable).parent)


def test_run_raises_with_stderr_on_failure() -> None:
    with pytest.raises(subprocess.CalledProcessError) as exc:
        ResearchPipeline()._run(python("import sys; sys.stderr.write('bad'); sys.exit(3)"), 10)
    assert exc.value.returncode == 3
    assert exc.value.stderr == "bad"


def test_run_limits_cores(monkeypatch: pytest.MonkeyPatch) -> None:
    limited: list[tuple[int, int]] = []
    monkeypatch.setattr(analysis, "_limit_cores", lambda pid, cores: limited.append((pid, cores)))
    ResearchPipeline()._run(python("pass"), 10, cores=2)
    assert [cores for _, cores in limited] == [2]


def test_run_kills_what_the_script_started_on_timeout(tmp_path: Path) -> None:
    # The script starts a child that would outlive it; both are stopped.
    marker = tmp_path / "child-done"
    child = f"import time, pathlib; time.sleep(3); pathlib.Path({str(marker)!r}).touch()"
    script = (
        "import subprocess, sys, time; "
        f"subprocess.Popen([sys.executable, '-c', {child!r}]); time.sleep(30)"
    )
    started = time.monotonic()
    with pytest.raises(subprocess.TimeoutExpired):
        ResearchPipeline()._run(python(script), 1)
    assert time.monotonic() - started < 10
    time.sleep(3.5)
    assert not marker.exists()


def test_cancel_stops_the_running_script_and_any_later_one() -> None:
    pipeline = ResearchPipeline()
    errors: list[BaseException] = []

    def run() -> None:
        try:
            pipeline._run(python("import time; time.sleep(30)"), 60)
        except BaseException as exc:  # noqa: BLE001 - handed to the test thread
            errors.append(exc)

    thread = threading.Thread(target=run)
    thread.start()
    deadline = time.monotonic() + 10
    while pipeline._proc is None and time.monotonic() < deadline:
        time.sleep(0.01)
    pipeline.cancel()
    thread.join(timeout=10)
    assert not thread.is_alive()
    [error] = errors
    assert isinstance(error, subprocess.CalledProcessError)
    # A later script doesn't start.
    with pytest.raises(subprocess.CalledProcessError) as later:
        pipeline._run(python("pass"), 10)
    assert (later.value.returncode, later.value.stderr) == (-1, "cancelled")


def test_cancel_with_nothing_running() -> None:
    ResearchPipeline().cancel()


# The worker thread


def wait_for(condition: Callable[[], bool]) -> None:
    deadline = time.monotonic() + 10
    while not condition():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.01)


def status_of(analyzer: Analyzer, video_id: str) -> str:
    snapshot = analyzer.snapshot(video_id)
    return snapshot[0].status if snapshot else "none"


def test_worker_analyzes_queued_videos_until_stopped(
    tmp_path: Path, pipeline: FakePipeline
) -> None:
    analyzer = Analyzer(tmp_path, pipeline, limit_per_ip=0)
    analyzer.start_worker()
    try:
        analyzer.start("live0000001", "1.2.3.4")
        analyzer.start("live0000002", "1.2.3.4")
        wait_for(lambda: status_of(analyzer, "live0000002") == "done")
        assert status_of(analyzer, "live0000001") == "done"
    finally:
        analyzer.stop_worker()
    assert analyzer._thread is not None and not analyzer._thread.is_alive()


class BlockingPipeline(FakePipeline):
    """Its download waits until `cancel()`, then fails, like a killed script."""

    def __init__(self) -> None:
        super().__init__()
        self.downloading = threading.Event()
        self.cancelled = threading.Event()

    def download(self, video_id: str, workdir: Path) -> None:
        self.downloading.set()
        self.cancelled.wait(10)
        raise AnalysisError("unavailable", "cancelled")

    def cancel(self) -> None:
        self.cancelled.set()


def test_stopping_mid_analysis_leaves_it_to_run_again_after_a_restart(tmp_path: Path) -> None:
    pipeline = BlockingPipeline()
    analyzer = Analyzer(tmp_path, pipeline, limit_per_ip=0)
    analyzer.start_worker()
    analyzer.start(VIDEO, "1.2.3.4")
    assert pipeline.downloading.wait(10)
    analyzer.stop_worker()
    # Not marked failed: the shutdown interrupted it.
    assert status_of(analyzer, VIDEO) == "download"
    assert not (tmp_path / "work" / VIDEO).exists()

    restarted = Analyzer(tmp_path, FakePipeline(), limit_per_ip=0)
    snapshot = restarted.snapshot(VIDEO)
    assert snapshot is not None
    assert (snapshot[0].status, snapshot[1]) == ("queued", 0)


def test_stopping_an_idle_worker(tmp_path: Path, pipeline: FakePipeline) -> None:
    analyzer = Analyzer(tmp_path, pipeline, limit_per_ip=0)
    analyzer.stop_worker()  # never started
    analyzer = Analyzer(tmp_path, pipeline, limit_per_ip=0)
    analyzer.start_worker()
    analyzer.stop_worker()
    assert analyzer._thread is not None and not analyzer._thread.is_alive()


# --- the download script's tries (pipeline/58_download_clips_v2.py) -------------------------


def download_script(monkeypatch: pytest.MonkeyPatch, result: Callable[[list[str]], object]) -> Any:
    """The download script as a module, with yt-dlp replaced by `result(cmd)`."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("download_clips", DOWNLOAD_SCRIPT)
    assert spec and spec.loader
    module: Any = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module.subprocess, "run", lambda cmd, **kw: result(cmd))
    return module


def test_a_failed_try_keeps_yt_dlps_full_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stderr = "[debug] yt-dlp version\nERROR: [youtube] x: Video unavailable\n[debug] more\n"
    script = download_script(
        monkeypatch, lambda cmd: subprocess.CompletedProcess(cmd, 1, "progress", stderr)
    )
    out = tmp_path / f"{VIDEO}.mp4"
    status, message = script.attempt(VIDEO, str(out), 30, 300, "18", "", "mweb")
    assert (status, message) == ("error", "ERROR: [youtube] x: Video unavailable")
    log = (tmp_path / f"{VIDEO}.mweb.log").read_text()
    assert "--verbose" in log and "progress" in log and stderr in log


def test_an_empty_clip_and_a_timeout_keep_their_output_too(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    out = tmp_path / f"{VIDEO}.mp4"

    def stub(cmd: list[str]) -> subprocess.CompletedProcess[str]:
        out.write_bytes(b"x" * 262)
        return subprocess.CompletedProcess(cmd, 0, "", "[ffmpeg] 0 packets\n")

    script = download_script(monkeypatch, stub)
    assert script.attempt(VIDEO, str(out), 30, 300, "18", "", None) == (
        "error",
        "exit 0 but wrote 262 B",
    )
    assert "0 packets" in (tmp_path / f"{VIDEO}.default.log").read_text()

    def hang(cmd: list[str]) -> None:
        raise subprocess.TimeoutExpired(cmd, 300, output=b"half", stderr=b"stalled")

    script = download_script(monkeypatch, hang)
    assert script.attempt(VIDEO, str(out), 30, 300, "18", "", "android")[0] == "timeout"
    assert "stalled" in (tmp_path / f"{VIDEO}.android.log").read_text()


def test_a_good_try_keeps_no_log(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    out = tmp_path / f"{VIDEO}.mp4"

    def ok(cmd: list[str]) -> subprocess.CompletedProcess[str]:
        out.write_bytes(b"x" * (MIN_CLIP_BYTES + 1))
        return subprocess.CompletedProcess(cmd, 0, "", "")

    script = download_script(monkeypatch, ok)
    assert script.attempt(VIDEO, str(out), 30, 300, "18", "", None)[0] == "ok"
    assert not list(tmp_path.glob("*.log"))
