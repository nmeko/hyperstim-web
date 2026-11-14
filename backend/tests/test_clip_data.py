"""scripts/clip_data.py: parsing the clips blocks, and measuring a generated clip.

yt-dlp is faked: `download` hands out copies of a 12 s clip made with ffmpeg (the pipeline
measures nothing shorter than 10 s): solid red, then at 2.0 s a hard cut to a test pattern
that scrolls sideways.
"""

import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import numpy as np
import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "clip_data.py"


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("clip_data", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cd = load_script()

POST = """---
title: A post
---

Some text.

::::clips[One vs. two]{a=enq9Ge90o1w b="jyaUWUFH3BA"}
::cuts[Scene changes]{b='0:03-0:21.6' a=0:14.5-0:30.5}
::motion[Motion]{a=0:36-0:51.5 b=1:01.6-1:19.6}
::::

More text.

::::clips[Second]{b=bbbbbbbbbbb a=aaaaaaaaaaa}

::cuts[Cuts]{a=0:00-0:12 b=0:00-0:04}

::::
"""


def test_parses_blocks_in_order() -> None:
    first, second = cd.parse_blocks(POST)
    assert (first.a, first.b) == ("enq9Ge90o1w", "jyaUWUFH3BA")
    assert first.tabs == [
        cd.Tab("cuts", (14.5, 30.5), (3.0, 21.6)),
        cd.Tab("motion", (36.0, 51.5), (61.6, 79.6)),
    ]
    assert (second.a, second.b) == ("aaaaaaaaaaa", "bbbbbbbbbbb")
    assert second.tabs == [cd.Tab("cuts", (0.0, 12.0), (0.0, 4.0))]


@pytest.mark.parametrize(
    ("post", "message"),
    [
        ("Just text.\n", "no clips block"),
        ("::::clips[X]{a=x b=y}\n::cuts[C]{a=0:01-0:02 b=0:01-0:02}\n", "not closed"),
        ("::::clips[X]{a=x b=y}\n::::\n", "at least one tab"),
        ("::::clips[X]{a=x}\n::::\n", "attributes a and b"),
        ("::::clips[X]{a=x b=y c=z}\n::::\n", "attributes a and b"),
        ("::::clips[X] {a=x b=y}\n::::\n", "malformed"),
        ("::::clips[X]{a=x b=y}\n::flashes[F]{a=0:01-0:02 b=0:01-0:02}\n::::\n", "unknown tab"),
        ("::::clips[X]{a=x b=y}\n::cuts[C]{a=0:01-0:02 b=1:5-1:10}\n::::\n", "time range"),
        ("::::clips[X]{a=x b=y}\n::cuts[C]{a=0:01-0:02 b=12-15}\n::::\n", "time range"),
        ("::::clips[X]{a=x b=y}\n::cuts[C]{a=0:05-0:02 b=0:01-0:02}\n::::\n", "ends before"),
        ("::::clips[X]{a=x b=y}\nstray text\n::::\n", "unexpected line"),
    ],
)
def test_rejects_malformed_blocks(post: str, message: str) -> None:
    with pytest.raises(cd.ClipError, match=message):
        cd.parse_blocks(post)


def test_motion_steps_leave_out_intervals_touching_a_cut() -> None:
    grid = 15.0
    flow = np.ones(30)  # 2 s at 15 fps
    flow[14] = 50.0  # the cut's interval, 14/15 to 15/15 s
    values = cd.motion_steps(flow, grid, np.array([1.0]), 1.0)
    assert values == [1.0] * 5  # the 1 s tab ends where the cut is
    values = cd.motion_steps(flow, grid, np.array([1.0]), 2.0)
    assert values[4] == 1.0 and values[5] == 1.0  # intervals 14 and 15 left out
    # A step whose every interval holds a cut is null.
    values = cd.motion_steps(np.ones(6), grid, np.array([1 / 15, 2 / 15]), 0.4)
    assert values == [None, 1.0]


def test_cuts_within_the_tab() -> None:
    assert cd.cuts_within(np.array([1.234, 3.0, 5.0]), 5.0) == [1.23, 3.0]


@pytest.fixture(scope="module")
def clip(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("clip") / "source.mp4"
    graph = (
        "color=c=red:s=320x240:r=30:d=2[a];"
        "testsrc=s=320x240:r=30:d=10,scroll=horizontal=0.01[b];"
        "[a][b]concat=n=2:v=1:a=0[v]"
    )
    subprocess.run(
        ["ffmpeg", "-v", "error", "-filter_complex", graph, "-map", "[v]"]
        + ["-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    return path


def test_measures_a_generated_clip(
    clip: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    content, media = tmp_path / "content", tmp_path / "media"
    content.mkdir()
    (content / "2026-11-09-post.md").write_text(
        "::::clips[Caption]{a=aaaaaaaaaaa b=bbbbbbbbbbb}\n"
        "::cuts[Cuts]{a=0:00-0:04 b=0:00-0:01.5}\n"
        "::motion[Motion]{a=0:00-0:04 b=0:00-0:01}\n"
        "::::\n"
    )
    work_dirs: list[Path] = []

    def fake_download(
        video_id: str, start: float, end: float, out_dir: Path
    ) -> tuple[Path, str, str]:
        work_dirs.append(out_dir)
        out = out_dir / f"{video_id}-{start:g}.mp4"
        shutil.copy(clip, out)
        return out, f"Title of {video_id} – “quoted”", f"Channel {video_id[0]}"

    monkeypatch.setattr(cd, "download", fake_download)
    listed = tmp_path / "blog-videos.txt"
    listed.write_text("# Listed\nzzzzzzzzzzz\naaaaaaaaaaa\n")
    monkeypatch.setattr(cd, "BLOG_VIDEOS", listed)
    args = ["post", "--content-dir", str(content), "--media-dir", str(media)]
    monkeypatch.setattr(sys, "argv", ["clip_data.py", *args])
    cd.main()

    out = media / "post" / "clips.json"
    text = out.read_text(encoding="utf-8")
    assert text.endswith("}\n") and '\n  "blocks": [' in text
    data = json.loads(text)
    (block,) = data["blocks"]
    assert block["videos"] == {
        "a": {
            "id": "aaaaaaaaaaa",
            "title": "Title of aaaaaaaaaaa – “quoted”",
            "channel": "Channel a",
        },
        "b": {
            "id": "bbbbbbbbbbb",
            "title": "Title of bbbbbbbbbbb – “quoted”",
            "channel": "Channel b",
        },
    }
    cuts, motion = block["tabs"]
    assert cuts["kind"] == "cuts" and motion["kind"] == "motion"
    assert cuts["a"]["start"] == 0 and cuts["a"]["end"] == 4
    (cut,) = cuts["a"]["cuts"]
    assert cut == pytest.approx(2.0, abs=0.1)
    assert cuts["b"]["cuts"] == []  # the cut is after b's tab ends

    a = motion["a"]
    assert a["step"] == 0.2 and len(a["motion"]) == 20 and len(motion["b"]["motion"]) == 5
    still, moving = a["motion"][:9], a["motion"][11:]
    assert all(v is not None and v < 0.5 for v in still)  # solid red
    assert all(v is not None and v > 5 for v in moving)  # the scrolling pattern
    # Its videos are listed for their thumbnails, once each, sorted, the comment kept.
    assert listed.read_text() == "# Listed\naaaaaaaaaaa\nbbbbbbbbbbb\nzzzzzzzzzzz\n"
    # The temporary folder and the clips are gone.
    assert work_dirs and not any(d.exists() for d in work_dirs)


def test_reports_a_post_without_blocks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "2026-11-09-post.md").write_text("No blocks.\n")
    monkeypatch.setattr(sys, "argv", ["clip_data.py", "post", "--content-dir", str(tmp_path)])
    with pytest.raises(SystemExit, match="no clips block"):
        cd.main()


@pytest.mark.parametrize(
    ("files", "message"),
    [
        ([], "found: none"),
        (["post.md"], "found: none"),
        (["2026-11-01-post.md", "2026-11-02-post.md"], "found: 2026-11-01"),
    ],
)
def test_finds_the_post_by_its_slug(tmp_path: Path, files: list[str], message: str) -> None:
    for name in files:
        (tmp_path / name).write_text("x\n")
    with pytest.raises(cd.ClipError, match=message):
        cd.find_post(tmp_path, "post")
    (tmp_path / "2026-11-09-other-post.md").write_text("x\n")
    assert cd.find_post(tmp_path, "other-post").name == "2026-11-09-other-post.md"


def test_every_video_the_blog_embeds_is_listed_for_its_thumbnail() -> None:
    """A post's ::youtube and ::::clips videos must be in data/blog-videos.txt, or the API
    serves no thumbnail for them unless they're in the dataset (plan 018, Thumbnails)."""
    posts = cd.BACKEND / "../frontend/content/blog"
    embedded = set()
    for post in posts.glob("*.md"):
        if post.name.lower() == "readme.md":  # the writing guide, not a post
            continue
        text = post.read_text(encoding="utf-8")
        for attributes in re.findall(r"^::(?:youtube|::clips)[^{\n]*\{([^}]*)\}", text, re.M):
            embedded |= set(re.findall(r"\b(?:id|a|b)=\"?([\w-]{11})\"?", attributes))
    listed = (cd.BACKEND / "data/blog-videos.txt").read_text(encoding="utf-8")
    assert embedded <= set(listed.split()), (
        "run scripts/clip_data.py, or add ::youtube videos by hand"
    )


def test_adds_blog_videos_to_a_new_list(tmp_path: Path) -> None:
    listed = tmp_path / "blog-videos.txt"
    cd.add_blog_videos(listed, ["bbbbbbbbbbb", "aaaaaaaaaaa", "bbbbbbbbbbb"])
    assert listed.read_text() == f"{cd.BLOG_VIDEOS_HEADER}\naaaaaaaaaaa\nbbbbbbbbbbb\n"
