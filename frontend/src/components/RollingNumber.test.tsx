import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import RollingNumber, { COUNT_UP_MS, MIN_COUNT_UP_MS, countUpMs } from "./RollingNumber";

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce, media: query }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const shown = () => screen.getByTestId("rolling-number");

/** The digit each roll shows: its strip's position, 0–9 (10–19 while rolling past 9). */
function positions(): number[] {
  return [...shown().querySelectorAll<HTMLElement>("[style]")].map((strip) =>
    Number(/translateY\(-(\d+)%\)/.exec(strip.style.transform)?.[1]) / 5,
  );
}

describe("RollingNumber", () => {
  it("counts up from `from` to the value on first render", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    mockReducedMotion(false);
    render(<RollingNumber value={16402} from={15359} />);
    expect(shown()).toHaveTextContent("15,359");
    act(() => vi.advanceTimersByTime(COUNT_UP_MS / 2));
    const halfway = Number(shown().textContent?.replace(/,/g, "").slice(0, 5));
    expect(halfway).toBeGreaterThan(15359);
    act(() => vi.advanceTimersByTime(COUNT_UP_MS));
    expect(positions()).toEqual([1, 6, 4, 0, 2]);
  });

  it("counts up in the duration it's given", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    mockReducedMotion(false);
    render(<RollingNumber value={545} from={542} duration={MIN_COUNT_UP_MS} />);
    act(() => vi.advanceTimersByTime(MIN_COUNT_UP_MS / 2));
    expect(shown()).toHaveTextContent(/^54[2-4]$/);
    act(() => vi.advanceTimersByTime(MIN_COUNT_UP_MS));
    expect(positions()).toEqual([5, 4, 5]);
  });

  it("shows the value at once with reduced motion, and reads it once to screen readers", () => {
    mockReducedMotion(true);
    render(<RollingNumber value={16402} from={0} />);
    expect(positions()).toEqual([1, 6, 4, 0, 2]);
    expect(shown()).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("16,402")).toHaveClass("sr-only");
  });

  it("rolls only the digits that change, always upwards", () => {
    mockReducedMotion(false);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const { rerender } = render(<RollingNumber value={1239} from={1239} />);
    act(() => vi.advanceTimersByTime(10));
    expect(positions()).toEqual([1, 2, 3, 9]);
    rerender(<RollingNumber value={1240} from={1239} />);
    // 3 → 4 rolls on; 9 → 0 rolls on to the strip's second 0, not back down through 8…1.
    expect(positions()).toEqual([1, 2, 4, 10]);
    expect(screen.getByText("1,240")).toHaveClass("sr-only");
    // Once there, it jumps back to the first 0, unseen.
    fireEvent.transitionEnd(shown().querySelectorAll("[style]")[3]);
    expect(positions()).toEqual([1, 2, 4, 0]);
  });

  it("jumps without rolling with reduced motion", () => {
    mockReducedMotion(true);
    const { rerender } = render(<RollingNumber value={1239} from={0} />);
    rerender(<RollingNumber value={1240} from={0} />);
    expect(positions()).toEqual([1, 2, 4, 0]);
  });

  it("adds a leading digit without disturbing the others", () => {
    mockReducedMotion(true);
    const { rerender } = render(<RollingNumber value={999} from={0} />);
    rerender(<RollingNumber value={1000} from={0} />);
    expect(positions()).toEqual([1, 0, 0, 0]);
    expect(screen.getByText("1,000")).toHaveClass("sr-only");
  });

  it("has no accessibility violations", async () => {
    mockReducedMotion(true);
    render(<RollingNumber value={16402} from={0} />);
    await expectNoAxeViolations();
  });
});

describe("countUpMs", () => {
  it("gives the longest rise the full count-up and the others less, at one speed", () => {
    expect(countUpMs(1000, 1000)).toBe(COUNT_UP_MS);
    expect(countUpMs(500, 1000)).toBe(COUNT_UP_MS / 2);
  });

  it("never goes below the floor, so a small rise still counts", () => {
    expect(countUpMs(3, 1000)).toBe(MIN_COUNT_UP_MS);
    expect(countUpMs(0, 1000)).toBe(MIN_COUNT_UP_MS);
  });

  it("gives the full count-up when nothing rises", () => {
    expect(countUpMs(0, 0)).toBe(COUNT_UP_MS);
  });
});
