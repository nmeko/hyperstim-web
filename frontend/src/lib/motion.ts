"use client";

import { useEffect, useState } from "react";

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Counts from `from` up to `target` over `duration` ms with an ease-out, starting again when
 * `target` changes; with reduced motion it returns `target` at once (see STYLE.md, Motion).
 */
export function useCountUp(target: number, from = 0, duration = 1000): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : from));
  useEffect(() => {
    // With reduced motion the first frame jumps straight to the target.
    const ms = prefersReducedMotion() ? 0 : duration;
    let frame = 0;
    let start: number | undefined;
    const step = (now: number) => {
      start ??= now;
      const t = ms === 0 ? 1 : Math.min(1, (now - start) / ms);
      setValue(from + (target - from) * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, from, duration]);
  return value;
}
