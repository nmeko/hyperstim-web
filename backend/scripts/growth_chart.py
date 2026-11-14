"""Draws the dataset's growth for the repo's README (plan 013, A growth chart in the README).

Reads the collected dataset's CHANGELOG.tsv (backend/data/collected/README.md) and writes
growth.svg and growth-dark.svg (GitHub's light and dark themes) next to it: videos on the left
axis, channels on the right, each axis zoomed to its data. The daily commit
(scripts/commit-data.sh) runs it before committing, so the chart changes with the counts.
Standard library only.

    cd <collected-dir> && python growth_chart.py
"""

import csv
import datetime as dt
import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

CHANGELOG = Path("CHANGELOG.tsv")
WIDTH, HEIGHT = 800, 380
LEFT, RIGHT = 70, 70  # room for each axis's labels
TOP, BOTTOM = 96, 330  # the plot's top and bottom edges
STEPS = (1, 2, 2.5, 5)  # round steps, times a power of 10
INTERVALS = range(3, 7)  # gridline intervals, shared by both axes
FONT = "Nunito, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
# Videos blue and solid, channels orange and dashed; the pairs are color-blind safe on each surface.
THEMES = {
    "growth.svg": {
        "bg": "#ffffff",
        "videos": "#2f5fd0",
        "channels": "#d9603f",
        "grid": "#0f2e8a",
        "grid_opacity": "0.10",
        "axis_opacity": "0.30",
        "text": "#4a5262",
        "strong": "#0f2e8a",
    },
    "growth-dark.svg": {
        "bg": "#0d1117",
        "videos": "#5b88ee",
        "channels": "#e06a4c",
        "grid": "#c9d1d9",
        "grid_opacity": "0.12",
        "axis_opacity": "0.35",
        "text": "#9198a1",
        "strong": "#e6edf3",
    },
}


@dataclass(frozen=True)
class Day:
    date: dt.date
    videos: int
    channels: int


def read_changelog(path: Path) -> list[Day]:
    """The days, oldest first, starting with the reference set: the first day's totals before
    its changes. The changelog lists the newest day first; columns are found by name."""
    with path.open(newline="", encoding="utf-8") as fh:
        rows = sorted(csv.DictReader(fh, delimiter="\t"), key=lambda r: r["date"])
    if not rows:
        return []
    days = [
        Day(dt.date.fromisoformat(r["date"]), int(r["videos"]), int(r["channels"])) for r in rows
    ]
    first = rows[0]
    start = Day(
        days[0].date - dt.timedelta(days=1),
        int(first["videos"]) - int(first["added_v"]) + int(first["removed_v"]),
        int(first["channels"]) - int(first["new_ch"]),
    )
    return [start, *days]


def axis(low: int, high: int, intervals: int) -> tuple[int, int]:
    """(lowest label, step): the smallest round step whose intervals cover the padded data."""
    pad = max((high - low) * 0.06, high * 0.002, 2)
    bottom, top = max(low - pad, 0), high + pad
    exponent = math.floor(math.log10((top - bottom) / intervals))
    for power in range(exponent, exponent + 3):
        for multiple in STEPS:
            step = multiple * 10**power
            if step < 1 or step != int(step):
                continue
            lowest = math.floor(bottom / step) * step
            if lowest + intervals * step >= top:
                return int(lowest), int(step)
    raise AssertionError("unreachable: a step of 10x the range always fits")


def axes(days: list[Day]) -> tuple[int, tuple[int, int], tuple[int, int]]:
    """The interval count that leaves the least empty height, and each axis at that count."""
    videos = (min(d.videos for d in days), max(d.videos for d in days))
    channels = (min(d.channels for d in days), max(d.channels for d in days))

    def empty(n: int) -> float:
        return sum(
            1 - (high - low) / (n * axis(low, high, n)[1]) for low, high in (videos, channels)
        )

    n = min(INTERVALS, key=empty)
    return n, axis(*videos, n), axis(*channels, n)


def short(d: dt.date) -> str:
    return f"{d:%b} {d.day}"


def x_ticks(first: dt.date, last: dt.date) -> list[tuple[dt.date, str]]:
    """Days for the first weeks, then months, then every 3 months, then years."""
    days = (last - first).days
    if days <= 49:
        every = max(1, math.ceil(days / 7))
        return [
            (first + dt.timedelta(days=i), short(first + dt.timedelta(days=i)))
            for i in range(0, days + 1, every)
        ]
    months = 1 if days <= 240 else 3 if days <= 900 else 12
    ticks: list[tuple[dt.date, str]] = []
    month = dt.date(first.year, first.month, 1)
    while month <= last:
        if month > first and (month.month - 1) % months == 0:
            label = f"{month:%b %Y}" if month.month == 1 or not ticks else f"{month:%b}"
            ticks.append((month, str(month.year) if months == 12 else label))
        month = dt.date(month.year + month.month // 12, month.month % 12 + 1, 1)
    return ticks


def text(
    x: float,
    y: float,
    content: str,
    size: int,
    fill: str,
    anchor: str = "start",
    bold: bool = False,
) -> str:
    weight = ' font-weight="700"' if bold else ""
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}" fill="{fill}"'
        f' text-anchor="{anchor}"{weight}>{content}</text>'
    )


