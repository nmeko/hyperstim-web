"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

/** Whether a media query matches, kept up to date. False where `matchMedia` is missing. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener?.("change", onChange);
      return () => list.removeEventListener?.("change", onChange);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

/** From Tailwind's `sm` breakpoint (40rem) up. */
export const SM_UP = "(min-width: 40rem)";

/** An element's content width in px, kept up to date; `fallback` until it can be measured. */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** From Tailwind's `lg` breakpoint (64rem) up. */
export const LG_UP = "(min-width: 64rem)";
