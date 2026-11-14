// Pure helpers for the over-years charts: the channel page's (plan 005) and the compare page's
// two channels (plan 008).
import type { ChannelVideo } from "@/lib/api";
import { FEATURE_INFO, featureDisplay } from "@/lib/features";

/** What the chart shows: the overall score or one of the 12 measurements (by key). */
export type Measure = "overall" | string;

export function measureName(measure: Measure): string {
  return measure === "overall" ? "Overall" : FEATURE_INFO[measure].name;
}

/**
 * A video's place on the chart: a value 0–100 (a count of 0 is 0); no value because the
 * measurement doesn't apply ("No cuts": a ×); or left out.
 */
export type Point =
  | { kind: "value"; value: number }
  | { kind: "na"; text: string }
  | { kind: "missing"; text: string };

export function pointOf(video: ChannelVideo, measure: Measure): Point {
  if (measure === "overall") return { kind: "value", value: video.score };
  const feature = video.features.find((f) => f.key === measure);
  if (!feature) return { kind: "missing", text: "Not measured" };
  const display = featureDisplay(feature);
  if (display.kind === "percentile") return { kind: "value", value: display.percentile };
  return display.text === "No cuts" ? { kind: "na", text: display.text } : { kind: "missing", text: display.text };
}

/** The point as text: the rounded value, or why there is none. */
export function pointText(point: Point): string {
  return point.kind === "value" ? String(Math.round(point.value)) : point.text;
}

