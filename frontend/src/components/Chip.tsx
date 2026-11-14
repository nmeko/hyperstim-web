import type { ReactNode } from "react";

/** One chip of a group, one pressed at a time (see STYLE.md, Chips). */
export default function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="group flex min-h-11 items-center rounded-full text-sm font-semibold text-navy"
    >
      <span className="rounded-full border border-navy/15 px-3 py-1.5 group-hover:bg-sky group-aria-pressed:border-sunny group-aria-pressed:bg-sunny">
        {children}
      </span>
    </button>
  );
}
