import { describe, expect, it } from "vitest";
import type { Feature } from "./api";
import { FEATURE_GROUPS, FEATURE_INFO, featureDisplay, formatValue, kidMood } from "./features";

const f = (key: string, value: number | null, percentile: number | null = value === null ? null : 50): Feature => ({
  key,
  value,
  percentile,
});

describe("FEATURE_GROUPS", () => {
  it("covers each of the 12 features once", () => {
    const keys = FEATURE_GROUPS.flatMap((g) => g.keys);
    expect(keys).toHaveLength(12);
    expect(new Set(keys)).toEqual(new Set(Object.keys(FEATURE_INFO)));
  });
});

describe("formatValue", () => {
  it.each([
    ["cuts_per_min", 22.62, "22.6 cuts per minute"],
    ["palette_change_per_min", 21, "21.0 per minute"],
    ["build_resolve_per_min", 0.24, "0.2 per minute"],
    ["motion_frac", 0.2149, "21% of the time"],
    ["high_lufs_frac", 0.772, "Sound 77% of the time"],
  ])("formats %s %f as %s", (key, value, text) => {
    expect(formatValue(key, value)).toBe(text);
  });

  it.each(["inter_cut_dssim_mean", "mean_saturation", "mean_lstar", "lufs"])("has no value for %s", (key) => {
    expect(formatValue(key, 0.5)).toBeNull();
  });

  it("has no value when missing", () => {
    expect(formatValue("cuts_per_min", null)).toBeNull();
  });
});

describe("featureDisplay", () => {
  it("shows the percentile", () => {
    expect(featureDisplay(f("cuts_per_min", 12, 71.4))).toEqual({ kind: "percentile", percentile: 71.4 });
  });

  it("shows a count of 0 as 0", () => {
    expect(featureDisplay(f("lstar_flash_per_min", 0, 0))).toEqual({ kind: "percentile", percentile: 0 });
  });

  it("explains missing values", () => {
    expect(featureDisplay(f("inter_cut_dssim_mean", null))).toEqual({ kind: "none", text: "No cuts" });
    expect(featureDisplay(f("lufs", null))).toEqual({ kind: "none", text: "No sound" });
    expect(featureDisplay(f("motion_frac", null))).toEqual({ kind: "none", text: "Not measured" });
  });
});

describe("kidMood", () => {
  it("smiles when no measurement is above 90", () => {
    expect(kidMood([f("cuts_per_min", 30, 90), f("lufs", null), f("mean_lstar", 60, 12)])).toBe("smile");
  });

  it("is surprised when any measurement is above 90", () => {
    expect(kidMood([f("cuts_per_min", 30, 40), f("mean_saturation", 0.6, 90.1)])).toBe("surprised");
  });
});