/** A YYYY-MM-DD date as a UTC timestamp in ms. */
export function dayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** "Sep 6, 2024" */
export function formatDate(date: string): string {
  return new Date(dayOf(date)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The first and last publish years (dates are sorted oldest first). */
export function yearRange(videos: ChannelVideo[]): [number, number] {
  const year = (v: ChannelVideo) => Number(v.publishedAt.slice(0, 4));
  return [year(videos[0]), year(videos[videos.length - 1])];
}

/** "29 videos in our dataset · 2018–2026" (one year: "· 2024"; one video: "1 video …"). */
export function metaLine(videos: ChannelVideo[]): string {
  const [first, last] = yearRange(videos);
  const count = videos.length === 1 ? "1 video" : `${videos.length} videos`;
  return `${count} in our dataset · ${first === last ? first : `${first}–${last}`}`;
}

// Layout in px. The plot is open-ended: gridlines and the axis, no frame.
export const LEFT = 32; // y labels
export const RIGHT = 12;
export const TOP = 12;
export const LABELS = 28; // year ticks and labels under the axis
const MIN_LABEL_SPACING = 44;

/** Plot height by width: phones, tablets, desktop. */
export function plotHeight(width: number, wide: boolean): number {
  if (!wide) return 220;
  return width >= 880 ? 320 : 280;
}

/** Where things go on a chart `width` px wide, covering whole years from `firstYear` to `lastYear`. */
export type TimeScale = {
  width: number;
  plotW: number;
  /** x of a YYYY-MM-DD date. */
  x: (date: string) => number;
  /** y of a value 0–100. */
  y: (value: number) => number;
  axisY: number;
  /** Jan 1 of each year, and of the year after the last (it closes the axis). */
  years: number[];
  /** Every `step`-th year is labelled. */
  step: number;
};

export function timeScale(width: number, wide: boolean, firstYear: number, lastYear: number): TimeScale {
  const start = Date.UTC(firstYear, 0, 1);
  const end = Date.UTC(lastYear + 1, 0, 1);
  const plotW = Math.max(1, width - LEFT - RIGHT);
  const plotH = plotHeight(width, wide);
  const years = Array.from({ length: lastYear - firstYear + 2 }, (_, i) => firstYear + i);
  return {
    width,
    plotW,
    x: (date) => LEFT + ((dayOf(date) - start) / (end - start)) * plotW,
    y: (value) => TOP + (1 - value / 100) * plotH,
    axisY: TOP + plotH,
    years,
    step: labelStep(plotW / (years.length - 1), MIN_LABEL_SPACING),
  };
}

/** Every `step`-th year gets a label, so labels at least `minSpacing` px apart fit. */
export function labelStep(yearWidth: number, minSpacing: number): number {
  return Math.max(1, Math.ceil(minSpacing / yearWidth));
}

/**
 * The trend: each value is the mean of itself and its direct neighbours (two at the ends).
 * Empty for fewer than 3 values: too few for a trend.
 */
export function smooth(values: number[]): number[] {
  if (values.length < 3) return [];
  return values.map((_, i) => {
    const window = values.slice(Math.max(0, i - 1), i + 2);
    return window.reduce((a, b) => a + b, 0) / window.length;
  });
}

type XY = [number, number];
/** One cubic Bézier segment: start, two control points, end. */
export type Segment = [XY, XY, XY, XY];

/**
 * A monotone cubic curve through points sorted by x (Fritsch–Carlson tangents): between two
 * points it never goes above or below them, so the trend never shows a value it doesn't have.
 */
export function monotoneSegments(points: XY[]): Segment[] {
  const n = points.length;
  if (n < 2) return [];
  const h = points.slice(1).map(([x], i) => x - points[i][0]);
  const d = points.slice(1).map(([, y], i) => (h[i] === 0 ? 0 : (y - points[i][1]) / h[i]));
  const m = points.map((_, i) => {
    if (i === 0) return d[0];
    if (i === n - 1) return d[n - 2];
    const [s0, s1] = [d[i - 1], d[i]];
    if (s0 * s1 <= 0) return 0;
    const p = (s0 * h[i] + s1 * h[i - 1]) / (h[i - 1] + h[i]);
    return (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p));
  });
  return h.map((hi, i) => {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    return [
      [x0, y0],
      [x0 + hi / 3, y0 + (m[i] * hi) / 3],
      [x1 - hi / 3, y1 - (m[i + 1] * hi) / 3],
      [x1, y1],
    ];
  });
}

/** The monotone curve as an SVG path. */
export function monotonePath(points: XY[]): string {
  const segments = monotoneSegments(points);
  if (segments.length === 0) return "";
  const f = (n: number) => Math.round(n * 10) / 10;
  return segments.reduce(
    (path, [, c1, c2, [x, y]]) => `${path} C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(x)} ${f(y)}`,
    `M ${f(segments[0][0][0])} ${f(segments[0][0][1])}`,
  );
}

/**
 * Rows for the thumbnails hanging under the axis. Each is centred on its date, shifted inward
 * at the chart's ends, and goes in the first row with room for it (in date order).
 */
export function placeThumbs(
  centers: number[],
  width: number,
  size: number,
  gap: number,
): { left: number; row: number }[] {
  const rowEnds: number[] = [];
  return centers.map((center) => {
    const left = Math.min(Math.max(center - size / 2, 0), Math.max(0, width - size));
    let row = rowEnds.findIndex((end) => end + gap <= left);
    if (row === -1) row = rowEnds.push(-Infinity) - 1;
    rowEnds[row] = left + size;
    return { left, row };
  });
}

/** How a thumbnail moves when its video is in focus (hovered, or opened in the panel). */
export type StackShift = { dy: number; front: boolean };

/**
 * Thumbnail rows overlap like a fanned deck. The focused thumbnail comes to the front and drops
 * `nudge` px, and the thumbnails below it in its stack (those it overlaps, in later rows) slide
 * down by `open` px, so it shows in full with space above and below it.
 */
export function stackShifts(
  placed: { left: number; row: number }[],
  focus: number | null,
  size: number,
  nudge: number,
  open: number,
): StackShift[] {
  return placed.map((p, i) => {
    if (focus === null) return { dy: 0, front: false };
    const f = placed[focus];
    if (i === focus) return { dy: nudge, front: true };
    const below = p.row > f.row && Math.abs(p.left - f.left) < size;
    return { dy: below ? open : 0, front: false };
  });
}
