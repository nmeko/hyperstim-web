#!/usr/bin/env python3
"""
scripts/build_dataset_comprehensive.py
-------------------------------------------------------------------
EXPERIMENTAL / NOT YET ADOPTED. A separate copy of build_dataset.py,
written to read the NEW consolidated feature file your teammate's
pipeline now produces (comprehensive-features.tsv), instead of the
old three-file split (features_v2.tsv + features_v3.tsv +
audio_analysis.tsv).

This does NOT touch or replace build_dataset.py. Nothing about the
live site changes until you deliberately decide to swap scripts.

WHY THIS EXISTS
    The new pipeline consolidates pacing + escalation/recovery +
    (most) audio features into one file, built directly around the
    site's 10 pattern types rather than raw measurement categories.
    That's a genuine improvement. But it also:
      - Drops the std/max/min/percentile distributional columns the
        old schema had (mean-only now). If those were never used in
        scoring, no loss; if they were, that's a real methodology
        question for whoever owns the pipeline, not something this
        script should silently paper over.
      - Does NOT include loudness_oscillation_score, one of the 13
        features the site's taxonomy needs. This script falls back
        to audio_analysis.tsv for JUST that one column if it's
        present, and prints a clear warning if it isn't anywhere —
        it never fabricates a value.

USAGE
    python3 scripts/build_dataset_comprehensive.py --repo /path/to/HyperStimulation \
        --comprehensive-file comprehensive-features.tsv \
        --out /tmp/data_comprehensive_test.js

    Write to a throwaway --out path first (as above) to review the
    result before ever pointing --out at the live assets/js/data.js.
-------------------------------------------------------------------
"""

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------
# Taxonomy schema — identical to build_dataset.py. If shared.js's
# TAXONOMY_SCHEMA ever changes, update both scripts together.
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

INVERTED_FEATURES = {"mean_shot_dur_s", "inter_cut_ssim_mean", "motion_rest_frac", "silence_frac"}
ALL_FEATURES = sorted({f for cat in TAXONOMY_SCHEMA.values() for feats in cat.values() for f in feats})

# Columns confirmed present in the new comprehensive file (everything
# except loudness_oscillation_score, per the header comparison).
COMPREHENSIVE_FEATURES = [f for f in ALL_FEATURES if f != "loudness_oscillation_score"]

MANIFEST_FILES = ["anchor-manifest.tsv", "expansion-manifest.tsv", "historical-manifest.tsv"]
CATEGORY_FILES = ["historical-categories.tsv"]


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


def load_and_join(data_dir, comprehensive_filename):
    records = {}

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
            era = row.get("era", "").strip()
            if era:
                rec["era_raw"] = era

    comp_path = data_dir / comprehensive_filename
    if not comp_path.exists():
        sys.exit(f"ERROR: {comp_path} not found. Pass the correct filename via --comprehensive-file.")

    comp_rows = read_tsv(comp_path)
    print(f"Comprehensive file: {len(comp_rows)} rows, columns: {list(comp_rows[0].keys()) if comp_rows else []}")

    missing_cols = [f for f in COMPREHENSIVE_FEATURES if comp_rows and f not in comp_rows[0]]
    if missing_cols:
        print(f"WARNING: expected columns not found in {comprehensive_filename}: {missing_cols}")

    for row in comp_rows:
        vid = row.get("video_id")
        if not vid:
            continue
        rec = records.setdefault(vid, {"video_id": vid})
        # channel_title here comes straight from the pipeline's own manifest
        # join, not from anchor/expansion-manifest.tsv -- only use it if we
        # don't already have a title/channel from those.
        rec.setdefault("title", row.get("title", "").strip())
        if not rec.get("channel"):
            rec["channel"] = row.get("channel_title", "").strip()
        rec["duration_s"] = to_number(row.get("duration_s")) or rec.get("duration_s")
        rec["content_category"] = row.get("content_category") or rec.get("content_category")
        for feature in COMPREHENSIVE_FEATURES:
            if feature in row and row[feature] not in (None, ""):
                rec[feature] = to_number(row[feature])

    # Fallback: pull loudness_oscillation_score from the old audio_analysis.tsv
    # if it's still present in the repo, since the new file doesn't have it.
    audio_path = data_dir / "audio_analysis.tsv"
    filled_from_audio = 0
    if audio_path.exists():
        for row in read_tsv(audio_path):
            vid = row.get("video_id")
            if vid in records and "loudness_oscillation_score" in row and row["loudness_oscillation_score"] not in (None, ""):
                records[vid]["loudness_oscillation_score"] = to_number(row["loudness_oscillation_score"])
                filled_from_audio += 1
        print(f"Backfilled loudness_oscillation_score for {filled_from_audio} video(s) from audio_analysis.tsv")
    else:
        print("NOTE: audio_analysis.tsv not found -- loudness_oscillation_score will show "
              "'Not enough data' for every video until this is resolved with whoever owns the pipeline.")

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
    era_raw = (record.get("era_raw") or "").strip()
    if era_raw:
        return era_raw
    category = (record.get("content_category") or "").lower()
    if any(marker in category for marker in ("vintage", "historical", "classic", "archive")):
        return "Historical (pre-2000)"
    return "Contemporary"


def percentile_rank(value, all_values):
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
    all_pcts = [t["percentile"] for cat in taxonomy.values() for t in cat["types"].values() if t["percentile"] is not None]
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


def sanity_check(videos):
    missing, total, complete = 0, 0, 0
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
    return {"complete": complete, "partial": len(videos) - complete}


def write_data_js(videos, out_path, coverage, source_label):
    note = (f"This site reflects {len(videos)} videos from the research pipeline: "
            f"{coverage['complete']} fully scored across all 10 pattern types, "
            f"{coverage['partial']} with partial coverage.")
    meta = {
        "source": source_label,
        "dataset_size": len(videos),
        "fully_scored_count": coverage["complete"],
        "partially_scored_count": coverage["partial"],
        "note": note,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    payload = {"meta": meta, "videos": videos}
    js = "/**\n * Auto-generated by scripts/build_dataset_comprehensive.py (EXPERIMENTAL) — do not hand-edit.\n */\n\n"
    js += "const SITE_DATA = " + json.dumps(payload, indent=4) + ";\n"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(js, encoding="utf-8")
    print(f"Wrote {out_path} ({len(videos)} videos)")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", type=Path, required=True, help="Path to a local clone of the research repo")
    parser.add_argument("--comprehensive-file", default="comprehensive-features.tsv",
                         help="Filename (inside repo/data/) of the new consolidated feature file")
    parser.add_argument("--out", type=Path, required=True,
                         help="Where to write the test data.js. Point this at a THROWAWAY path first, "
                              "e.g. /tmp/data_test.js -- NOT assets/js/data.js, until you've reviewed the result.")
    args = parser.parse_args()

    data_dir = args.repo / "data"
    if not data_dir.exists():
        sys.exit(f"ERROR: {data_dir} does not exist.")

    records = load_and_join(data_dir, args.comprehensive_file)
    if not records:
        sys.exit("ERROR: no records found.")

    compute_percentiles(records)
    videos = [finalize_video(rec) for rec in records.values()]
    videos.sort(key=lambda v: v["title"].lower())

    coverage = sanity_check(videos)
    write_data_js(videos, args.out, coverage,
                  source_label="github:AISmithLab/HyperStimulation (experimental comprehensive schema)")


if __name__ == "__main__":
    main()
