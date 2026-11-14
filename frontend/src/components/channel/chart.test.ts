import { describe, expect, it } from "vitest";
import type { ChannelVideo } from "@/lib/api";
import { FEATURE_GROUPS } from "@/lib/features";
import {
  formatDate,
  labelStep,
  metaLine,
  monotoneSegments,
  placeThumbs,
  pointOf,
  stackShifts,
  smooth,
} from "./chart";

const KEYS = FEATURE_GROUPS.flatMap((g) => g.keys);

function video(publishedAt: string, overrides: Record<string, [number | null, number | null]> = {}): ChannelVideo {
  return {
    id: `v${publishedAt}`,
    title: "A video",
    publishedAt,
    score: 74,
    features: KEYS.map((key) => {
      const [value, percentile] = overrides[key] ?? [1.5, 40];
      return { key, value, percentile };
    }),
  };
}

describe("smooth", () => {
  it("averages each value with its direct neighbours, two at the ends", () => {
    expect(smooth([0, 30, 60, 30])).toEqual([15, 30, 40, 45]);
  });

  it("draws no trend for fewer than 3 videos", () => {
    expect(smooth([10, 20])).toEqual([]);
    expect(smooth([10, 20, 30])).toHaveLength(3);
  });
});

describe("monotoneSegments", () => {
  const bezier = (p: number[], t: number) =>
    (1 - t) ** 3 * p[0] + 3 * (1 - t) ** 2 * t * p[1] + 3 * (1 - t) * t ** 2 * p[2] + t ** 3 * p[3];

  it("never goes beyond the two points of a segment", () => {
    const points: [number, number][] = [[0, 50], [10, 90], [12, 20], [30, 25], [31, 80], [31, 60], [50, 0]];
    const segments = monotoneSegments(points);
    expect(segments).toHaveLength(points.length - 1);
    for (const [s, c1, c2, e] of segments) {
      const [lo, hi] = [Math.min(s[1], e[1]), Math.max(s[1], e[1])];
      for (let t = 0; t <= 1; t += 0.05) {
        const y = bezier([s[1], c1[1], c2[1], e[1]], t);
        expect(y).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(y).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });

  it("passes through every point", () => {
    const segments = monotoneSegments([[0, 1], [1, 3], [2, 2]]);
    expect(segments.map(([s]) => s)).toEqual([[0, 1], [1, 3]]);
    expect(segments[1][3]).toEqual([2, 2]);
  });
});

describe("placeThumbs", () => {
  it("puts thumbnails in the first row with room, in date order, without overlaps", () => {
    const centers = [100, 110, 120, 200, 205];
    const placed = placeThumbs(centers, 1000, 64, 6);
    expect(placed.map((p) => p.row)).toEqual([0, 1, 2, 0, 1]);
    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) {
        if (a.row === b.row) expect(Math.abs(a.left - b.left)).toBeGreaterThanOrEqual(64 + 6);
      }
    }
    expect(placed[0].left).toBe(68); // centred on its date
  });

  it("shifts thumbnails near the ends inward", () => {
    const placed = placeThumbs([5, 995], 1000, 64, 6);
    expect(placed.map((p) => p.left)).toEqual([0, 936]);
  });
});

describe("stackShifts", () => {
  // Two stacks: three overlapping thumbnails at 100, and one alone at 400.
  const placed = placeThumbs([100, 110, 120, 400], 1000, 64, 6);

  it("leaves every thumbnail in place without a focus", () => {
    expect(stackShifts(placed, null, 64, 8, 52).every((s) => s.dy === 0 && !s.front)).toBe(true);
  });

  it("brings the focused thumbnail forward and opens the stack below it", () => {
    const shifts = stackShifts(placed, 1, 64, 8, 52);
    expect(shifts).toEqual([
      { dy: 0, front: false }, // above it in the stack: stays
      { dy: 8, front: true },
      { dy: 52, front: false }, // below it in the stack: slides down
      { dy: 0, front: false }, // another stack: stays
    ]);
  });
});

describe("pointOf", () => {
  it("tells counts of 0, no cuts and missing values apart", () => {
    const v = video("2024-09-06", {
      lstar_flash_per_min: [0, 0],
      lufs: [null, null],
      inter_cut_dssim_mean: [null, null],
    });
    expect(pointOf(v, "overall")).toEqual({ kind: "value", value: 74 });
    expect(pointOf(v, "cuts_per_min")).toEqual({ kind: "value", value: 40 });
    expect(pointOf(v, "lstar_flash_per_min")).toEqual({ kind: "value", value: 0 });
    expect(pointOf(v, "lufs")).toEqual({ kind: "missing", text: "No sound" });
    expect(pointOf(v, "inter_cut_dssim_mean")).toEqual({ kind: "na", text: "No cuts" });
  });
});

describe("copy", () => {
  it("writes the meta line with the year range", () => {
    expect(metaLine([video("2018-02-03"), video("2026-01-01")])).toBe("2 videos in our dataset · 2018–2026");
    expect(metaLine([video("2024-01-01"), video("2024-12-31")])).toBe("2 videos in our dataset · 2024");
    expect(metaLine([video("2024-01-01")])).toBe("1 video in our dataset · 2024");
  });

  it("formats dates in UTC", () => {
    expect(formatDate("2024-09-06")).toBe("Sep 6, 2024");
    expect(formatDate("2018-01-01")).toBe("Jan 1, 2018");
  });

  it("thins year labels that don't fit", () => {
    expect(labelStep(80, 44)).toBe(1);
    expect(labelStep(25, 44)).toBe(2);
    expect(labelStep(10, 44)).toBe(5);
  });
});
