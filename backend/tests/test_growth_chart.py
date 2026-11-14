"""scripts/growth_chart.py (plan 013, A growth chart in the README)."""

import datetime as dt
import importlib.util
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from tests.test_data_scripts import CHANGELOG, HEADER, line

BACKEND = Path(__file__).resolve().parents[1]
SCRIPT = BACKEND / "scripts" / "growth_chart.py"
SVG = "{http://www.w3.org/2000/svg}"


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("growth_chart", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gc = load_script()


@pytest.fixture(autouse=True)
def in_tmp_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The script works in the current directory, as the daily commit runs it."""
    monkeypatch.chdir(tmp_path)


def days(n: int, videos: int = 16_375, channels: int = 542) -> list[Any]:
    start = dt.date(2026, 10, 25)
    return [
        gc.Day(start + dt.timedelta(days=i), videos + 140 * i, channels + i * 3 // 2)
        for i in range(n)
    ]


def texts(svg: str) -> list[str]:
    return ["".join(t.itertext()) for t in ET.fromstring(svg).iter(f"{SVG}text")]


def test_oldest_first_from_the_reference_set_the_day_before(tmp_path: Path) -> None:
    (tmp_path / "CHANGELOG.tsv").write_text(CHANGELOG)
    rows = gc.read_changelog(tmp_path / "CHANGELOG.tsv")
    assert rows[0] == gc.Day(dt.date(2026, 10, 25), 16_375, 542)
    assert rows[-1] == gc.Day(dt.date(2026, 10, 29), 16_725, 588)
    assert [r.date.day for r in rows] == [25, 26, 27, 28, 29]


def test_writes_both_themes_with_the_latest_totals(tmp_path: Path) -> None:
    (tmp_path / "CHANGELOG.tsv").write_text(CHANGELOG)
    gc.main()
    light = (tmp_path / "growth.svg").read_text()
    dark = (tmp_path / "growth-dark.svg").read_text()
    for svg in (light, dark):
        root = ET.fromstring(svg)  # well-formed
        title = root.find(f"{SVG}title")
        assert title is not None
        assert title.text == "HyperStim dataset: 16,725 videos and 588 channels on October 29, 2026"
        labels = texts(svg)
        assert "16,725 videos (left axis)" in labels
        assert "588 channels (right axis)" in labels
        assert "updated Oct 29, 2026" in labels
        assert len(root.findall(f"{SVG}path")) == 2  # one line each
    assert 'fill="#ffffff"' in light and 'fill="#0d1117"' in dark


def test_a_single_day_still_draws(tmp_path: Path) -> None:
    (tmp_path / "CHANGELOG.tsv").write_text(HEADER + line("2026-10-26", 16430, 545, 128, 73, 3))
    gc.main()
    assert "16,430 videos (left axis)" in texts((tmp_path / "growth.svg").read_text())


@pytest.mark.parametrize("changelog", [None, HEADER])
def test_nothing_to_draw_writes_nothing(tmp_path: Path, changelog: str | None) -> None:
    if changelog is not None:
        (tmp_path / "CHANGELOG.tsv").write_text(changelog)
    gc.main()
    assert not (tmp_path / "growth.svg").exists()


@pytest.mark.parametrize("n", [2, 5, 40, 125, 400, 730, 1500])
def test_axes_are_round_shared_and_zoomed_to_the_data(n: int) -> None:
    rows = days(n)
    intervals, (v_low, v_step), (c_low, c_step) = gc.axes(rows)
    assert intervals in gc.INTERVALS
    for low, step, values in (
        (v_low, v_step, [d.videos for d in rows]),
        (c_low, c_step, [d.channels for d in rows]),
    ):
        mantissa = step / 10 ** math.floor(math.log10(step))
        assert mantissa in gc.STEPS, step
        assert low % step == 0 and low >= 0
        assert low < min(values) and max(values) < low + intervals * step
        # zoomed: the data fills at least a third of the height
        assert max(values) - min(values) >= (intervals * step) / 3 or n <= 2


def test_the_axis_reaches_zero_once_the_data_is_far_from_the_start() -> None:
    _, (v_low, _), _ = gc.axes(days(800))
    assert v_low == 0


@pytest.mark.parametrize(
    ("n", "first", "last", "count"),
    [
        (5, "Oct 25", "Oct 29", 5),
        (40, "Oct 25", "Nov 30", 7),
        (125, "Nov 2026", "Feb", 4),
        (400, "Jan 2027", "Oct", 4),
        (1500, "2027", "2030", 4),
    ],
)
def test_time_labels_follow_the_span(n: int, first: str, last: str, count: int) -> None:
    rows = days(n)
    ticks = gc.x_ticks(rows[0].date, rows[-1].date)
    labels = [label for _, label in ticks]
    assert (labels[0], labels[-1], len(labels)) == (first, last, count)
    assert all(rows[0].date <= d <= rows[-1].date for d, _ in ticks)


def test_every_label_stays_inside_the_image() -> None:
    svg = gc.chart(days(730, videos=900_000, channels=9_000), gc.THEMES["growth.svg"])
    for x in re.findall(r'<text x="([\d.]+)"', svg):
        assert 0 <= float(x) <= gc.WIDTH
