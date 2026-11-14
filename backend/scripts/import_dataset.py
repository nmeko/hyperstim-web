"""Copy the video dataset from a checkout of the research repo into data/.

Usage: uv run python scripts/import_dataset.py <research-repo-dir>

Reads (never writes) these files of the research repo:
  runs/feature-set-v11/features-contemporary-v11.tsv  the videos and their 12 features
  data/contemporary-v2-categories.tsv                 category and title per video
  data/contemporary-v2-corpus.tsv                     full video duration; ID cross-check
  data/contemporary-v2-figures-of-record.md           official counts, checked against
  code/pipeline/04_extract_features_v2.py             CACHE_VERSION

Writes data/videos.tsv and data/videos.meta.json. Exits with an error, writing
nothing, if any check fails.
"""

import argparse
import csv
import json
import re
import subprocess
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from hyperstim_api.scoring import FEATURES  # noqa: E402

FEATURES_TSV = "runs/feature-set-v11/features-contemporary-v11.tsv"
CATEGORIES_TSV = "data/contemporary-v2-categories.tsv"
CORPUS_TSV = "data/contemporary-v2-corpus.tsv"
FIGURES_MD = "data/contemporary-v2-figures-of-record.md"
EXTRACTOR = "code/pipeline/04_extract_features_v2.py"

OUT_DIR = Path(__file__).resolve().parents[1] / "data"

EXPECTED_CACHE_VERSION = 11
# Same label the research analysis uses (code/analysis/frame.py).
CATEGORY_ALIAS = {"play": "play & activity"}

OUT_COLUMNS = (
    "video_id",
    "title",
    "channel_id",
    "channel_title",
    "category",
    "published_at",
    "duration_s",
    *FEATURES,
)


class CheckFailed(Exception):
    pass


def read_tsv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh, delimiter="\t"))


def by_id(rows: list[dict[str, str]], name: str) -> dict[str, dict[str, str]]:
    result = {r["video_id"]: r for r in rows}
    if len(result) != len(rows):
        raise CheckFailed(f"{name}: duplicate video_id values")
    return result


def figures_of_record(path: Path) -> dict[str, int]:
    """Category totals from the 'By publication year and category' table."""
    lines = path.read_text(encoding="utf-8").splitlines()
    start = next((i for i, ln in enumerate(lines) if ln.startswith("| year |")), None)
    if start is None:
        raise CheckFailed(f"{path.name}: year/category table not found")
    header = lines[start]
    total = next((ln for ln in lines[start:] if ln.startswith("| **total** |")), None)
    if total is None:
        raise CheckFailed(f"{path.name}: year/category table has no total row")
    names = [c.strip() for c in header.strip("|").split("|")][1:]
    values = [int(re.sub(r"[*,\s]", "", c)) for c in total.strip("|").split("|")[1:]]
    return dict(zip(names, values, strict=True))


def cache_version(path: Path) -> int:
    match = re.search(r"^CACHE_VERSION = (\d+)", path.read_text(encoding="utf-8"), re.M)
    if not match:
        raise CheckFailed(f"{path.name}: CACHE_VERSION not found")
    return int(match.group(1))


def git_commit(repo: Path) -> str:
    # The repo is the working directory, not an argument, so it can't be read as a git option.
    out = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True, check=True
    )
    return out.stdout.strip()


def build(repo: Path) -> tuple[list[dict[str, str]], dict[str, object]]:
    features = read_tsv(repo / FEATURES_TSV)
    feature_ids = by_id(features, FEATURES_TSV)
    categories = by_id(read_tsv(repo / CATEGORIES_TSV), CATEGORIES_TSV)
    corpus = by_id(read_tsv(repo / CORPUS_TSV), CORPUS_TSV)

    collected = {
        vid for vid, r in corpus.items() if r["removed_v30"] == "0" and r["clip_present"] == "1"
    }
    if collected != feature_ids.keys():
        raise CheckFailed(
            f"{FEATURES_TSV} IDs differ from the collected corpus "
            f"({len(feature_ids)} vs {len(collected)})"
        )
    no_category = [vid for vid in feature_ids if vid not in categories]
    if no_category:
        raise CheckFailed(f"{len(no_category)} videos have no category, e.g. {no_category[0]}")

    rows = []
    for r in features:
        vid = r["video_id"]
        rows.append(
            {
                "video_id": vid,
                "title": categories[vid]["title"],
                "channel_id": r["channel_id"],
                "channel_title": r["channel_title"],
                "category": CATEGORY_ALIAS.get(
                    categories[vid]["category"], categories[vid]["category"]
                ),
                "published_at": r["published_at"],
                # The features file's duration_s is the clip's; the corpus has the video's.
                "duration_s": corpus[vid]["duration_s"],
                **{name: r[name] for name in FEATURES},
            }
        )
    rows.sort(key=lambda row: row["video_id"])

    expected = figures_of_record(repo / FIGURES_MD)
    counts = Counter(row["category"] for row in rows)
    actual = {**counts, "total": len(rows)}
    if actual != {name: expected[name] for name in actual} or len(expected) != len(actual):
        raise CheckFailed(f"counts {dict(actual)} differ from {FIGURES_MD} {expected}")
    if any(not row["title"].strip() for row in rows):
        raise CheckFailed("some videos have no title")

    version = cache_version(repo / EXTRACTOR)
    if version != EXPECTED_CACHE_VERSION:
        raise CheckFailed(
            f"{EXTRACTOR} is at CACHE_VERSION {version}, expected {EXPECTED_CACHE_VERSION}"
        )

    features_mtime = (repo / FEATURES_TSV).stat().st_mtime
    meta: dict[str, object] = {
        "source": "AISmithLab/HyperStimulation",
        "commit": git_commit(repo),
        "cacheVersion": version,
        "featuresDate": datetime.fromtimestamp(features_mtime, UTC).date().isoformat(),
        "videoCount": len(rows),
        "categories": dict(sorted(counts.items())),
    }
    return rows, meta


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("research_repo", type=Path)
    args = parser.parse_args()

    try:
        rows, meta = build(args.research_repo)
    except CheckFailed as err:
        sys.exit(f"Check failed: {err}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with (OUT_DIR / "videos.tsv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, OUT_COLUMNS, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    (OUT_DIR / "videos.meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} videos to {OUT_DIR / 'videos.tsv'} ({meta['categories']})")


if __name__ == "__main__":
    main()
