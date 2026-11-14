import json
import os
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hyperstim_api.analysis import (
    MAX_QUEUE,
    MIN_DURATION_S,
    STEP_CAP,
    TYPICAL_S,
    AnalysisError,
    Analyzer,
    Busy,
    Record,
    TooManyRequests,
    _limit_cores,
    check_made_for_kids,
    estimate,
    parse_features,
    parse_lookup,
)
from hyperstim_api.scoring import FEATURES
from tests.conftest import ORIGIN, FakePipeline, video_row, write_dataset

# Dataset videos (11-character IDs, so they pass the ID check) with every feature equal
# to 0..11; a live video gets 5.5 everywhere (FakePipeline), which sits just above the
# dataset's 5, so its feature percentiles and score are all 100 * 5 / 11.
DATASET_IDS = [f"data{n:07d}" for n in range(12)]
LIVE_PCT = round(100 * 5 / 11, 1)


def live(n: int) -> str:
    return f"live{n:07d}"


@pytest.fixture
def dataset(tmp_path: Path) -> Path:
    rows = [video_row(video_id, "UC-data", float(n)) for n, video_id in enumerate(DATASET_IDS)]
    return write_dataset(tmp_path / "videos.tsv", rows)


@pytest.fixture
def client(dataset: Path, make_client: Callable[..., TestClient]) -> TestClient:
    return make_client(dataset)


def analyzer_of(client: TestClient) -> Analyzer:
    return cast(Analyzer, cast(FastAPI, client.app).state.analyzer)


def status(client: TestClient, video_id: str) -> dict[str, object]:
    response = client.get(f"/api/analyses/{video_id}")
    assert response.status_code == 200
    return cast(dict[str, object], response.json())


def test_live_analysis_runs_to_a_result(client: TestClient) -> None:
    before = client.get("/api/videos", params={"limit": 100}).json()

    started = client.post(f"/api/analyses/{live(1)}")
    assert started.status_code == 202
    queued = {
        "status": "queued",
        "queuePosition": 0,
        "progress": 0.0,
        "remainingS": None,
        "error": None,
    }
    assert started.json() == queued
    assert status(client, live(1)) == queued
    assert client.get(f"/api/videos/{live(1)}").status_code == 404

    assert analyzer_of(client).run_next()
    assert status(client, live(1)) == {
        **queued,
        "status": "done",
        "queuePosition": None,
        "progress": 1.0,
    }
    detail = client.get(f"/api/videos/{live(1)}").json()
    assert {k: v for k, v in detail.items() if k != "features"} == {
        "id": live(1),
        "title": f"Live {live(1)}",
        "channelId": "UC-live",
        "channel": "Live channel",
        "score": LIVE_PCT,
        "channelInDataset": False,  # no link to a channel page we don't have
    }
    assert detail["features"] == [
        {"key": name, "value": 5.5, "percentile": LIVE_PCT} for name in FEATURES
    ]

    # The dataset is untouched: same count, same rankings and scores, no live video.
    assert client.get("/api/meta").json()["videoCount"] == len(DATASET_IDS)
    assert client.get("/api/videos", params={"limit": 100}).json() == before
    assert client.get(f"/api/videos/{DATASET_IDS[5]}").json()["score"] == LIVE_PCT


def test_a_live_video_from_a_dataset_channel_links_to_it(
    client: TestClient, pipeline: FakePipeline
) -> None:
    pipeline.channels[live(1)] = "UC-data"
    client.post(f"/api/analyses/{live(1)}")
    analyzer_of(client).run_next()
    assert client.get(f"/api/videos/{live(1)}").json()["channelInDataset"] is True


def test_steps_are_reported(client: TestClient, pipeline: FakePipeline) -> None:
    seen: list[object] = []
    pipeline.during = lambda step, video_id, _: seen.append(status(client, video_id)["status"])
    client.post(f"/api/analyses/{live(1)}")
    analyzer_of(client).run_next()
    assert seen == ["lookup", "download", "measure"]


