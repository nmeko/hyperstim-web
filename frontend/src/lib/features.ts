// Copy and display rules for the 12 measurements (plan 004). Keys match the backend's feature names.
import type { Feature } from "./api";

type Unit = "cutsPerMin" | "perMin" | "shareOfTime" | "soundShare" | null;

export type FeatureInfo = {
  name: string;
  description: string;
  /** Short label beside its marker on the How it works timeline (plan 006). */
  label: string;
  /** How the raw value reads to parents; null when its unit means nothing to them. */
  unit: Unit;
};

export const FEATURE_INFO: Record<string, FeatureInfo> = {
  cuts_per_min: {
    name: "Rapid cutting",
    description: "How often the picture switches to a new shot.",
    label: "each cut, counted",
    unit: "cutsPerMin",
  },
  inter_cut_dssim_mean: {
    name: "Scene discontinuity",
    description: "How different each new shot looks from the one before.",
    label: "how different the next shot looks",
    unit: null,
  },
  palette_change_per_min: {
    name: "Palette instability",
    description: "How often the colors on screen are replaced.",
    label: "the colors swap out",
    unit: "perMin",
  },
  lstar_flash_per_min: {
    name: "Luminance flash",
    description: "How often the picture suddenly gets brighter.",
    label: "a sudden brightening",
    unit: "perMin",
  },
  motion_frac: {
    name: "Motion density",
    description: "How much of the time things on screen move fast.",
    label: "fast movement on screen",
    unit: "shareOfTime",
  },
  loudness_jumps_per_min: {
    name: "Loudness jumps",
    description: "How often the sound jumps well above its usual level.",
    label: "a sudden loud moment",
    unit: "perMin",
  },
  mean_saturation: {
    name: "Visual intensity",
    description: "How saturated the colors are.",
    label: "vivid colors",
    unit: null,
  },
  mean_lstar: {
    name: "Visual brightness",
    description: "How bright the picture is.",
    label: "brightness",
    unit: null,
  },
  lufs: {
    name: "Audio intensity",
    description: "How loud the sound is overall.",
    label: "average loudness",
    unit: null,
  },
  high_lufs_frac: {
    name: "Silence elimination",
    description: "How much of the time sound is playing.",
    label: "a quiet stretch",
    unit: "soundShare",
  },
  build_resolve_per_min: {
    name: "Audio build-resolve",
    description: "Sound that rises steadily, then drops back.",
    label: "sound builds up, then drops back",
    unit: "perMin",
  },
  loudness_jump_at_cut_per_min: {
    name: "Surprise reveals",
    description: "Loud sounds that land right on a cut.",
    label: "a loud jump right on a cut",
    unit: "perMin",
  },
};

/** The research taxonomy's three groups, with their features in order. */
export const FEATURE_GROUPS: { title: string; keys: string[] }[] = [
  {
    title: "Pacing intensification",
    keys: [
      "cuts_per_min",
      "inter_cut_dssim_mean",
      "palette_change_per_min",
      "lstar_flash_per_min",
      "motion_frac",
      "loudness_jumps_per_min",
    ],
  },
  {
    title: "Sustained sensory intensity",
    keys: ["mean_saturation", "mean_lstar", "lufs", "high_lufs_frac"],
  },
  {
    title: "Reward patterning",
    keys: ["build_resolve_per_min", "loudness_jump_at_cut_per_min"],
  },
];

/** Anchor of a measurement on the How it works page ("rapid-cutting"). */
export function featureSlug(key: string): string {
  return FEATURE_INFO[key].name.toLowerCase().replace(/\W+/g, "-");
}

/** The raw value as a phrase ("22.6 cuts per minute"), or null when it has no plain unit. */
export function formatValue(key: string, value: number | null): string | null {
  if (value === null) return null;
  const perMin = value.toFixed(1);
  const percent = Math.round(value * 100);
  switch (FEATURE_INFO[key]?.unit) {
    case "cutsPerMin":
      return `${perMin} cuts per minute`;
    case "perMin":
      return `${perMin} per minute`;
    case "shareOfTime":
      return `${percent}% of the time`;
    case "soundShare":
      return `Sound ${percent}% of the time`;
    default:
      return null;
  }
}

export type FeatureDisplay =
  | { kind: "percentile"; percentile: number }
  | { kind: "none"; text: string };

/** Why a measurement has no value: no cuts to compare, no sound to measure, or not measured. */
const NO_VALUE: Record<string, string> = { inter_cut_dssim_mean: "No cuts", lufs: "No sound" };

/**
 * What a measurement row shows: the percentile, or why there is none. A count of 0 comes from
 * the backend as percentile 0, so it shows as 0.
 */
export function featureDisplay(feature: Feature): FeatureDisplay {
  if (feature.value === null || feature.percentile === null) {
    return { kind: "none", text: NO_VALUE[feature.key] ?? "Not measured" };
  }
  return { kind: "percentile", percentile: feature.percentile };
}

/** Percentile above which a measurement makes the kid look surprised. */
const SURPRISE_ABOVE = 90;

/** The kid's face: surprised when any shown measurement is above the 90th percentile. */
export function kidMood(features: Feature[]): "smile" | "surprised" {
  return features.some((f) => {
    const display = featureDisplay(f);
    return display.kind === "percentile" && display.percentile > SURPRISE_ABOVE;
  })
    ? "surprised"
    : "smile";
}
