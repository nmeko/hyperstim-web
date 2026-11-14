"""Start the collector from v2's channels and upload lists (plan 013, Steps).

Reads the research repo (never writes it): the channels v2's discovery found and the
upload list of each channel it sampled (IDs and dates), plus v2's picks from our
dataset. So collecting can start at once; the daily check then reads each channel's
uploads since v2's scan.
"""

import csv
import time
from pathlib import Path

from hyperstim_api.collector.store import V2_JOINED, Store

CHANNELS = Path("runs/channel-yield-probe/channels-p1.tsv")
CATALOGUE = Path("runs/contemporary-v2/catalogue-cache")


def tier(subscribers: int) -> str:
    """v2's tiers by subscribers (57_enumerate_and_sample.py)."""
    if subscribers >= 10_000_000:
        return "tier1_10M+"
    if subscribers >= 1_000_000:
        return "tier2_1M-10M"
    if subscribers >= 100_000:
        return "tier3_100K-1M"
    return "tier4_10K-100K"


def seed(store: Store, research_repo: Path, dataset_path: Path) -> str:
    """Fill an empty store; returns a summary line."""
    if store.get("seeded"):
        raise RuntimeError("The collector's database is already seeded.")
    catalogue = research_repo / CATALOGUE
    sampled = {p.stem: p for p in sorted(catalogue.glob("UC*.tsv"))}
    with store.transaction():
        with (research_repo / CHANNELS).open(newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                subscribers = int(row["subscriber_count"] or 0)
                if row["channel_id"] in sampled:
                    status = "in"
                elif row["auto_generated"] == "1":
                    status = "rejected"
                else:
                    status = "near_miss"  # under 10K subscribers or 100 videos at v2's scan
                store.upsert_channel(
                    id=row["channel_id"],
                    title=row["title"],
                    subscriber_count=subscribers,
                    video_count=int(row["video_count"] or 0),
                    tier=tier(subscribers),
                    status=status,
                    source="v2",
                    queries=row["discovery_queries"],
                    joined_at=V2_JOINED if status == "in" else None,
                    checked_at=V2_JOINED,
                )
        uploads = 0
        for channel_id, path in sampled.items():
            if store.channel_status(channel_id) is None:
                raise RuntimeError(f"{path.name}: channel not in {CHANNELS}")
            with path.open(newline="", encoding="utf-8") as fh:
                rows = [
                    (r["video_id"], r["published_at"]) for r in csv.DictReader(fh, delimiter="\t")
                ]
            uploads += store.add_uploads(channel_id, rows)
            store.update_channel(channel_id, listed_at=path.stat().st_mtime)
        picks = 0
        with dataset_path.open(newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                store.add_uploads(row["channel_id"], [(row["video_id"], row["published_at"])])
                store.set_state(
                    row["video_id"],
                    "v2",
                    title=row["title"],
                    channel_title=row["channel_title"],
                    online_at=0,
                )
                picks += 1
        store.set("seeded", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    return (
        f"Seeded {len(store.channels('in'))} channels ({len(store.channels('near_miss'))} near "
        f"misses), {uploads} uploads, {picks} v2 picks"
    )
