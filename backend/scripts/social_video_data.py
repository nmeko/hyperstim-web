"""Measures the verses of a post's social video (plan 018, Social video).

Usage: uv run python scripts/social_video_data.py <folder>

<folder> is the post's folder next to its markdown file: frontend/content/blog/<date>-<slug>/.
Reads the one clips block in <folder>/social-video.md, a "cuts" tab and then a "motion" tab,
each with the verse every video plays:

    ::::clips[Social video]{a=<video id> b=<video id>}
    ::cuts[Scene changes]{a=0:15.3-0:30.2 b=0:14.4-0:30.6}
    ::motion[Motion]{a=0:37.4-0:52.1 b=0:39.6-0:55.2}
    ::::

and measures it exactly as clip_data.py measures a post's clip comparison (the same download,
pipeline settings and output). Writes <folder>/social-video.json. Unlike clip_data.py it doesn't
list the videos for thumbnails: the film isn't on the site.
"""

import argparse
import importlib.util
import json
import sys
import tempfile
from pathlib import Path
from types import ModuleType
from typing import Any

SCRIPTS = Path(__file__).resolve().parent
SOURCE = "social-video.md"
OUTPUT = "social-video.json"


def load_clip_data() -> ModuleType:
    spec = importlib.util.spec_from_file_location("clip_data", SCRIPTS / "clip_data.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cd = load_clip_data()


def read_block(folder: Path) -> Any:
    """The film's block: one clips block, its tabs "cuts" then "motion"."""
    source = folder / SOURCE
    if not source.is_file():
        raise cd.ClipError(f"no {SOURCE} in {folder}")
    blocks = cd.parse_blocks(source.read_text(encoding="utf-8"))
    if len(blocks) != 1:
        raise cd.ClipError(f"{SOURCE} needs exactly one clips block (found {len(blocks)})")
    kinds = [tab.kind for tab in blocks[0].tabs]
    if kinds != ["cuts", "motion"]:
        raise cd.ClipError(f"{SOURCE}'s tabs must be cuts, then motion (found {', '.join(kinds)})")
    return blocks[0]


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("folder", type=Path)
    args = ap.parse_args()
    try:
        block = read_block(args.folder)
        x = cd.load_extractor()
        with tempfile.TemporaryDirectory(prefix="social-video-") as tmp:
            data = cd.measure_block(block, x, Path(tmp))
    except (cd.ClipError, OSError) as exc:
        sys.exit(f"social_video_data: {exc}")
    out = args.folder / OUTPUT
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out.resolve()}")


if __name__ == "__main__":
    main()
