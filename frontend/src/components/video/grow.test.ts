import { afterEach, describe, expect, it, vi } from "vitest";
import { canAnimate, grow } from "./grow";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON() {} };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (Element.prototype as { animate?: unknown }).animate; // jsdom has none
  document.body.innerHTML = "";
});

describe("canAnimate", () => {
  it("is off with reduced motion, and where the animation API is missing", () => {
    const el = document.createElement("div");
    el.animate = vi.fn();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    expect(canAnimate(el)).toBe(true);
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query }));
    expect(canAnimate(el)).toBe(false);
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    expect(canAnimate(document.createElement("div"))).toBe(false);
  });
});

describe("grow", () => {
  it("flies the thumbnail into the new box, hiding it until it lands", () => {
    const flights: { keyframes: Keyframe[]; animation: { onfinish: (() => void) | null } }[] = [];
    Element.prototype.animate = vi.fn(function (keyframes: Keyframe[]) {
      const animation = { onfinish: null, oncancel: null };
      flights.push({ keyframes, animation });
      return animation as unknown as Animation;
    });
    const to = document.createElement("div");
    const panel = document.createElement("section");
    document.body.append(to, panel);
    vi.spyOn(to, "getBoundingClientRect").mockReturnValue(rect(100, 150, 800, 450));
    const done = vi.fn();

    const still = document.createElement("p");
    grow(rect(900, 80, 300, 169), to, "/thumb.jpg", [{ el: panel, dx: 0, dy: 200 }, { el: still, dx: 0, dy: 0 }], done);

    const ghost = document.body.querySelector<HTMLElement>("div[aria-hidden]")!;
    expect(ghost.querySelector("img")).toHaveAttribute("src", "/thumb.jpg");
    expect(to.style.visibility).toBe("hidden");
    // The panel slides; an element that didn't move doesn't.
    expect(flights).toHaveLength(2);
    expect(flights[0].keyframes).toEqual([{ transform: "translate(0px, 200px)" }, { transform: "none" }]);
    expect(flights[1].keyframes).toEqual([
      { left: "900px", top: "80px", width: "300px", height: "169px" },
      { left: "100px", top: "150px", width: "800px", height: "450px" },
    ]);

    flights[1].animation.onfinish!();
    expect(to.style.visibility).toBe("");
    expect(ghost.isConnected).toBe(false);
    expect(done).toHaveBeenCalledOnce();
  });
});
