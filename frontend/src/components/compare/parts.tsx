import type { Side } from "./state";

// Pieces shared by the compare page's parts (plan 008).

/**
 * A side's "A" / "B" badge (see STYLE.md, A/B badge): a white circle with a navy ring, the same
 * for both sides, so the letter tells them apart. Screen readers hear `sr` instead of the
 * letter when given (e.g. the video's title), and nothing when it's `decorative` (where text
 * nearby already names the side).
 */
export function Badge({
  side,
  sr,
  decorative = false,
  large = false,
  className = "",
}: {
  side: Side;
  sr?: string;
  decorative?: boolean;
  /** The slot's own badge, sized to match the × beside it; inline badges stay text-sized. */
  large?: boolean;
  className?: string;
}) {
  return (
    <>
      <span
        aria-hidden={sr || decorative ? true : undefined}
        className={`inline-flex shrink-0 items-center justify-center rounded-full align-middle bg-white font-sans font-bold text-navy ring-[1.5px] ring-navy ring-inset ${large ? "size-9 text-lg" : "size-6 text-sm"} ${className}`}
      >
        {side.toUpperCase()}
      </span>
      {sr && <span className="sr-only">{sr}</span>}
    </>
  );
}
