"""scripts/social_video_data.py: reading a post's social video verses and writing their data.

Measuring is clip_data.py's (tested in test_clip_data.py), so it's faked here.
"""

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

BACKEND = Path(__file__).resolve().parents[1]
BLOG = BACKEND.parent / "frontend" / "content" / "blog"


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "social_video_data", BACKEND / "scripts" / "social_video_data.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sv = load_script()

VERSES = """# Social video

Notes outside the block are fine.

::::clips[Social video]{a=enq9Ge90o1w b=HOWt5un1-Ts}
::cuts[Scene changes]{a=0:15.3-0:30.2 b=0:14.4-0:30.6}
::motion[Motion]{a=0:37.4-0:52.1 b=0:39.6-0:55.2}
::::
"""


def folder_with(tmp_path: Path, text: str) -> Path:
    (tmp_path / "social-video.md").write_text(text, encoding="utf-8")
    return tmp_path


def test_reads_the_verses(tmp_path: Path) -> None:
    block = sv.read_block(folder_with(tmp_path, VERSES))
    assert (block.a, block.b) == ("enq9Ge90o1w", "HOWt5un1-Ts")
    assert [(t.kind, t.a, t.b) for t in block.tabs] == [
        ("cuts", (15.3, 30.2), (14.4, 30.6)),
        ("motion", (37.4, 52.1), (39.6, 55.2)),
    ]


@pytest.mark.parametrize(
    ("text", "message"),
    [
        (None, "no social-video.md"),
        ("No block here.\n", "the post has no clips block"),
        (VERSES + "\n" + VERSES.split("\n", 4)[4], "exactly one clips block"),
        (
            VERSES.replace("::cuts[Scene changes]{a=0:15.3-0:30.2 b=0:14.4-0:30.6}\n", ""),
            "cuts, then motion",
        ),
        (
            VERSES.replace("::cuts", "::tmp")
            .replace("::motion", "::cuts")
            .replace("::tmp", "::motion"),
            "cuts, then motion",
        ),
    ],
)
def test_rejects_other_verses(tmp_path: Path, text: str | None, message: str) -> None:
    if text is not None:
        folder_with(tmp_path, text)
    with pytest.raises(sv.cd.ClipError, match=message):
        sv.read_block(tmp_path)


def test_writes_the_measured_verses(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    folder = folder_with(tmp_path, VERSES)
    measured: dict[str, Any] = {"videos": {"a": {"id": "enq9Ge90o1w"}}, "tabs": [{"kind": "cuts"}]}
    seen: list[Any] = []
    monkeypatch.setattr(sv.cd, "load_extractor", lambda: "extractor")

    def measure_block(block: Any, x: Any, work: Path) -> dict[str, Any]:
        seen.append((block, x))
        return measured

    monkeypatch.setattr(sv.cd, "measure_block", measure_block)
    monkeypatch.setattr(sys, "argv", ["social_video_data.py", str(folder)])
    sv.main()
    assert json.loads((folder / "social-video.json").read_text(encoding="utf-8")) == measured
    assert seen[0][0].a == "enq9Ge90o1w" and seen[0][1] == "extractor"


def test_reports_a_folder_without_verses(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", ["social_video_data.py", str(tmp_path)])
    with pytest.raises(SystemExit, match="no social-video.md"):
        sv.main()


@pytest.mark.parametrize("folder", sorted(p.parent for p in BLOG.glob("*/social-video.md")))
def test_each_social_video_is_measured_from_its_verses(folder: Path) -> None:
    """A changed verse needs the data measured again (`social_video_data.py`)."""
    block = sv.read_block(folder)
    data = json.loads((folder / "social-video.json").read_text(encoding="utf-8"))
    assert (data["videos"]["a"]["id"], data["videos"]["b"]["id"]) == (block.a, block.b)
    for tab, measured in zip(block.tabs, data["tabs"], strict=True):
        assert measured["kind"] == tab.kind
        for side in ("a", "b"):
            assert (measured[side]["start"], measured[side]["end"]) == getattr(tab, side)