def test_progress_while_running(client: TestClient, pipeline: FakePipeline) -> None:
    seen: list[dict[str, object]] = []
    pipeline.during = lambda step, video_id, _: seen.append(status(client, video_id))
    client.post(f"/api/analyses/{live(1)}")
    analyzer_of(client).run_next()
    progress = [cast(float, s["progress"]) for s in seen]
    assert 0 <= progress[0] < progress[1] < progress[2] < 1
    assert all(isinstance(s["remainingS"], int) for s in seen)


def test_start_joins_a_stored_or_running_analysis(client: TestClient) -> None:
    assert client.post(f"/api/analyses/{live(1)}").status_code == 202
    again = client.post(f"/api/analyses/{live(1)}")
    assert again.status_code == 200
    assert again.json()["status"] == "queued"
    analyzer = analyzer_of(client)
    assert analyzer.run_next()
    assert not analyzer.run_next()  # queued once only
    done = client.post(f"/api/analyses/{live(1)}")
    assert (done.status_code, done.json()["status"]) == (200, "done")


def test_a_dataset_video_is_done_at_once(client: TestClient) -> None:
    response = client.post(f"/api/analyses/{DATASET_IDS[3]}")
    assert response.status_code == 200
    assert response.json()["status"] == "done"
    assert not analyzer_of(client).run_next()


def test_queue_positions(client: TestClient, pipeline: FakePipeline) -> None:
    for n in range(3):
        client.post(f"/api/analyses/{live(n)}")
    assert [status(client, live(n))["queuePosition"] for n in range(3)] == [0, 1, 2]

    # While the first runs, it is ahead of the others too.
    seen: list[list[object]] = []
    pipeline.during = lambda step, video_id, _: seen.append(
        [status(client, live(n))["queuePosition"] for n in range(3)]
    )
    analyzer_of(client).run_next()
    assert seen[0] == [None, 1, 2]
    assert status(client, live(1))["queuePosition"] == 0


def test_queue_full(dataset: Path, make_client: Callable[..., TestClient]) -> None:
    client = make_client(dataset, limit_per_ip=0)
    for n in range(MAX_QUEUE):
        assert client.post(f"/api/analyses/{live(n)}").status_code == 202
    full = client.post(f"/api/analyses/{live(99)}")
    assert (full.status_code, full.json()) == (503, {"detail": "Busy"})
    assert client.get(f"/api/analyses/{live(99)}").status_code == 404  # nothing stored
    assert client.post(f"/api/analyses/{live(0)}").status_code == 200  # joining still works


def test_limit_per_ip(dataset: Path, make_client: Callable[..., TestClient]) -> None:
    client = make_client(dataset, limit_per_ip=2)
    assert client.post(f"/api/analyses/{live(1)}").status_code == 202
    assert client.post(f"/api/analyses/{live(2)}").status_code == 202
    over = client.post(f"/api/analyses/{live(3)}")
    assert (over.status_code, over.json()) == (429, {"detail": "Too many requests"})
    assert client.get(f"/api/analyses/{live(3)}").status_code == 404
    assert client.post(f"/api/analyses/{live(1)}").status_code == 200  # joining doesn't count
    assert client.post(f"/api/analyses/{DATASET_IDS[0]}").status_code == 200  # nor dataset videos


def test_no_limit_when_off(dataset: Path, make_client: Callable[..., TestClient]) -> None:
    client = make_client(dataset, limit_per_ip=0)
    for n in range(MAX_QUEUE):
        assert client.post(f"/api/analyses/{live(n)}").status_code == 202


def test_limit_counts_per_ip_within_an_hour(tmp_path: Path) -> None:
    now = [1000.0]
    analyzer = Analyzer(tmp_path, FakePipeline(), limit_per_ip=2, clock=lambda: now[0])
    analyzer.start(live(1), "ip-a")
    analyzer.start(live(2), "ip-a")
    with pytest.raises(TooManyRequests):
        analyzer.start(live(3), "ip-a")
    analyzer.start(live(3), "ip-b")
    now[0] += 3599
    with pytest.raises(TooManyRequests):
        analyzer.start(live(4), "ip-a")
    now[0] += 1
    analyzer.start(live(4), "ip-a")


