"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, useCountUp } from "@/lib/motion";

/** How long the longest first count-up takes, in ms. */
export const COUNT_UP_MS = 1000;
/** The shortest count-up, so a small rise still visibly counts. */
export const MIN_COUNT_UP_MS = 300;

/**
 * How long a count-up of `rise` takes when counts rise together at one speed (plan 013): the
 * longest rise takes `COUNT_UP_MS`, the others less in proportion, but at least `MIN_COUNT_UP_MS`.
 */
export function countUpMs(rise: number, longest: number): number {
  if (longest <= 0) return COUNT_UP_MS;
  return Math.max(MIN_COUNT_UP_MS, (COUNT_UP_MS * rise) / longest);
}

const format = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * A count that grows (see STYLE.md, Growing counts): on first render it counts up from `from` to
 * `value` in `duration` ms; after that, each rise rolls the digits that change, like a car's odometer. Only for
 * numbers that go up. Screen readers get the plain number; the moving digits are hidden from them,
 * and nothing is announced when it changes.
 */
export default function RollingNumber({
  value,
  from,
  duration = COUNT_UP_MS,
}: {
  value: number;
  from: number;
  /** How long the first count-up takes, in ms (see `countUpMs`). */
  duration?: number;
}) {
  // The count-up runs once, to the value the page started with, in its duration; later changes roll.
  const [start] = useState(() => ({ target: value, from: Math.min(from, value), duration }));
  const counted = useCountUp(start.target, start.from, start.duration);
  const counting = Math.round(counted) < start.target;
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span aria-hidden="true" data-testid="rolling-number">
        {counting ? format(counted) : <Odometer text={format(value)} />}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

/** The digits as rolls; the separators stay put. Keyed from the right, so a new leading digit
 * doesn't disturb the others. */
function Odometer({ text }: { text: string }) {
  const chars = [...text];
  return (
    <>
      {chars.map((char, i) => {
        const key = chars.length - i;
        return /\d/.test(char) ? <Digit key={key} digit={Number(char)} /> : <span key={key}>{char}</span>;
      })}
    </>
  );
}

/**
 * One digit: a strip of 0–9 twice, shown through a one-digit window. Counting up always rolls
 * upwards: from 9 to 0 it rolls on to the second 0, then jumps back to the first unseen.
 */
function Digit({ digit }: { digit: number }) {
  const [position, setPosition] = useState(digit);
  const [instant, setInstant] = useState(true);
  const shown = useRef(digit);
  useEffect(() => {
    if (digit === shown.current) return;
    const wrapped = digit < shown.current;
    shown.current = digit;
    const reduce = prefersReducedMotion();
    setInstant(reduce);
    setPosition(wrapped && !reduce ? digit + 10 : digit);
  }, [digit]);
  return (
    // clip-path, not overflow, so the window keeps the text's baseline.
    <span className="relative inline-block [clip-path:inset(0)]">
      <span className="invisible">0</span>
      <span
        className={`absolute inset-x-0 top-0 flex flex-col ${instant ? "" : "transition-transform duration-900 ease-out"}`}
        style={{ transform: `translateY(-${position * 5}%)` }}
        onTransitionEnd={() => {
          if (position >= 10) {
            setInstant(true);
            setPosition(position - 10);
          }
        }}
      >
        {Array.from({ length: 20 }, (_, i) => (
          <span key={i}>{i % 10}</span>
        ))}
      </span>
    </span>
  );
}
