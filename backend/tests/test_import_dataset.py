"""scripts/import_dataset.py, run against a small made-up checkout of the research repo."""

import csv
import importlib.util
import json
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import pytest

from hyperstim_api.scoring import FEATURES

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "import_dataset.py"


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("import_dataset", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


imp = load_script()

# Three collected videos (one in the "play" category, renamed on import); a fourth was removed.
VIDEOS = [
    ("vid0000002", "UCb", "Bee", "play", "Ball Game"),
    ("vid0000001", "UCa", "Ant", "music", "Song One"),
    ("vid0000003", "UCa", "Ant", "music", "Song Two"),
]
REMOVED = "vid0000004"


def write_tsv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, list(rows[0]), delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


FIGURES = """# Figures of record

## By publication year and category

| year | music | play & activity | total |
|---|---|---|---|
| 2024 | 2 | 1 | 3 |
| **total** | **2** | **1** | **3** |
"""


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "research"
    write_tsv(
        root / imp.FEATURES_TSV,
        [
            {
                "video_id": vid,
                "channel_id": ch,
                "channel_title": name,
                "published_at": "2024-01-02",
                "duration_s": 60,
                **{f: n + i / 10 for i, f in enumerate(FEATURES)},
            }
            for n, (vid, ch, name, _, _) in enumerate(VIDEOS)
        ],
    )
    write_tsv(
        root / imp.CATEGORIES_TSV,
        [{"video_id": vid, "category": cat, "title": title} for vid, _, _, cat, title in VIDEOS],
    )
    corpus = [
        {"video_id": vid, "removed_v30": 0, "clip_present": 1, "duration_s": 600 + n}
        for n, (vid, *_) in enumerate(VIDEOS)
    ]
    corpus.append({"video_id": REMOVED, "removed_v30": 1, "clip_present": 1, "duration_s": 1})
    write_tsv(root / imp.CORPUS_TSV, corpus)
    (root / imp.FIGURES_MD).write_text(FIGURES, encoding="utf-8")
    extractor = root / imp.EXTRACTOR
    extractor.parent.mkdir(parents=True)
    extractor.write_text("import os\n\nCACHE_VERSION = 11\n", encoding="utf-8")
    git = ["git", "-c", "user.name=t", "-c", "user.email=t@example.org"]
    subprocess.run([*git, "init", "-q"], cwd=root, check=True)
    subprocess.run([*git, "add", "."], cwd=root, check=True)
    subprocess.run([*git, "commit", "-qm", "data"], cwd=root, check=True)
    return root


@pytest.fixture
def out_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    out = tmp_path / "out"
    monkeypatch.setattr(imp, "OUT_DIR", out)
    return out


def run_main(monkeypatch: pytest.MonkeyPatch, repo: Path) -> None:
    monkeypatch.setattr(sys, "argv", ["import_dataset.py", str(repo)])
    imp.main()


def test_import_writes_the_dataset_and_its_meta(
    repo: Path, out_dir: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    run_main(monkeypatch, repo)

    with (out_dir / "videos.tsv").open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh, delimiter="\t"))
    assert list(rows[0]) == list(imp.OUT_COLUMNS)
    assert [r["video_id"] for r in rows] == ["vid0000001", "vid0000002", "vid0000003"]
    play = rows[1]
    assert play["category"] == "play & activity"
    assert play["title"] == "Ball Game"
    assert play["channel_title"] == "Bee"
    assert play["duration_s"] == "600"  # the video's, from the corpus, not the clip's 60
    assert play[FEATURES[1]] == "0.1"

    meta = json.loads((out_dir / "videos.meta.json").read_text(encoding="utf-8"))
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True, check=True
    ).stdout.strip()
    assert meta["commit"] == commit
    assert meta["cacheVersion"] == 11
    assert meta["videoCount"] == 3
    assert meta["categories"] == {"music": 2, "play & activity": 1}
    assert len(meta["featuresDate"]) == 10
    assert "Wrote 3 videos" in capsys.readouterr().out


def edit(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    assert old in text
    path.write_text(text.replace(old, new), encoding="utf-8")


def drop_line(path: Path, start: str) -> None:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    path.write_text("".join(ln for ln in lines if not ln.startswith(start)), encoding="utf-8")


Change = Callable[[Path], None]

CHECKS: list[tuple[str, Change, str]] = [
    (
        "duplicate ID",
        lambda r: edit(r / imp.CATEGORIES_TSV, "vid0000003\t", "vid0000001\t"),
        "duplicate video_id",
    ),
    (
        "features missing a collected video",
        lambda r: drop_line(r / imp.FEATURES_TSV, "vid0000003"),
        "IDs differ from the collected corpus",
    ),
    (
        "features with a removed video",
        lambda r: edit(r / imp.CORPUS_TSV, "vid0000003\t0", "vid0000003\t1"),
        "IDs differ from the collected corpus",
    ),
    (
        "video without a category",
        lambda r: drop_line(r / imp.CATEGORIES_TSV, "vid0000002"),
        "1 videos have no category, e.g. vid0000002",
    ),
    (
        "counts differ",
        lambda r: edit(r / imp.FIGURES_MD, "| **total** | **2** |", "| **total** | **9** |"),
        "differ from",
    ),
    (
        "no year/category table",
        lambda r: edit(r / imp.FIGURES_MD, "| year |", "| month |"),
        "year/category table not found",
    ),
    (
        "no total row",
        lambda r: edit(r / imp.FIGURES_MD, "| **total** |", "| sum |"),
        "has no total row",
    ),
    (
        "empty title",
        lambda r: edit(r / imp.CATEGORIES_TSV, "Song Two", " "),
        "some videos have no title",
    ),
    (
        "wrong cache version",
        lambda r: edit(r / imp.EXTRACTOR, "CACHE_VERSION = 11", "CACHE_VERSION = 12"),
        "CACHE_VERSION 12, expected 11",
    ),
    (
        "no cache version",
        lambda r: edit(r / imp.EXTRACTOR, "CACHE_VERSION = 11", "VERSION = 11"),
        "CACHE_VERSION not found",
    ),
]


@pytest.mark.parametrize(("change", "message"), [c[1:] for c in CHECKS], ids=[c[0] for c in CHECKS])
def test_a_failed_check_exits_and_writes_nothing(
    repo: Path, out_dir: Path, monkeypatch: pytest.MonkeyPatch, change: Change, message: str
) -> None:
    change(repo)
    with pytest.raises(SystemExit) as exc:
        run_main(monkeypatch, repo)
    assert str(exc.value).startswith("Check failed: ")
    assert message in str(exc.value)
    assert not out_dir.exists()
