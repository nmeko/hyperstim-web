#!/usr/bin/env python3
"""
scripts/check_availability.py
-------------------------------------------------------------------
Checks every video_id currently in assets/js/data.js against YouTube's
public oEmbed endpoint (no API key needed) to see which are still
live, and writes a report of what's missing.

USAGE
    python3 scripts/check_availability.py

Reads assets/js/data.js, writes scripts/availability_report.json and
prints a summary. Safe to re-run any time — read-only against YouTube,
makes no changes to your site or data.
-------------------------------------------------------------------
"""

import json
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

DATA_JS = Path(__file__).resolve().parent.parent / "assets" / "js" / "data.js"
REPORT_OUT = Path(__file__).resolve().parent / "availability_report.json"


def load_video_ids():
    text = DATA_JS.read_text(encoding="utf-8")
    match = re.search(r"const SITE_DATA = (\{.*\});", text, re.S)
    if not match:
        sys.exit(f"ERROR: couldn't find SITE_DATA in {DATA_JS}")
    data = json.loads(match.group(1))
    return [(v["video_id"], v["title"]) for v in data["videos"]]


def check_video(video_id):
    url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            if resp.status == 200:
                payload = json.load(resp)
                return "live", payload.get("title")
    except urllib.error.HTTPError as e:
        if e.code in (401, 404):
            return "unavailable", None
        return f"error ({e.code})", None
    except Exception as e:
        return f"error ({e})", None
    return "unknown", None


def main():
    videos = load_video_ids()
    print(f"Checking {len(videos)} videos against YouTube oEmbed...\n")

    results = []
    for i, (vid, title) in enumerate(videos, 1):
        status, live_title = check_video(vid)
        results.append({"video_id": vid, "manifest_title": title, "status": status, "youtube_title": live_title})
        marker = "OK  " if status == "live" else "GONE"
        print(f"[{i}/{len(videos)}] {marker} {vid}  {title[:50]}")
        time.sleep(0.2)  # be polite to the endpoint

    live = [r for r in results if r["status"] == "live"]
    dead = [r for r in results if r["status"] == "unavailable"]
    errored = [r for r in results if r not in live and r not in dead]

    print(f"\n{len(live)}/{len(videos)} still live on YouTube")
    print(f"{len(dead)}/{len(videos)} unavailable (removed/private/region-locked)")
    if errored:
        print(f"{len(errored)}/{len(videos)} had a network error — rerun the script to recheck these")

    REPORT_OUT.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nFull report written to {REPORT_OUT}")

    if dead:
        print("\nUnavailable video IDs:")
        for r in dead:
            print(f"  {r['video_id']}  ({r['manifest_title']})")


if __name__ == "__main__":
    main()
