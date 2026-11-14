import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelDetail, ChannelVideo, Feature } from "@/lib/api";
import { expectNoAxeViolations } from "@/test/axe";
import { VIDEO_GONE } from "@/components/VideoGoneNote";
import { checkThumbnail } from "@/lib/thumbnails";
import CompareChart from "./CompareChart";
import { HOLD_MS } from "./hold-spread";

const CUTS = "inter_cut_dssim_mean"; // no value: "No cuts", drawn as a ×
const LOUD = "lufs"; // no value: "No sound", left out

function video(id: string, publishedAt: string, score: number, features: Feature[] = []): ChannelVideo {
  return { id, title: `Title ${id}`, publishedAt, score, features };
}

function channel(name: string, videos: ChannelVideo[]): ChannelDetail {
  return { id: `UC${name}`, name, videoCount: videos.length, score: 50, features: [], videos };
}

const A = channel("Alpha", [
  video("a1", "2020-01-01", 95, [{ key: CUTS, value: 0.4, percentile: 80 }, { key: LOUD, value: null, percentile: null }]),
  video("a2", "2021-06-01", 50, [{ key: CUTS, value: null, percentile: null }]),
  video("a3", "2022-03-01", 10, [{ key: CUTS, value: 0.2, percentile: 30 }]),
  video("a4", "2023-03-01", 40), // CUTS not measured: left out
]);
const B = channel("Beta", [
  video("b1", "2019-05-01", 70, [{ key: CUTS, value: 0.3, percentile: 60 }]),
  video("b2", "2024-05-01", 20, [{ key: CUTS, value: null, percentile: null }]),
]);

const onOpen = vi.fn();

function renderChart(measure = "overall", channels = { a: A, b: B }, { wide = false, marked = null as string | null } = {}) {
  onOpen.mockClear();
  return render(<CompareChart channels={channels} measure={measure} wide={wide} marked={marked} onOpen={onOpen} />);
}

const q = (c: HTMLElement, selector: string) => c.querySelector(selector);

