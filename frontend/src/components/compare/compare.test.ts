import { describe, expect, it } from "vitest";
import type { Feature } from "@/lib/api";
import { FEATURE_GROUPS } from "@/lib/features";
import { differences, formatPair, headlines, summarize } from "./compare";
import { parseState } from "./state";

const KEYS = FEATURE_GROUPS.flatMap((g) => g.keys);
const features = (values: Record<string, [number | null, number | null]>): Feature[] =>
  KEYS.map((key) => {
    const [value, percentile] = values[key] ?? [1.5, 50];
    return { key, value, percentile };
  });

describe("parseState", () => {
  it("reads the view and both slots", () => {
    expect(parseState(new URLSearchParams("view=channels&a=x&b=y"))).toEqual({ view: "channels", a: "x", b: "y" });
    expect(parseState(new URLSearchParams("view=nope"))).toEqual({ view: "videos", a: "", b: "" });
  });

  it("keeps only A when both slots hold the same ID", () => {
    expect(parseState(new URLSearchParams("a=x&b=x"))).toEqual({ view: "videos", a: "x", b: "" });
  });
});

describe("summarize", () => {
  it("names the more stimulating side, A's score first", () => {
    expect(summarize(41.2, 82.4)).toEqual({ kind: "more", side: "b", a: 41, b: 82 });
    expect(summarize(90, 10)).toEqual({ kind: "more", side: "a", a: 90, b: 10 });
  });

  it("calls scores at most 5 points apart (as shown) about the same", () => {
    expect(summarize(52, 47)).toEqual({ kind: "same", a: 52, b: 47 });
    expect(summarize(52.4, 46.4)).toEqual({ kind: "more", side: "a", a: 52, b: 46 });
  });
});

describe("differences", () => {
  it("orders by the biggest gap first, ties in taxonomy order", () => {
    const rows = differences(
      features({ motion_frac: [0.4, 90], lufs: [-20, 70] }),
      features({ motion_frac: [0.1, 10], lufs: [-30, 30] }),
    );
    expect(rows.slice(0, 3).map((r) => [r.key, r.gap])).toEqual([
      ["motion_frac", 80],
      ["lufs", 40],
      ["cuts_per_min", 0],
    ]);
  });

  it("compares a count of 0 as 0 and puts rows without a value last", () => {
    const rows = differences(
      features({ lstar_flash_per_min: [2, 70], inter_cut_dssim_mean: [0.3, 60] }),
      features({ lstar_flash_per_min: [0, 0], inter_cut_dssim_mean: [null, null] }),
    );
    expect(rows[0]).toMatchObject({ key: "lstar_flash_per_min", gap: 70, b: { kind: "percentile", percentile: 0 } });
    expect(rows.at(-1)).toMatchObject({ key: "inter_cut_dssim_mean", gap: null, b: { kind: "none", text: "No cuts" } });
  });
});

describe("headlines", () => {
  it("names the up to two biggest differences of 20+ points, with the higher side", () => {
    const rows = differences(
      features({ motion_frac: [0.1, 10], lufs: [-20, 70], mean_lstar: [60, 75] }),
      features({ motion_frac: [0.45, 90], lufs: [-30, 30], mean_lstar: [50, 50] }),
    );
    expect(headlines(rows).map((h) => [h.key, h.side])).toEqual([
      ["motion_frac", "b"],
      ["lufs", "a"],
    ]);
    expect(headlines(differences(features({}), features({})))).toEqual([]);
  });
});

describe("formatPair", () => {
  it("gives both sides as the table's 0–100 values, A's first", () => {
    const value = (percentile: number, raw: number) => ({ kind: "percentile" as const, percentile, value: raw });
    expect(formatPair(value(99.4, 30.3), value(0, 0))).toBe("99 vs 0");
    expect(formatPair(value(4, 20), value(86.4, 61))).toBe("4 vs 86");
  });
});
