import { filledSegments } from "@/components/ScoreMeter";

/** The score meter's colours by filled segments, at 50 % so navy text stays readable (≥ 6.3 : 1). */
const TILE_COLORS = ["bg-sky-blue/50", "bg-leaf/50", "bg-scale-low/50", "bg-scale-mid/50", "bg-scale-high/50"];

/**
 * A 0–100 score as a navy number on a tile in the score meter's colour (see STYLE.md, Score
 * cell). `empty` replaces the tile with a muted dash and gives screen readers the reason.
 */
export default function ScoreCell({ score, empty }: { score: number | null; empty?: string }) {
  if (score === null) {
    return (
      <span className="inline-flex h-8 w-10 items-center justify-center text-sm text-ink/60">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{empty}</span>
      </span>
    );
  }
  const rounded = Math.round(score);
  const filled = filledSegments(rounded);
  return (
    <span
      data-filled={filled}
      className={`inline-flex h-8 w-10 items-center justify-center rounded-lg text-sm font-bold text-navy tabular-nums ${TILE_COLORS[filled - 1]}`}
    >
      {rounded}
    </span>
  );
}
