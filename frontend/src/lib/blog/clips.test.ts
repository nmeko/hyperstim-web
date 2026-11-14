import { describe, expect, it } from "vitest";
import {
  axisEnd,
  cutsSoFar,
  formatClock,
  labelStep,
  motionAverage,
  motionRuns,
  motionStepsSoFar,
  motionTop,
  parseClock,
  timeLabels,
  partLength,
  type ClipTab,
  type MotionPart,
} from "./clips";

const motion: MotionPart = { start: 36, end: 37.2, step: 0.2, motion: [2, 4, null, 6, 8, 10] };

describe("clock times", () => {
  it.each([
    ["0:14.5", 14.5],
    ["0:03", 3],
    ["1:05.25", 65.25],
  ])("reads %s", (text, seconds) => {
    expect(parseClock(text)).toBe(seconds);
  });

  it.each(["14.5", "0:75", "0:3", "a:10", ""])("rejects %j", (text) => {
    expect(parseClock(text)).toBeUndefined();
  });

  it("writes tenths only when there are any", () => {
    expect(formatClock(14.5)).toBe("0:14.5");
    expect(formatClock(3)).toBe("0:03");
    expect(formatClock(65.25)).toBe("1:05.3");
    expect(formatClock(59.96)).toBe("1:00");
  });
});

describe("the lanes", () => {
  it("counts the cuts up to the playing time", () => {
    const part = { start: 0, end: 10, cuts: [1.5, 3, 8] };
    expect(cutsSoFar(part, 0)).toEqual([]);
    expect(cutsSoFar(part, 3)).toEqual([1.5, 3]);
    expect(cutsSoFar(part, 10)).toEqual([1.5, 3, 8]);
  });

  it("averages the motion so far, leaving out the steps across a cut", () => {
    expect(motionStepsSoFar(motion, 0)).toBe(1);
    expect(motionAverage(motion, 0)).toBe(2);
    expect(motionAverage(motion, 0.5)).toBe(3); // 2, 4 and a cut
    expect(motionAverage(motion)).toBe(6); // 2, 4, 6, 8, 10
    expect(motionAverage({ ...motion, motion: [null] })).toBe(0);
  });

  it("breaks the motion line at a cut, each point in the middle of its step", () => {
    expect(motionRuns(motion, 0.1)).toEqual([[[0.1, 2]]]);
    const runs = motionRuns(motion, 1.2);
    expect(runs).toHaveLength(2);
    expect(runs[0].map(([, v]) => v)).toEqual([2, 4]);
    expect(runs[1][0][0]).toBeCloseTo(0.7);
    expect(runs[1].map(([, v]) => v)).toEqual([6, 8, 10]);
  });

  it("sizes the axes from both videos", () => {
    const tab: ClipTab = {
      kind: "motion",
      label: "Motion",
      a: { ...motion, end: 51.5 },
      b: { ...motion, start: 21.6, end: 39.6, motion: [0.4, 23.5] },
    };
    expect(partLength(tab.a)).toBe(15.5);
    expect(axisEnd(tab)).toBe(18); // the longer stretch, not rounded up
    expect(motionTop(tab)).toBe(30);
    expect(motionTop({ a: { ...motion, motion: [0.2] }, b: { ...motion, motion: [null] } })).toBe(10);
  });

  it("puts the unit on the last label, also when the axis ends between labels", () => {
    expect(timeLabels(45, 200).map((l) => l.text)).toEqual(["0", "10", "20", "30", "40 s"]);
    expect(timeLabels(20, 600).map((l) => l.text)).toEqual(["0", "5", "10", "15", "20 s"]);
  });

  it("labels the time axis less often on a narrow chart", () => {
    expect(labelStep(200)).toBe(10);
    expect(labelStep(600)).toBe(5);
  });
});