describe("CompareChart", () => {
  it("draws A as circles and B as squares, with a trend only for 3+ values", () => {
    const { container } = renderChart();
    expect(container.querySelectorAll('circle[data-dot="a"]')).toHaveLength(4);
    expect(container.querySelectorAll('rect[data-dot="b"]')).toHaveLength(2);
    expect(q(container, '[data-trend="a"]')).toBeInTheDocument();
    expect(q(container, '[data-trend="b"]')).toBeNull();
  });

  it("draws a × for no cuts, outside the trend, and leaves out unmeasured videos", () => {
    const { container } = renderChart(CUTS);
    // A: two values, one ×, one not measured; B: one value, one ×.
    expect(container.querySelectorAll('circle[data-dot="a"]')).toHaveLength(2);
    expect(container.querySelectorAll('path[data-dot="a"]')).toHaveLength(1);
    expect(container.querySelectorAll('path[data-dot="b"]')).toHaveLength(1);
    expect(q(container, '[data-hit="a-a4"]')).toBeNull();
    // Only two values on A: no trend.
    expect(q(container, "[data-trend]")).toBeNull();
  });

  it("leaves out a measurement with no value that isn't “No cuts”", () => {
    const { container } = renderChart(LOUD);
    expect(container.querySelectorAll("[data-dot]")).toHaveLength(0);
  });

  it("shows a value's popover below a high dot and enlarges it", () => {
    const { container } = renderChart();
    fireEvent.pointerEnter(q(container, '[data-hit="a-a1"]')!, { pointerType: "mouse" });
    const popover = q(container, "[data-popover]") as HTMLElement;
    expect(popover).toHaveTextContent("Alpha");
    expect(popover).toHaveTextContent("“Title a1”");
    expect(popover).toHaveTextContent("Jan 1, 2020");
    expect(popover).toHaveTextContent("Overall:");
    expect(popover.style.top).not.toBe("");
    expect(q(container, 'circle[data-dot="a"][r="7"]')).toBeInTheDocument();
    expect(q(container, "line")).toBeInTheDocument();
  });

  it("adds a line about the video to the popover when YouTube has no thumbnail for it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 404 })));
    act(() => checkThumbnail("b1"));
    const { container } = renderChart();
    fireEvent.pointerEnter(q(container, '[data-hit="b-b1"]')!, { pointerType: "mouse" });
    await vi.waitFor(() => expect(q(container, "[data-popover]")).toHaveTextContent(VIDEO_GONE));
    fireEvent.pointerLeave(q(container, '[data-hit="b-b1"]')!, { pointerType: "mouse" });
    fireEvent.pointerEnter(q(container, '[data-hit="a-a1"]')!, { pointerType: "mouse" });
    expect(q(container, "[data-popover]")).not.toHaveTextContent(VIDEO_GONE);
    vi.unstubAllGlobals();
  });

  it("shows a popover above a low dot, for B's squares too", () => {
    const { container } = renderChart();
    fireEvent.pointerEnter(q(container, '[data-hit="b-b2"]')!, { pointerType: "mouse" });
    const popover = q(container, "[data-popover]") as HTMLElement;
    expect(popover).toHaveTextContent("Beta");
    expect(popover.style.bottom).not.toBe("");
    expect(q(container, 'rect[data-dot="b"][width="14"]')).toBeInTheDocument();
  });

  it("shows “No cuts” in a ×'s popover and enlarges the ×", () => {
    const { container } = renderChart(CUTS);
    const before = q(container, 'path[data-dot="a"]')!.getAttribute("stroke-width");
    fireEvent.pointerEnter(q(container, '[data-hit="a-a2"]')!, { pointerType: "mouse" });
    expect(q(container, "[data-popover]")).toHaveTextContent("No cuts");
    expect(q(container, 'path[data-dot="a"]')!.getAttribute("stroke-width")).not.toBe(before);
  });

  it("shows the popover to a mouse only, and hides it when the mouse leaves", () => {
    const { container } = renderChart();
    const hit = q(container, '[data-hit="a-a3"]')!;
    // A finger gets none: it would sit under the finger, which would have to stay on the dot.
    fireEvent.pointerEnter(hit, { pointerType: "touch" });
    expect(q(container, "[data-popover]")).toBeNull();
    fireEvent.pointerEnter(hit, { pointerType: "mouse" });
    expect(q(container, "[data-popover]")).toBeInTheDocument();
    fireEvent.pointerLeave(hit, { pointerType: "mouse" });
    expect(q(container, "[data-popover]")).toBeNull();
  });

  it("opens a dot's video on a click or tap, and keeps the opened video's dot marked", () => {
    const { container, rerender } = renderChart();
    fireEvent.click(q(container, '[data-hit="b-b1"]')!);
    expect(onOpen).toHaveBeenCalledWith("b-b1");
    rerender(<CompareChart channels={{ a: A, b: B }} measure="overall" wide={false} marked="b-b1" onOpen={onOpen} />);
    expect(q(container, 'rect[data-dot="b"][width="14"]')).toBeInTheDocument();
    expect(q(container, "line[stroke-dasharray]")).toBeInTheDocument();
    expect(q(container, "[data-popover]")).toBeNull();
  });

  it("hangs A's thumbnails above B's from sm, each a button that opens its video", () => {
    renderChart("overall", { a: A, b: B }, { wide: true, marked: "a-a2" });
    const a1 = screen.getByRole("button", { name: "A: Title a1, Jan 1, 2020" });
    const b1 = screen.getByRole("button", { name: "B: Title b1, May 1, 2019" });
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(parseFloat(a1.style.top)).toBeLessThan(parseFloat(b1.style.top));
    expect(screen.getByRole("button", { name: /Title a2/ })).toHaveAttribute("aria-current", "true");
    fireEvent.click(b1);
    expect(onOpen).toHaveBeenCalledWith("b-b1");
  });

  describe("hold to spread (touch)", () => {
    // jsdom has no layout: the chart's box is at 0, 0, so touch positions are chart positions.
    const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });
    const dotAt = (container: HTMLElement, k: string) => {
      const hit = q(container, `[data-hit="${k}"]`)!;
      return [Number(hit.getAttribute("cx")), Number(hit.getAttribute("cy"))];
    };
    const svgOf = (container: HTMLElement) => container.querySelector("svg")!;
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("spreads the dots around a finger held still, fades the rest, and opens the one it lifts on", () => {
      const { container } = renderChart();
      const [x, y] = dotAt(container, "a-a1");
      const svg = svgOf(container);
      const before = Array.from(container.querySelectorAll("[data-dot]"), (d) => d.outerHTML);
      fireEvent.touchStart(svg, touch(x + 3, y));
      act(() => vi.advanceTimersByTime(HOLD_MS));
      // The finger's dot is picked: larger, in the popover; the dots away from it fade.
      expect(q(container, "[data-popover]")).toHaveTextContent("Title a1");
      expect(Array.from(container.querySelectorAll("[data-dot]"), (d) => d.outerHTML)).not.toEqual(before);
      expect(container.querySelectorAll("[data-dot].opacity-30").length).toBeGreaterThan(0);
      expect(q(container, '[data-trend="a"]')).toHaveClass("opacity-30");
      const move = fireEvent.touchMove(svg, touch(x + 4, y + 1));
      expect(move).toBe(false); // the page doesn't scroll while the chart has the finger
      fireEvent.touchEnd(svg, touch(x + 4, y + 1));
      expect(onOpen).toHaveBeenCalledWith("a-a1");
      expect(q(container, "[data-popover]")).toBeNull();
      expect(container.querySelectorAll("[data-dot].opacity-30")).toHaveLength(0);
    });

    it("leaves a finger that moves before the hold to the page's scrolling", () => {
      const { container } = renderChart();
      const [x, y] = dotAt(container, "a-a1");
      const svg = svgOf(container);
      fireEvent.touchStart(svg, touch(x, y));
      const move = fireEvent.touchMove(svg, touch(x, y + 20));
      act(() => vi.advanceTimersByTime(HOLD_MS));
      expect(move).toBe(true);
      expect(q(container, "[data-popover]")).toBeNull();
      fireEvent.touchEnd(svg, touch(x, y + 20));
      expect(onOpen).not.toHaveBeenCalled();
    });

    it("opens nothing when lifted away from every dot", () => {
      const { container } = renderChart();
      const svg = svgOf(container);
      fireEvent.touchStart(svg, touch(5, 5));
      act(() => vi.advanceTimersByTime(HOLD_MS));
      expect(q(container, "[data-popover]")).toBeNull();
      fireEvent.touchEnd(svg, touch(5, 5));
      expect(onOpen).not.toHaveBeenCalled();
    });
  });

  it("has no thumbnails on phones", () => {
    renderChart();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("has no accessibility violations, with and without a popover", async () => {
    const { container } = renderChart("overall", { a: A, b: B }, { wide: true });
    await expectNoAxeViolations();
    fireEvent.pointerEnter(q(container, '[data-hit="a-a1"]')!, { pointerType: "mouse" });
    await expectNoAxeViolations();
  });
});
