"use client";

import { getMeta } from "@/lib/api";
import { useApi } from "@/lib/use-api";

/** v2's scan, until the collector has run all of its channel searches (plan 013). */
const FIRST_SCAN = "2026-08-26";

export function scanMonth(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "(at our latest scan, October 2026)": when we last searched YouTube for channels. */
export default function LatestScan() {
  const meta = useApi(getMeta);
  const checked = meta.status === "success" ? meta.data.channelsCheckedAt : null;
  return <>(at our latest scan, {scanMonth(checked ?? FIRST_SCAN)})</>;
}
