import { describe, expect, it } from "vitest";
import { SPREAD_R, spreadOut } from "./hold-spread";

const finger = { x: 100, y: 100 };

describe("spreadOut", () => {
  it("moves a nearby point away from the finger, and grows it", () => {
    const at = spreadOut(110, 100, finger);
    expect(at.inside).toBe(true);
    expect(at.x).toBeGreaterThan(110);
    expect(at.y).toBe(100);
    expect(at.scale).toBeGreaterThan(1);
  });

  it("moves closer points further apart than farther ones, and grows them more", () => {
    const near = spreadOut(105, 100, finger);
    const far = spreadOut(130, 100, finger);
    expect(near.x - 100).toBeGreaterThan(5 * 2);
    expect(far.x - 100).toBeLessThan(SPREAD_R);
    expect(near.scale).toBeGreaterThan(far.scale);
  });

  it("leaves points at or beyond the spread's edge where they are", () => {
    expect(spreadOut(100 + SPREAD_R, 100, finger)).toEqual({ x: 100 + SPREAD_R, y: 100, scale: 1, inside: false });
    expect(spreadOut(0, 0, finger)).toEqual({ x: 0, y: 0, scale: 1, inside: false });
  });

  it("keeps a point right under the finger in place, at the largest size", () => {
    expect(spreadOut(100, 100, finger)).toEqual({ x: 100, y: 100, scale: 1.9, inside: true });
  });

  it("ends at the edge: no jump for a point just inside", () => {
    expect(spreadOut(100 + SPREAD_R - 0.01, 100, finger).x).toBeCloseTo(100 + SPREAD_R, 1);
  });
});