def chart(days: list[Day], theme: dict[str, str]) -> str:
    first, last = days[0].date, days[-1].date
    span = max((last - first).days, 1)
    n, (v_low, v_step), (c_low, c_step) = axes(days)

    def x_of(d: dt.date) -> float:
        return LEFT + (d - first).days / span * (WIDTH - LEFT - RIGHT)

    def y_of(low: int, step: int) -> Callable[[int], float]:
        return lambda v: BOTTOM - (v - low) / (n * step) * (BOTTOM - TOP)

    latest = days[-1]
    grid = f'stroke="{theme["grid"]}" stroke-opacity="{theme["grid_opacity"]}"'
    axis_line = f'stroke="{theme["grid"]}" stroke-opacity="{theme["axis_opacity"]}"'
    dash = 'stroke-dasharray="6 5"'
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" width="{WIDTH}"'
        f' height="{HEIGHT}" role="img">',
        f"<title>HyperStim dataset: {latest.videos:,} videos and {latest.channels:,} channels"
        f" on {last:%B} {last.day}, {last.year}</title>",
        f'<rect width="{WIDTH}" height="{HEIGHT}" rx="12" fill="{theme["bg"]}"/>',
        text(24, 36, "HyperStim dataset", 20, theme["strong"], bold=True),
        text(WIDTH - 24, 36, f"updated {short(last)}, {last.year}", 13, theme["text"], "end"),
    ]
    # The legend names each line's axis and latest total.
    for left, key, count, side, style in (
        (24, "videos", latest.videos, "left", ""),
        (300, "channels", latest.channels, "right", " " + dash),
    ):
        out.append(
            f'<line x1="{left}" x2="{left + 24}" y1="62" y2="62" stroke="{theme[key]}"'
            f' stroke-width="3" stroke-linecap="round"{style}/>'
        )
        total = f'<tspan font-weight="700" fill="{theme["strong"]}">{count:,}</tspan>'
        out.append(text(left + 32, 67, f"{total} {key} ({side} axis)", 14, theme["text"]))
    for i in range(n + 1):
        y = BOTTOM - i / n * (BOTTOM - TOP)
        if i:
            out.append(f'<line x1="{LEFT}" x2="{WIDTH - RIGHT}" y1="{y:.1f}" y2="{y:.1f}" {grid}/>')
        out.append(text(LEFT - 8, y + 4, f"{v_low + i * v_step:,}", 12, theme["text"], "end"))
        out.append(text(WIDTH - RIGHT + 8, y + 4, f"{c_low + i * c_step:,}", 12, theme["text"]))
    out.append(f'<line x1="{LEFT}" x2="{WIDTH - RIGHT}" y1="{BOTTOM}" y2="{BOTTOM}" {axis_line}/>')
    for d, label in x_ticks(first, last):
        x = x_of(d)
        out.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{BOTTOM}" y2="{BOTTOM + 5}" {axis_line}/>')
        out.append(text(x, BOTTOM + 20, label, 12, theme["text"], "middle"))
    # Channels first, so the videos line is drawn on top where they cross.
    for key, scale, style in (
        ("channels", y_of(c_low, c_step), " " + dash),
        ("videos", y_of(v_low, v_step), ""),
    ):
        points = [(x_of(d.date), scale(d.videos if key == "videos" else d.channels)) for d in days]
        path = "M" + " L".join(f"{px:.1f},{py:.1f}" for px, py in points)
        out.append(
            f'<path d="{path}" fill="none" stroke="{theme[key]}" stroke-width="2.5"'
            f' stroke-linejoin="round" stroke-linecap="round"{style}/>'
        )
        px, py = points[-1]
        out.append(
            f'<circle cx="{px:.1f}" cy="{py:.1f}" r="4.5" fill="{theme[key]}"'
            f' stroke="{theme["bg"]}" stroke-width="2"/>'
        )
    out.append("</svg>")
    return "\n".join(out) + "\n"


def main() -> None:
    # The folder is the working directory, not an argument, so no path comes from outside.
    days = read_changelog(CHANGELOG) if CHANGELOG.exists() else []
    for name, theme in THEMES.items() if days else ():
        Path(name).write_text(chart(days, theme), encoding="utf-8")


if __name__ == "__main__":
    main()
