"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Small circled "i" that shows `children` in a popover on mouse hover, click/tap, or
 * Enter/Space. The popover opens below the trigger (above if there is no room below) and is
 * right-aligned with it, so place it at the right end of a row with no controls under it.
 * With `align="row"` it starts at the left edge of the nearest positioned ancestor instead
 * (e.g. a `relative` row; in a table its first cell, as Safari ignores `relative` on a `tr`),
 * for a trigger that sits after a label at the row's start.
 */
export default function InfoTip({
  id,
  label,
  children,
  className = "",
  align = "end",
}: {
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
  align?: "end" | "row";
}) {
  // Hover shows it while the mouse is over; a click pins it until clicked again,
  // Escape, or a click outside.
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [above, setAbove] = useState(false);
  // Sideways shift that keeps the popover on screen, e.g. one right-aligned to a centred button.
  const [shift, setShift] = useState(0);
  const open = hovered || pinned;
  const ref = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setHovered(false);
      setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // Measured before paint, so a flip or shift never flashes.
  useLayoutEffect(() => {
    if (!open || !ref.current || !popover.current) return;
    const spaceBelow = window.innerHeight - ref.current.getBoundingClientRect().bottom;
    setAbove(spaceBelow < popover.current.offsetHeight);
    // 16 px from the screen's edges, like the page gutter. Measured unshifted: closing resets it.
    const { left, right } = popover.current.getBoundingClientRect();
    const edge = 16;
    const width = document.documentElement.clientWidth;
    setShift(left < edge ? edge - left : right > width - edge ? width - edge - right : 0);
    return () => setShift(0);
  }, [open]);

  return (
    <div
      ref={ref}
      className={`${align === "end" ? "relative" : ""} ${className}`}
      // Hover only for mice; touch gets the click toggle alone.
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setPinned((p) => !p)}
        className="flex size-11 items-center justify-center rounded-full"
      >
        <span
          aria-hidden="true"
          className="flex size-5 items-center justify-center rounded-full border-2 border-navy font-hand text-xs font-semibold leading-none text-navy"
        >
          i
        </span>
      </button>
      {/* The gap to the trigger is transparent padding, not margin, so the mouse can cross it
          to a link in the popover without leaving it. */}
      <div
        ref={popover}
        id={id}
        hidden={!open}
        className={`absolute z-10 w-64 ${align === "end" ? "right-0" : "left-0"} max-w-[calc(100vw-2rem)] ${above ? "bottom-full pb-1" : "top-full pt-1"}`}
        style={shift ? { translate: `${shift}px 0` } : undefined}
      >
        <div className="rounded-2xl border border-navy/15 bg-white px-4 py-3 text-left text-sm font-normal text-ink shadow-[0_4px_16px_rgb(15_46_138/0.08)]">
          {children}
        </div>
      </div>
    </div>
  );
}
