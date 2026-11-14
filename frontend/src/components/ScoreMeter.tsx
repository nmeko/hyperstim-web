/** Colour of the score meter by filled segments, cool for low scores and warm for high ones. */
const METER_COLORS = ["bg-sky-blue", "bg-leaf", "bg-scale-low", "bg-scale-mid", "bg-scale-high"];
const SEGMENTS = METER_COLORS.length;

/**
 * Filled segments of the score meter: one per 20 points, at least one so a score of 0 still
 * shows the meter's colour. The number next to it is the exact score.
 */
export function filledSegments(score: number): number {
  return Math.max(1, Math.ceil((score * SEGMENTS) / 100));
}

/**
 * A 0–100 score as a bold number and a 5-segment meter (see STYLE.md, Score meter). `regular`
 * puts the number above the meter on phones; `compact` keeps it beside a narrow meter.
 * `srLabel` replaces the number for screen readers.
 */
export default function ScoreMeter({
  score,
  size = "regular",
  srLabel,
}: {
  score: number;
  size?: "regular" | "compact";
  srLabel?: string;
}) {
  const rounded = Math.round(score);
  const filled = filledSegments(rounded);
  const compact = size === "compact";
  return (
    <span
      className={
        compact
          ? "flex items-center gap-2"
          : "flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2"
      }
    >
      <span
        aria-hidden={srLabel ? true : undefined}
        className={`font-bold text-navy tabular-nums ${compact ? "w-8 text-right" : "sm:w-7 sm:text-right"}`}
      >
        {rounded}
      </span>
      {srLabel && <span className="sr-only">{srLabel}</span>}
      <span
        aria-hidden="true"
        data-filled={filled}
        className={`flex gap-1 ${compact ? "w-[4.5rem] shrink-0" : "flex-1"}`}
      >
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 flex-1 rounded-[3px] ${i < filled ? METER_COLORS[filled - 1] : "bg-navy/10"}`}
          />
        ))}
      </span>
    </span>
  );
}
