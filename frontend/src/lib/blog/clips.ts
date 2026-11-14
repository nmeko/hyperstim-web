// A post's clip comparison (plan 018): two YouTube videos side by side, a tab per stretch, and
// a chart that fills in as the video plays. The data comes from clips.json, which
// `backend/scripts/clip_data.py` measures with the pipeline; markdown.ts checks it against the
// post's block and hands the result to ClipCompare.

export type ClipSide = "a" | "b";
export const SIDES: readonly ClipSide[] = ["a", "b"];

/** One video's stretch for a "cuts" tab: cut times in seconds from `start`. */
export type CutsPart = { start: number; end: number; cuts: number[] };
/** One video's stretch for a "motion" tab: % of the frame's width per second, one value per `step` seconds (null across a cut). */
export type MotionPart = { start: number; end: number; step: number; motion: (number | null)[] };

/** A tab's measurements, as clips.json holds them. */
export type ClipTabData = { kind: "cuts"; a: CutsPart; b: CutsPart } | { kind: "motion"; a: MotionPart; b: MotionPart };
/** A tab: its measurements and the label the post gives it. */
export type ClipTab = ClipTabData & { label: string };
export type ClipKind = ClipTab["kind"];
export const CLIP_KINDS: readonly ClipKind[] = ["cuts", "motion"];

/** A video: its YouTube ID, title and channel name. */
export type ClipVideo = { id: string; title: string; channel: string };

/** What ClipCompare draws: the two videos and the tabs, in the post's order. */
export type Clips = { videos: Record<ClipSide, ClipVideo>; tabs: ClipTab[] };

/** clips.json: one entry per clips block, in the order they appear in the post. */
export type ClipsFile = {
  blocks: { videos: Record<ClipSide, ClipVideo>; tabs: ClipTabData[] }[];
};

/** A stretch's length in seconds. */
export function partLength(part: { start: number; end: number }): number {
  return Math.round((part.end - part.start) * 100) / 100;
}

/** "0:14.5" or "1:03" as seconds; undefined if it isn't written that way. */
export function parseClock(text: string): number | undefined {
  const match = /^(\d+):([0-5]\d(?:\.\d+)?)$/.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

/** Seconds as "0:14.5" (tenths only when there are any). */
export function formatClock(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = tenths - minutes * 600;
  const whole = Math.floor(rest / 10);
  return `${minutes}:${String(whole).padStart(2, "0")}${rest % 10 ? `.${rest % 10}` : ""}`;
}

/** The cuts up to `t` seconds into the stretch. */
export function cutsSoFar(part: CutsPart, t: number): number[] {
  return part.cuts.filter((cut) => cut <= t);
}

/** How many motion steps have started by `t` seconds into the stretch. */
export function motionStepsSoFar(part: MotionPart, t: number): number {
  return Math.min(part.motion.length, Math.floor(t / part.step) + 1);
}

/** The average motion up to `t` (steps across a cut left out), one decimal; 0 with nothing to average. */
export function motionAverage(part: MotionPart, t = Infinity): number {
  const values = part.motion.slice(0, motionStepsSoFar(part, t)).filter((v): v is number => v !== null);
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

/** The motion line up to `t` as runs of [seconds, value] points, broken where a step is null (a cut). */
export function motionRuns(part: MotionPart, t: number): [number, number][][] {
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  for (let i = 0; i < motionStepsSoFar(part, t); i++) {
    const value = part.motion[i];
    if (value === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push([(i + 0.5) * part.step, value]);
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

/** The time axis' end: the longer stretch, so its line reaches the chart's right edge. */
export function axisEnd(tab: ClipTab): number {
  return Math.max(partLength(tab.a), partLength(tab.b));
}

/** The motion chart's top: the highest value of both videos, rounded up to 10. */
export function motionTop(tab: { a: MotionPart; b: MotionPart }): number {
  const values = [...tab.a.motion, ...tab.b.motion].filter((v): v is number => v !== null);
  return Math.max(10, Math.ceil(Math.max(0, ...values) / 10) * 10);
}

/** Seconds between the time axis' labels: every 10 s on a narrow chart, every 5 s otherwise. */
export function labelStep(width: number): number {
  return width < 260 ? 10 : 5;
}

/** The time axis' labels: every label step from 0, the last with the unit ("40 s"), also when the axis ends between steps. */
export function timeLabels(end: number, width: number): { seconds: number; text: string }[] {
  const labels = [];
  for (let s = 0; s <= end; s += labelStep(width)) labels.push(s);
  return labels.map((s, i) => ({ seconds: s, text: i === labels.length - 1 ? `${s} s` : String(s) }));
}
