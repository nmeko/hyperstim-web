import type { ReactNode } from "react";

// Small pieces shared by the How it works sections (see STYLE.md, Diagrams).

export const SECTION_CARD = "rounded-[2rem] border border-navy/15 bg-white px-4 py-8 sm:px-8";
export const H2 = "font-hand text-2xl font-semibold text-navy sm:text-3xl";
export const TEXT_LINK = "font-bold text-navy underline decoration-2 underline-offset-4 hover:decoration-sunny";

/** A section card with its H2; a page step's H2 starts with its number in a sunny circle. */
export function Section({
  id,
  title,
  step,
  className = "",
  children,
}: {
  id: string;
  title: string;
  step?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className={`${SECTION_CARD} ${className}`}>
      <h2 id={`${id}-heading`} className={`flex items-center gap-3 ${H2}`}>
        {step !== undefined && (
          <>
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunny text-lg"
            >
              {step}
            </span>
            <span className="sr-only">Step {step}:</span>{" "}
          </>
        )}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One sentence under a section's H2, across the card's full width. */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-2">{children}</p>;
}

/** Numbered navy circle that ties a diagram's marker to its list item. Decorative. */
export function Marker({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white tabular-nums ${className}`}
    >
      {n}
    </span>
  );
}

/**
 * Arrow between diagram steps: ↓ while the steps are stacked (below md), none in the 2 × 2 grid at
 * md, → once they sit in a row (from lg).
 */
export function StepArrow({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`self-center font-hand text-2xl leading-none text-navy/60 md:hidden lg:inline ${className}`}
    >
      <span className="md:hidden">↓</span>
      <span className="hidden md:inline">→</span>
    </span>
  );
}
