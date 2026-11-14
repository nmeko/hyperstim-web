import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

// Hold to spread (plan 008): on a touch screen, a finger held still on the chart spreads the
// dots around it apart, so one of several close dots can be picked; lifting it opens that one.

/** How long the finger rests before the chart takes it over from page scrolling. */
export const HOLD_MS = 330;
/** Moving further than this before then is a scroll. */
const SLOP = 8;
/** The dots within this many px of the finger spread apart… */
export const SPREAD_R = 46;
/** …this strongly (a fisheye's distortion). */
const SPREAD_K = 2.6;
/** …and grow up to this much. */
const SPREAD_GROW = 0.9;

export type Finger = { x: number; y: number };

/**
 * Where a point at (px, py) is drawn while a finger at `finger` spreads the points around it:
 * moved away from the finger (the closer it was, the further), and how much larger it is drawn.
 */
export function spreadOut(px: number, py: number, finger: Finger): { x: number; y: number; scale: number; inside: boolean } {
  const dx = px - finger.x;
  const dy = py - finger.y;
  const d = Math.hypot(dx, dy);
  if (d >= SPREAD_R) return { x: px, y: py, scale: 1, inside: false };
  const t = d / SPREAD_R;
  const moved = (SPREAD_R * (SPREAD_K + 1) * t) / (SPREAD_K * t + 1);
  const scale = 1 + (1 - t) * SPREAD_GROW;
  if (d === 0) return { x: px, y: py, scale, inside: true };
  return { x: finger.x + (dx / d) * moved, y: finger.y + (dy / d) * moved, scale, inside: true };
}

/**
 * The finger held on `target`, in its own px, or null. A finger held still for `HOLD_MS` takes
 * over: the page doesn't scroll while it slides, and lifting it calls `onLift` (instead of a
 * click). A finger that moves sooner scrolls the page as usual; a quick tap stays a tap.
 */
export function useHoldToSpread(target: RefObject<SVGSVGElement | null>, onLift: (finger: Finger) => void): Finger | null {
  const [finger, setFinger] = useState<Finger | null>(null);
  const lift = useRef(onLift);
  useLayoutEffect(() => {
    lift.current = onLift;
  });

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    let start: Finger | null = null;
    let last: Finger | null = null;
    let held = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const at = (touch: Touch): Finger => {
      const box = el.getBoundingClientRect();
      return { x: touch.clientX - box.left, y: touch.clientY - box.top };
    };
    const stop = () => {
      clearTimeout(timer);
      start = last = null;
      held = false;
      setFinger(null);
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return stop();
      start = last = at(e.touches[0]);
      timer = setTimeout(() => {
        held = true;
        setFinger(last);
      }, HOLD_MS);
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      last = at(e.touches[0]);
      if (held) {
        // The chart has the finger: no page scroll.
        e.preventDefault();
        setFinger(last);
      } else if (Math.hypot(last.x - start.x, last.y - start.y) > SLOP) {
        // A scroll: let the page have it.
        clearTimeout(timer);
        start = null;
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (held && last) {
        // No click after a held finger: the lift picks instead.
        if (e.cancelable) e.preventDefault();
        lift.current(last);
      }
      stop();
    };
    // A long press would otherwise open the browser's own menu.
    const onMenu = (e: Event) => {
      if (start) e.preventDefault();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", stop);
    el.addEventListener("contextmenu", onMenu);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", stop);
      el.removeEventListener("contextmenu", onMenu);
    };
  }, [target]);

  return finger;
}
