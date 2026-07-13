#!/usr/bin/env python3
"""
scripts/build_dataset.py
-------------------------------------------------------------------
Builds website/assets/js/data.js from the research repo's raw TSVs.

USAGE
    # 1. Clone the private research repo somewhere (see DATA_INTEGRATION.md)
    # 2. Run this script pointing at that clone:
    python3 scripts/build_dataset.py --repo /path/to/HyperStimulation

OPTIONAL ENRICHMENT (both are entirely optional — the script runs fine
without either; see DATA_INTEGRATION.md for full setup of each):

    --youtube-api-key YOUR_KEY
        Uses the YouTube Data API v3 to confirm each video_id still
        resolves and to backfill/verify title + channel name from
        YouTube itself rather than trusting the manifest text.
        (Read-only, no OAuth needed — an API key is enough for the
        videos.list endpoint.)

    --gdrive-folder-id YOUR_FOLDER_ID  (requires GOOGLE_APPLICATION_CREDENTIALS
                                         env var pointing at a service-account
                                         JSON key with Drive read access)
        Downloads any additional .tsv/.csv files from a shared Google
        Drive research folder and merges them in alongside the GitHub
        repo's data/ directory before joining.

No network calls happen unless you pass those flags — by default this
script only reads local files.
-------------------------------------------------------------------
"""

import argparse
import csv
import json
import os
import statistics
import sys
from pathlib import Path

# ---------------------------------------------------------------------
# 1. Taxonomy schema — MUST mirror assets/js/shared.js TAXONOMY_SCHEMA.
#    If you add a feature or pattern type in shared.js, add it here too.
# ---------------------------------------------------------------------

TAXONOMY_SCHEMA = {
    "pacing_intensification": {
        "rapid_cutting": ["cuts_per_min", "mean_shot_dur_s"],
        "scene_discontinuity": ["inter_cut_ssim_mean"],
        "chromatic_instability": ["mean_hist_diff"],
        "visual_intensity": ["mean_saturation", "mean_colorfulness"],
        "continuous_visual_motion": ["motion_mean", "motion_rest_frac"],
    },
    "recovery_denial": {
        "sustained_audio_intensity": ["mean_rms_db"],
        "loudness_oscillation": ["loudness_oscillation_score", "loudness_jumps_per_min"],
        "silence_elimination": ["silence_frac"],
    },
    "reward_patterning": {
        "musical_build_resolve": ["build_resolve_per_min"],
        "surprise_reveals": ["reveal_coincidence_rate"],
    },
}

# Features where a HIGHER raw value means LESS intense / calmer.
# Percentile ranking is flipped for these so "higher percentile" always
# means "more intense," consistent with every other feature.
INVERTED_FEATURES = {"mean_shot_dur_s", "inter_cut_ssim_mean", "motion_rest_frac", "silence_frac"}

ALL_FEATURES = sorted({f for cat in TAXONOMY_SCHEMA.values() for feats in cat.values() for f in feats})

MANIFEST_FILES = ["anchor-manifest.tsv", "expansion-manifest.tsv", "historical-manifest.tsv"]
CATEGORY_FILES = ["historical-categories.tsv"]
# Join order matters: later files can fill in gaps left by earlier ones,
# but never overwrite a value already set. features_v2 covers the visual
# pacing features; features_v3 adds the escalation/recovery/reward features;
# audio_analysis.tsv is the more precise/dedicated source for the two
# loudness features (features_v2's mean_rms_db is a coarser fallback).
FEATURE_FILES = ["features_v2.tsv", "features_v3.tsv", "audio_analysis.tsv"]

# NOTE: features.tsv (v1), combined_features.tsv, and scene_analysis.tsv
# exist in the repo but are superseded by features_v2/v3 — intentionally
# not read here. c1-expansion-candidates.tsv / c2-candidates.tsv are
# not-yet-processed candidate lists (no feature columns), also skipped.
# subtitle_features.tsv is the exploratory transcript-based signal set
# mentioned in resources.html — deliberately excluded from the core score.


# ---------------------------------------------------------------------
# 2. Local TSV reading / joining
# ---------------------------------------------------------------------