def test_a_full_queue_does_not_count_toward_the_limit(tmp_path: Path) -> None:
    analyzer = Analyzer(tmp_path, FakePipeline(), limit_per_ip=MAX_QUEUE + 1)
    for n in range(MAX_QUEUE):
        analyzer.start(live(n), "ip-a")
    with pytest.raises(Busy):
        analyzer.start(live(50), "ip-a")
    analyzer.run_next()
    analyzer.start(live(50), "ip-a")  # the 11th counted; the refused one didn't


def test_limit_per_day(dataset: Path, make_client: Callable[..., TestClient]) -> None:
    client = make_client(dataset, limit_per_ip=0, limit_per_day=2)
    assert client.post(f"/api/analyses/{live(1)}").status_code == 202
    assert client.post(f"/api/analyses/{live(2)}").status_code == 202
    over = client.post(f"/api/analyses/{live(3)}")
    assert (over.status_code, over.json()) == (503, {"detail": "Busy"})
    assert client.post(f"/api/analyses/{live(1)}").status_code == 200  # joining doesn't count


def test_limit_per_day_counts_all_ips_within_a_day(tmp_path: Path) -> None:
    now = [100_000.0]
    analyzer = Analyzer(tmp_path, FakePipeline(), 0, limit_per_day=2, clock=lambda: now[0])
    analyzer.start(live(1), "ip-a")
    analyzer.start(live(2), "ip-b")
    with pytest.raises(Busy):
        analyzer.start(live(3), "ip-c")
    now[0] += 24 * 3600 - 1
    with pytest.raises(Busy):
        analyzer.start(live(3), "ip-c")
    now[0] += 1
    analyzer.start(live(3), "ip-c")


def test_limit_per_day_survives_a_restart(tmp_path: Path) -> None:
    now = [100_000.0]
    first = Analyzer(tmp_path, FakePipeline(), 0, limit_per_day=2, clock=lambda: now[0])
    first.start(live(1), "ip-a")
    now[0] += 60
    first.start(live(2), "ip-a")
    again = Analyzer(tmp_path, FakePipeline(), 0, limit_per_day=2, clock=lambda: now[0])
    with pytest.raises(Busy):
        again.start(live(3), "ip-a")
    now[0] += 24 * 3600 - 59  # the first one is out of the day
    again.start(live(3), "ip-a")


def test_over_the_day_limit_does_not_count_toward_the_ip_limit(tmp_path: Path) -> None:
    now = [100_000.0]
    analyzer = Analyzer(tmp_path, FakePipeline(), 1, limit_per_day=1, clock=lambda: now[0])
    analyzer.start(live(1), "ip-a")
    with pytest.raises(Busy):
        analyzer.start(live(2), "ip-b")
    now[0] += 24 * 3600
    analyzer.start(live(2), "ip-b")  # ip-b's refused request didn't use its hourly one


@pytest.mark.parametrize(
    ("step", "code"),
    [
        ("lookup", "unavailable"),
        ("lookup", "not_for_kids"),
        ("lookup", "too_short"),
        ("lookup", "live"),
        ("download", "unavailable"),
        ("measure", "failed"),
        ("measure", None),  # an unexpected crash
    ],
)
def test_failures(client: TestClient, pipeline: FakePipeline, step: str, code: str | None) -> None:
    pipeline.fail[live(1)] = (step, code)  # type: ignore[assignment]
    client.post(f"/api/analyses/{live(1)}")
    analyzer_of(client).run_next()
    failed = status(client, live(1))
    assert (failed["status"], failed["error"]) == ("failed", code or "failed")
    assert client.get(f"/api/videos/{live(1)}").status_code == 404

    # Asking again retries it.
    del pipeline.fail[live(1)]
    retry = client.post(f"/api/analyses/{live(1)}")
    assert (retry.status_code, retry.json()["status"], retry.json()["error"]) == (
        202,
        "queued",
        None,
    )
    analyzer_of(client).run_next()
    assert status(client, live(1))["status"] == "done"


