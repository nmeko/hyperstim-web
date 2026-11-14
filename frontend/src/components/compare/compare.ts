// What a comparison says (plan 008): the summary and the order of the measurements.
import type { Feature } from "@/lib/api";
import { FEATURE_GROUPS, featureDisplay } from "@/lib/features";
import type { Side } from "./state";

/** Scores at most this many points apart read as "about as stimulating as each other". */
export const SAME_WITHIN = 5;

export type Summary =
  | { kind: "more"; side: Side; a: number; b: number }
  | { kind: "same"; a: number; b: number };

/** Which side is more stimulating overall, by the scores as shown (rounded); A's score always first. */
export function summarize(scoreA: number, scoreB: number): Summary {
  const a = Math.round(scoreA);
  const b = Math.round(scoreB);
  if (Math.abs(a - b) <= SAME_WITHIN) return { kind: "same", a, b };
  return { kind: "more", side: a > b ? "a" : "b", a, b };
}

/** One side of a measurement row: its percentile, or why there is none. */
export type SideValue = { kind: "percentile"; percentile: number; value: number | null } | { kind: "none"; text: string };

export type DiffRow = { key: string; a: SideValue; b: SideValue; gap: number | null };

const KEYS = FEATURE_GROUPS.flatMap((g) => g.keys);

function sideValue(feature: Feature | undefined): SideValue {
  if (!feature) return { kind: "none", text: "Not measured" };
  const display = featureDisplay(feature);
  return display.kind === "percentile"
    ? { kind: "percentile", percentile: display.percentile, value: feature.value }
    : { kind: "none", text: display.text };
}


/**
 * The 12 measurements, biggest difference first (ties in taxonomy order). Rows where a side
 * has no value to compare ("No cuts", "No sound", "Not measured") come last, in taxonomy order.
 */
export function differences(a: Feature[], b: Feature[]): DiffRow[] {
  const rows = KEYS.map((key) => {
    const sa = sideValue(a.find((f) => f.key === key));
    const sb = sideValue(b.find((f) => f.key === key));
    const va = sa.kind === "percentile" ? sa.percentile : null;
    const vb = sb.kind === "percentile" ? sb.percentile : null;
    return { key, a: sa, b: sb, gap: va === null || vb === null ? null : Math.abs(va - vb) };
  });
  const compared = rows.filter((r) => r.gap !== null).sort((x, y) => (y.gap ?? 0) - (x.gap ?? 0));
  return [...compared, ...rows.filter((r) => r.gap === null)];
}

/** A headline difference only counts from this many points apart. */
export const HEADLINE_GAP = 20;

/**
 * What the side with the higher value does more, for headlines: said of one video, and of a
 * channel's videos. Every measurement is more stimulating the higher it is.
 */
export const MORE: Record<string, { one: string; many: string }> = {
  cuts_per_min: { one: "cuts to a new shot more often", many: "cut to a new shot more often" },
  inter_cut_dssim_mean: { one: "changes more from shot to shot", many: "change more from shot to shot" },
  palette_change_per_min: { one: "swaps its colors more often", many: "swap their colors more often" },
  lstar_flash_per_min: { one: "suddenly gets brighter more often", many: "suddenly get brighter more often" },
  motion_frac: { one: "has more fast movement", many: "have more fast movement" },
  loudness_jumps_per_min: { one: "has more sudden loud moments", many: "have more sudden loud moments" },
  mean_saturation: { one: "has more vivid colors", many: "have more vivid colors" },
  mean_lstar: { one: "is brighter", many: "are brighter" },
  lufs: { one: "is louder", many: "are louder" },
  high_lufs_frac: { one: "has fewer quiet stretches", many: "have fewer quiet stretches" },
  build_resolve_per_min: { one: "has more sound that builds up, then drops", many: "have more sound that builds up, then drops" },
  loudness_jump_at_cut_per_min: { one: "has more loud sounds right on a cut", many: "have more loud sounds right on a cut" },
};

/** A headline difference: the side with the higher value, and both values (A's first). */
export type Headline = { key: string; side: Side; a: SideValue; b: SideValue };

/** The (at most) two biggest differences of at least `HEADLINE_GAP` points, from `differences`. */
export function headlines(rows: DiffRow[], max = 2): Headline[] {
  return rows
    .filter((r) => r.gap !== null && r.gap >= HEADLINE_GAP)
    .slice(0, max)
    .map((r) => {
      // Both have a percentile: rows without one have no gap.
      const percentile = (side: SideValue) => (side.kind === "percentile" ? side.percentile : 0);
      const aHigher = percentile(r.a) >= percentile(r.b);
      return { key: r.key, side: aHigher ? "a" : "b", a: r.a, b: r.b };
    });
}

/**
 * The two values of a headline, A's first like the table's columns, as the 0–100 values the
 * table shows ("99 vs 0"), so every headline reads on the same scale.
 */
export function formatPair(a: SideValue, b: SideValue): string {
  const score = (side: SideValue) => (side.kind === "percentile" ? String(Math.round(side.percentile)) : "–");
  return `${score(a)} vs ${score(b)}`;
}