def read_tsv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def to_number(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def discover_repo_files(repo_dir):
    """Section 1.1 of the build guide: don't assume the schema, inspect it."""
    data_dir = repo_dir / "data"
    if not data_dir.exists():
        sys.exit(f"ERROR: {data_dir} does not exist. Did you clone the right branch?")

    found = sorted(p.name for p in data_dir.glob("*.tsv"))
    print(f"Found {len(found)} TSV files in {data_dir}:")
    for name in found:
        cols = read_tsv(data_dir / name)
        col_names = list(cols[0].keys()) if cols else []
        print(f"  - {name}: {len(cols)} rows, columns: {col_names}")
    return data_dir


def load_and_join(data_dir):
    records = {}  # video_id -> merged dict

    # Manifests first (title/channel/era source of truth). Don't let a
    # later manifest blank out a title/channel an earlier one already set.
    for fname in MANIFEST_FILES:
        path = data_dir / fname
        if not path.exists():
            continue
        for row in read_tsv(path):
            vid = row.get("video_id")
            if not vid:
                continue
            rec = records.setdefault(vid, {"video_id": vid})
            title = row.get("title", "").strip()
            channel = row.get("channel", "").strip()
            if title:
                rec["title"] = title
            if channel:
                rec["channel"] = channel
            # historical-manifest.tsv is the only file with an explicit era;
            # anchor/expansion manifests don't have this column at all.
            era = row.get("era", "").strip()
            if era:
                rec["era_raw"] = era
            year = row.get("production_year", "").strip()
            if year:
                rec["production_year"] = year

    # Feature files — join on video_id, later files add columns without
    # clobbering ones already set by an earlier file.
    for fname in FEATURE_FILES:
        path = data_dir / fname
        if not path.exists():
            print(f"WARNING: {fname} not found, skipping (coverage will be incomplete)")
            continue
        for row in read_tsv(path):
            vid = row.get("video_id")
            if not vid:
                continue
            rec = records.setdefault(vid, {"video_id": vid})
            rec.setdefault("title", row.get("title", "").strip())
            rec.setdefault("channel", row.get("channel", "").strip())
            rec["duration_s"] = to_number(row.get("duration_s")) or rec.get("duration_s")
            rec["set"] = row.get("set", rec.get("set"))
            rec["set_name"] = row.get("set_name", rec.get("set_name"))
            for feature in ALL_FEATURES:
                if feature in row and row[feature] not in (None, ""):
                    rec[feature] = to_number(row[feature])

    # Category / era labels
    for fname in CATEGORY_FILES:
        path = data_dir / fname
        if not path.exists():
            continue
        for row in read_tsv(path):
            vid = row.get("video_id")
            if vid in records:
                records[vid]["content_category"] = row.get("content_category", "")

    return records


def era_for(record):
    # historical-manifest.tsv gives an explicit era for videos it covers —
    # trust that over any inference. Only guess for videos it doesn't list
    # (i.e. anchor/expansion-only videos, which are all contemporary by
    # construction of the research design).
    era_raw = (record.get("era_raw") or "").strip()
    if era_raw:
        return era_raw

    category = (record.get("content_category") or "").lower()
    historical_markers = ("vintage", "historical", "classic", "archive")
    if any(marker in category for marker in historical_markers):
        return "Historical (pre-2000)"
    return "Contemporary"


# ---------------------------------------------------------------------
# 3. Percentile computation
# ---------------------------------------------------------------------

def percentile_rank(value, all_values):
    """% of the sample this value is greater than or equal to, 0-100."""
    if value is None or not all_values:
        return None
    n = len(all_values)
    if n <= 1:
        return 50.0
    below_or_equal = sum(1 for v in all_values if v <= value)
    return round(100 * (below_or_equal - 1) / (n - 1), 1)


def compute_percentiles(records):
    feature_pools = {f: [r[f] for r in records.values() if r.get(f) is not None] for f in ALL_FEATURES}

    for rec in records.values():
        rec["_percentiles"] = {}
        for feature in ALL_FEATURES:
            raw = rec.get(feature)
            pct = percentile_rank(raw, feature_pools[feature])
            if pct is not None and feature in INVERTED_FEATURES:
                pct = round(100 - pct, 1)
            rec["_percentiles"][feature] = pct


# ---------------------------------------------------------------------
# 4. Nest into the taxonomy shape expected by assets/js/shared.js
# ---------------------------------------------------------------------

def build_taxonomy_block(rec):
    taxonomy = {}
    for cat_key, types in TAXONOMY_SCHEMA.items():
        cat_block = {"types": {}}
        for type_key, features in types.items():
            feat_block = {}
            type_percentiles = []
            for feature in features:
                pct = rec["_percentiles"].get(feature)
                raw = rec.get(feature)
                feat_block[feature] = {"value": raw, "percentile": pct}
                if pct is not None:
                    type_percentiles.append(pct)
            type_pct = round(sum(type_percentiles) / len(type_percentiles), 1) if type_percentiles else None
            cat_block["types"][type_key] = {"percentile": type_pct, "features": feat_block}
        taxonomy[cat_key] = cat_block
    return taxonomy


def composite_percentile(taxonomy):
    all_pcts = []
    for cat in taxonomy.values():
        for t in cat["types"].values():
            if t["percentile"] is not None:
                all_pcts.append(t["percentile"])
    return round(sum(all_pcts) / len(all_pcts), 1) if all_pcts else None


TOPIC_KEYWORDS = {
    "Gameplay": ["gameplay", "let's play", "lets play", "minecraft", "roblox", "fortnite", "gaming"],
    "Educational": ["learn", "abc", "counting", "numbers", "phonics", "school", "education", "science"],
    "Music & Songs": ["song", "sing", "music", "rhyme", "lullaby", "nursery"],
    "Storytelling": ["story", "storytime", "tale", "fairy tale", "bedtime"],
    "Toys & Play": ["toy", "unboxing", "playset", "surprise egg", "blind bag"],
}


def derive_topic(title, channel):
    haystack = f"{title} {channel}".lower()
    for topic, keywords in TOPIC_KEYWORDS.items():
        if any(kw in haystack for kw in keywords):
            return topic
    return "Other"


def finalize_video(rec):
    taxonomy = build_taxonomy_block(rec)
    return {
        "video_id": rec["video_id"],
        "title": rec.get("title") or rec["video_id"],
        "channel": rec.get("channel") or "Unknown channel",
        "category": rec.get("content_category") or "uncategorized",
        "content_topic": derive_topic(rec.get("title", ""), rec.get("channel", "")),
        "era": era_for(rec),
        "duration_s": rec.get("duration_s"),
        "composite_percentile": composite_percentile(taxonomy),
        "taxonomy": taxonomy,
    }


# ---------------------------------------------------------------------
# 5. Optional: YouTube Data API v3 enrichment (read-only, API key only)
# ---------------------------------------------------------------------

def enrich_with_youtube_api(videos, api_key):
    import urllib.request
    import urllib.parse

    print(f"Verifying {len(videos)} videos against the YouTube Data API...")
    ids = [v["video_id"] for v in videos]

    # videos.list accepts up to 50 IDs per call
    resolved = {}
    for i in range(0, len(ids), 50):
        batch = ids[i:i + 50]
        params = urllib.parse.urlencode({
            "part": "snippet",
            "id": ",".join(batch),
            "key": api_key,
        })
        url = f"https://www.googleapis.com/youtube/v3/videos?{params}"
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                payload = json.load(resp)
            for item in payload.get("items", []):
                resolved[item["id"]] = item["snippet"]
        except Exception as exc:
            print(f"WARNING: YouTube API batch failed ({exc}); leaving manifest titles as-is")

    matched, missing = 0, []
    for v in videos:
        snippet = resolved.get(v["video_id"])
        if snippet:
            v["title"] = snippet.get("title", v["title"])
            v["channel"] = snippet.get("channelTitle", v["channel"])
            matched += 1
        else:
            missing.append(v["video_id"])

    print(f"  matched: {matched}/{len(videos)}")
    if missing:
        print(f"  not resolvable (private/deleted/region-locked?): {missing}")
    return videos


# ---------------------------------------------------------------------
# 6. Optional: pull supplementary files from a shared Google Drive folder
# ---------------------------------------------------------------------

def fetch_gdrive_folder(folder_id, dest_dir):
    """
    Requires: pip install --break-system-packages google-api-python-client google-auth
    and GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key
    that has at least read access to the shared folder.
    """
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaIoBaseDownload
    except ImportError:
        sys.exit(
            "Google Drive integration requires the Google API client libraries.\n"
            "Install with:\n"
            "  pip install --break-system-packages google-api-python-client google-auth"
        )

    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not creds_path:
        sys.exit("Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON key path first.")

    creds = service_account.Credentials.from_service_account_file(
        creds_path, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    service = build("drive", "v3", credentials=creds)

    dest_dir.mkdir(parents=True, exist_ok=True)
    query = f"'{folder_id}' in parents and (mimeType='text/tab-separated-values' or mimeType='text/csv')"
    results = service.files().list(q=query, fields="files(id, name)").execute()
    files = results.get("files", [])

    print(f"Found {len(files)} data files in Google Drive folder {folder_id}")
    for file in files:
        request = service.files().get_media(fileId=file["id"])
        target = dest_dir / file["name"]
        with open(target, "wb") as fh:
            import io
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
        print(f"  downloaded {file['name']} -> {target}")

    return dest_dir


# ---------------------------------------------------------------------
# 7. Write assets/js/data.js
# ---------------------------------------------------------------------

def write_data_js(videos, out_path, coverage, source_label="github:AISmithLab/HyperStimulation", full_corpus_size=None):
    note = f"This site reflects {len(videos)} videos from the research pipeline: {coverage['complete']} fully scored across all 10 pattern types, {coverage['partial']} with partial coverage (missing types show 'Not enough data')."
    if full_corpus_size:
        note += f" The pipeline's eventual target scope is {full_corpus_size} videos."

    meta = {
        "source": source_label,
        "dataset_size": len(videos),
        "fully_scored_count": coverage["complete"],
        "partially_scored_count": coverage["partial"],
        "note": note,
    }
    if full_corpus_size:
        meta["full_corpus_size"] = full_corpus_size

    payload = {"meta": meta, "videos": videos}

    js = "/**\n * Auto-generated by scripts/build_dataset.py — do not hand-edit.\n */\n\n"
    js += "const SITE_DATA = " + json.dumps(payload, indent=4) + ";\n"

    out_path.write_text(js, encoding="utf-8")
    print(f"Wrote {out_path} ({len(videos)} videos)")


# ---------------------------------------------------------------------
# 8. Sanity check (mirrors the verification snippet in the build guide)
# ---------------------------------------------------------------------

def sanity_check(videos):
    missing = 0
    total = 0
    complete = 0
    for v in videos:
        video_missing = 0
        for cat in v["taxonomy"].values():
            for t in cat["types"].values():
                total += 1
                if t["percentile"] is None:
                    missing += 1
                    video_missing += 1
        if video_missing == 0:
            complete += 1

    print(f"Sanity check: {missing}/{total} pattern-type percentiles missing across {len(videos)} videos")
    print(f"  -> {complete}/{len(videos)} videos are FULLY scored across all 10 types; {len(videos) - complete} have partial coverage.")
    if missing:
        print("  -> videos with partial coverage will show 'Not enough data' for the missing types only — the rest of that video's score is still real.")

    return {"complete": complete, "partial": len(videos) - complete}


# ---------------------------------------------------------------------
# main
# ---------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", type=Path, required=True, help="Path to a local clone of the research repo")
    parser.add_argument("--youtube-api-key", default=os.environ.get("YOUTUBE_API_KEY"),
                         help="Optional: verify/backfill titles via YouTube Data API v3")
    parser.add_argument("--gdrive-folder-id", default=None,
                         help="Optional: pull supplementary TSVs from a shared Google Drive folder first")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "assets" / "js" / "data.js")
    parser.add_argument("--full-corpus-size", type=int, default=None,
                         help="Optional: the research pipeline's eventual target video count, if known. "
                              "Omit this if you don't have a real target number — the script will not guess one.")
    args = parser.parse_args()

    data_dir = discover_repo_files(args.repo)

    if args.gdrive_folder_id:
        extra_dir = args.repo / "data" / "_gdrive_extra"
        fetch_gdrive_folder(args.gdrive_folder_id, extra_dir)
        # Merge any downloaded files into the same join pass by copying
        # them alongside the repo's own data/ directory.
        for extra_file in extra_dir.glob("*"):
            (data_dir / extra_file.name).write_bytes(extra_file.read_bytes())

    records = load_and_join(data_dir)
    if not records:
        sys.exit("ERROR: no records found — check the --repo path and branch.")

    compute_percentiles(records)
    videos = [finalize_video(rec) for rec in records.values()]
    videos.sort(key=lambda v: v["title"].lower())

    if args.youtube_api_key:
        videos = enrich_with_youtube_api(videos, args.youtube_api_key)

    coverage = sanity_check(videos)
    write_data_js(videos, args.out, coverage, full_corpus_size=args.full_corpus_size)


if __name__ == "__main__":
    main()