def test_temporary_files_are_deleted(client: TestClient, pipeline: FakePipeline) -> None:
    pipeline.fail[live(2)] = ("measure", "failed")
    for n in (1, 2):
        client.post(f"/api/analyses/{live(n)}")
        analyzer_of(client).run_next()
    assert len(pipeline.workdirs) == 4  # download + measure, two videos
    assert not any(path.exists() for path in pipeline.workdirs)


def test_results_and_queue_survive_a_restart(
    dataset: Path, make_client: Callable[..., TestClient], tmp_path: Path
) -> None:
    folder = tmp_path / "analyses"
    first = make_client(dataset, analysis_dir=folder)
    for n in range(3):
        first.post(f"/api/analyses/{live(n)}")
    analyzer_of(first).run_next()
    # live(1) was mid-download when the API stopped, with its clip folder left behind.
    record = json.loads((folder / f"{live(1)}.json").read_text())
    (folder / f"{live(1)}.json").write_text(json.dumps({**record, "status": "download"}))
    (folder / "work" / live(1)).mkdir(parents=True)

    second = make_client(dataset, analysis_dir=folder)
    assert status(second, live(0))["status"] == "done"
    assert [status(second, live(n))["queuePosition"] for n in (1, 2)] == [0, 1]
    assert not (folder / "work" / live(1)).exists()
    assert client_runs_all(second) == 2
    assert client_detail_score(second, live(1)) == LIVE_PCT


def client_runs_all(client: TestClient) -> int:
    n = 0
    while analyzer_of(client).run_next():
        n += 1
    return n


def client_detail_score(client: TestClient, video_id: str) -> float:
    return cast(float, client.get(f"/api/videos/{video_id}").json()["score"])


def test_unreadable_files_are_skipped(
    dataset: Path, make_client: Callable[..., TestClient], tmp_path: Path
) -> None:
    folder = tmp_path / "analyses"
    folder.mkdir()
    (folder / f"{live(1)}.json").write_text("{not json")
    client = make_client(dataset, analysis_dir=folder)
    assert client.get(f"/api/analyses/{live(1)}").status_code == 404


def test_unknown_and_malformed_ids(client: TestClient) -> None:
    unknown = client.get(f"/api/analyses/{live(1)}")
    assert (unknown.status_code, unknown.json()) == (404, {"detail": "Analysis not found"})
    assert client.post("/api/analyses/short").status_code == 422
    assert client.get("/api/analyses/aaaaaaaaa.1").status_code == 422


def test_cors_allows_post(client: TestClient) -> None:
    response = client.post(f"/api/analyses/{live(1)}", headers={"Origin": ORIGIN})
    assert response.headers["access-control-allow-origin"] == ORIGIN


def record(status: str, since: float = 100.0) -> Record:
    return Record(id=live(1), status=status, status_since=since, requested_at=0.0)  # type: ignore[arg-type]


def test_estimate_queued_done_failed() -> None:
    assert estimate(record("queued"), 500) == estimate(record("failed"), 500)
    assert estimate(record("queued"), 500).share == 0
    assert estimate(record("queued"), 500).remaining_s is None
    assert estimate(record("done"), 500).share == 1


def test_estimate_moves_with_time_but_waits_for_the_step() -> None:
    total = sum(TYPICAL_S.values())
    lookup = TYPICAL_S["lookup"]
    start = estimate(record("lookup"), 100)
    assert start.share == 0
    assert start.remaining_s == total
    half = estimate(record("lookup"), 100 + lookup / 2)
    assert half.share == pytest.approx(lookup / 2 / total)
    assert half.remaining_s == pytest.approx(total - lookup / 2)
    # Past the step's typical time the bar holds short of the step's end.
    late = estimate(record("lookup"), 100 + lookup * 1.5)
    assert late.share == pytest.approx(lookup * STEP_CAP / total)
    assert late.remaining_s == pytest.approx(total - lookup * STEP_CAP)


