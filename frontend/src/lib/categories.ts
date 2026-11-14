// The dataset's content categories (plan 007), largest first. Keys match the backend's.

export const CATEGORIES: { key: string; label: string }[] = [
  { key: "music", label: "Music" },
  { key: "narrative", label: "Narrative" },
  { key: "play", label: "Play & activity" },
  { key: "educational", label: "Educational" },
  { key: "gaming", label: "Gaming" },
];

/** A category's label, or null for an unknown key. */
export function categoryLabel(key: string): string | null {
  return CATEGORIES.find((c) => c.key === key)?.label ?? null;
}