def test_estimate_counts_finished_steps() -> None:
    before = TYPICAL_S["lookup"] + TYPICAL_S["download"]
    measure = estimate(record("measure"), 100)
    assert measure.share == pytest.approx(before / sum(TYPICAL_S.values()))
    assert measure.remaining_s == TYPICAL_S["measure"]
    assert estimate(record("measure"), 10_000).share < 1


def lookup_json(**info: object) -> str:
    base = {"title": "T", "channel": "C", "channel_id": "UC1", "duration": 300}
    return "some log line\n" + json.dumps({**base, "live_status": "not_live", **info}) + "\n"


def test_parse_lookup() -> None:
    info = parse_lookup(live(1), lookup_json())
    assert (info.title, info.channel_id, info.channel) == ("T", "UC1", "C")


@pytest.mark.parametrize(
    ("out", "code"),
    [
        (lookup_json(live_status="is_live"), "live"),
        (lookup_json(live_status="is_upcoming", duration=None), "live"),
        (lookup_json(duration=MIN_DURATION_S - 1), "too_short"),
        (lookup_json(duration=None), "unavailable"),
        ("", "unavailable"),
        ("not json", "unavailable"),
    ],
)
def test_parse_lookup_refusals(out: str, code: str) -> None:
    with pytest.raises(AnalysisError) as raised:
        parse_lookup(live(1), out)
    assert raised.value.code == code


def videos_api_json(*items: object) -> str:
    return json.dumps({"kind": "youtube#videoListResponse", "items": list(items)})


def test_check_made_for_kids() -> None:
    check_made_for_kids(live(1), videos_api_json({"status": {"madeForKids": True}}))


@pytest.mark.parametrize(
    ("body", "code"),
    [
        (videos_api_json({"status": {"madeForKids": False}}), "not_for_kids"),
        (videos_api_json({"status": {}}), "not_for_kids"),
        (videos_api_json(), "unavailable"),  # private or removed
        ("not json", "failed"),
        ("[]", "failed"),
    ],
)
def test_check_made_for_kids_refusals(body: str, code: str) -> None:
    with pytest.raises(AnalysisError) as raised:
        check_made_for_kids(live(1), body)
    assert raised.value.code == code


def test_parse_features(tmp_path: Path) -> None:
    path = tmp_path / "features.tsv"
    row = {name: str(i) for i, name in enumerate(FEATURES)} | {"inter_cut_dssim_mean": ""}
    path.write_text(
        "\t".join(["video_id", *FEATURES])
        + "\n"
        + "\t".join([live(1), *(row[name] for name in FEATURES)])
        + "\n"
    )
    features = parse_features(live(1), path)
    assert list(features) == list(FEATURES)
    assert features["cuts_per_min"] == 0.0
    assert features["inter_cut_dssim_mean"] is None
    assert features["loudness_jump_at_cut_per_min"] == 11.0


def test_parse_features_without_a_row_or_values(tmp_path: Path) -> None:
    path = tmp_path / "features.tsv"
    with pytest.raises(AnalysisError, match="clip too short"):
        parse_features(live(1), path, "clip too short")
    path.write_text("video_id\t" + "\t".join(FEATURES) + "\n" + live(1) + "\t" * 12 + "\n")
    with pytest.raises(AnalysisError, match="no feature values"):
        parse_features(live(1), path)


@pytest.mark.skipif(not hasattr(os, "sched_setaffinity"), reason="Linux only")
def test_limit_cores_covers_what_the_process_starts() -> None:
    # A child that starts its own child a little later, like the script starting ffmpeg.
    grandchild = "import os; print(len(os.sched_getaffinity(0)))"
    child = (
        "import subprocess, sys, time; time.sleep(0.3); "
        f"subprocess.run([sys.executable, '-c', {grandchild!r}])"
    )
    proc = subprocess.Popen([sys.executable, "-c", child], stdout=subprocess.PIPE, text=True)
    _limit_cores(proc.pid, 1)
    out, _ = proc.communicate(timeout=10)
    assert out.strip() == "1"
