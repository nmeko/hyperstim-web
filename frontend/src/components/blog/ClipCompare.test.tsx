import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Clips } from "@/lib/blog/clips";
import { expectNoAxeViolations } from "@/test/axe";
import ClipCompare from "./ClipCompare";

const PLAYER = "https://www.youtube-nocookie.com";

const CLIPS: Clips = {
  videos: {
    a: { id: "aaaaaaaaaaa", title: "Ducks, fast", channel: "Fast Channel" },
    b: { id: "bbbbbbbbbbb", title: "Ducks, slow", channel: "Slow Channel" },
  },
  tabs: [
    {
      kind: "cuts",
      label: "Scene changes",
      a: { start: 14.5, end: 30.5, cuts: [1.5, 3, 9] },
      b: { start: 3, end: 21.6, cuts: [] },
    },
    {
      kind: "motion",
      label: "Motion",
      a: { start: 36, end: 37, step: 0.2, motion: [10, 20, null, 30, 40] },
      b: { start: 21.6, end: 22.6, step: 0.2, motion: [1, 1, 1, 1, 1] },
    },
  ],
};

/** The lane of video A or B: the hidden chart and its number. */
function lane(side: "A" | "B") {
  const lanes = document.querySelectorAll<HTMLElement>(".grid > .contents > div:not(p)");
  return lanes[side === "A" ? 0 : 1];
}

/** YouTube's player reporting its state and time to the page. */
function report(title: RegExp, info: { playerState?: number; currentTime?: number }) {
  const player = (screen.getByTitle(title) as HTMLIFrameElement).contentWindow!;
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { origin: PLAYER, source: player, data: JSON.stringify({ event: "infoDelivery", info }) }),
    );
  });
}

describe("ClipCompare", () => {
  it("shows each video's whole result before anyone presses Play", () => {
    render(<ClipCompare clips={CLIPS} />);
    expect(screen.queryByText(/Play the videos/)).toBeNull(); // no hint line
    expect(lane("A")).toHaveTextContent("3cuts in 16 s");
    expect(lane("B")).toHaveTextContent("0cuts in 19 s");
    expect(lane("A").querySelectorAll("[data-cut]")).toHaveLength(3);
    expect(document.querySelector("[data-playhead]")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("rings each video's letter in solid navy, like the compare page's badges", () => {
    render(<ClipCompare clips={CLIPS} />);
    const letters = screen.getAllByText(/^[AB]$/);
    expect(letters).toHaveLength(4); // each video's head and lane
    for (const letter of letters) {
      expect(letter).toHaveClass("bg-white", "ring-navy", "text-navy");
      expect(letter).not.toHaveClass("ring-navy/35");
    }
  });

  it("starts a video's lane over when it plays, and draws the cuts as far as the video has played", async () => {
    const user = userEvent.setup();
    render(<ClipCompare clips={CLIPS} />);
    await user.click(screen.getByRole("button", { name: "Play video: A: Ducks, fast (Scene changes)" }));

    const frame = screen.getByTitle(/^A: Ducks, fast \(Scene/);
    expect(frame.getAttribute("src")).toMatch(/embed\/aaaaaaaaaaa\?autoplay=1&playsinline=1&start=14&end=31&enablejsapi=1/);
    expect(lane("A")).toHaveTextContent("0cuts in 0 s");
    expect(lane("A").querySelectorAll("[data-cut]")).toHaveLength(0);
    expect(lane("B")).toHaveTextContent("0cuts in 19 s"); // B hasn't played: still its whole result

    report(/^A: .*Scene/, { playerState: 1, currentTime: 18 });
    report(/^A: .*Scene/, { playerState: 2, currentTime: 18 }); // paused 3.5 s in
    expect(lane("A")).toHaveTextContent("2cuts in 3 s"); // whole seconds
    expect(lane("A").querySelectorAll("[data-cut]")).toHaveLength(2);
    expect(lane("A").querySelector("[data-playhead]")).not.toBeNull();

    report(/^A: .*Scene/, { playerState: 1, currentTime: 30.4 });
    report(/^A: .*Scene/, { playerState: 2, currentTime: 30.6 }); // the end
    expect(lane("A")).toHaveTextContent("3cuts in 16 s");
    expect(lane("A").querySelector("[data-playhead]")).toBeNull();
  });

  it("plays one video at a time: starting B pauses A", async () => {
    const user = userEvent.setup();
    render(<ClipCompare clips={CLIPS} />);
    await user.click(screen.getByRole("button", { name: /^Play video: A: .*Scene/ }));
    const a = (screen.getByTitle(/^A: .*Scene/) as HTMLIFrameElement).contentWindow!;
    const post = vi.spyOn(a, "postMessage").mockImplementation(() => {});

    await user.click(screen.getByRole("button", { name: /^Play video: B: .*Scene/ }));
    expect(post).toHaveBeenCalledWith(JSON.stringify({ event: "command", func: "pauseVideo", args: [] }), PLAYER);
    expect(lane("B")).toHaveTextContent("0cuts in 0 s");
  });

  it("keeps each tab where it was: switching pauses the tab left behind, and coming back finds it paused there", async () => {
    const user = userEvent.setup();
    render(<ClipCompare clips={CLIPS} />);
    await user.click(screen.getByRole("button", { name: /^Play video: A: .*Scene/ }));
    report(/^A: .*Scene/, { playerState: 1, currentTime: 22.5 }); // 8 s in
    const a = (screen.getByTitle(/^A: .*Scene/) as HTMLIFrameElement).contentWindow!;
    const post = vi.spyOn(a, "postMessage").mockImplementation(() => {});

    await user.click(screen.getByRole("button", { name: "Motion" }));
    expect(post).toHaveBeenCalledWith(JSON.stringify({ event: "command", func: "pauseVideo", args: [] }), PLAYER);
    report(/^A: .*Scene/, { playerState: 2, currentTime: 22.5 });
    expect(screen.getByRole("button", { name: "Motion" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTitle(/^A: .*Scene/).closest("[hidden]")).not.toBeNull(); // still there, out of sight
    expect(lane("A")).toHaveTextContent("25.0% of width/s"); // the motion tab's whole result: 10, 20, 30, 40

    await user.click(screen.getByRole("button", { name: "Play video: A: Ducks, fast (Motion)" }));
    report(/^A: .*Motion/, { playerState: 1, currentTime: 36.7 });
    report(/^A: .*Motion/, { playerState: 2, currentTime: 36.7 });
    expect(lane("A")).toHaveTextContent("20.0% of width/s"); // 10, 20 and a cut, 30
    expect(lane("A").querySelectorAll("[data-motion]")).toHaveLength(2); // broken at the cut

    await user.click(screen.getByRole("button", { name: "Scene changes" }));
    expect(lane("A")).toHaveTextContent("2cuts in 8 s");
    expect(screen.getByTitle(/^A: .*Scene/).closest("[hidden]")).toBeNull();
  });

  it("tells screen readers what the tab shows, as the chart is hidden from them", async () => {
    const user = userEvent.setup();
    render(<ClipCompare clips={CLIPS} />);
    expect(screen.getByText("Scene changes: video A has 3 cuts in 16 seconds; video B has no cuts in 19 seconds.")).toHaveClass("sr-only");
    await user.click(screen.getByRole("button", { name: "Motion" }));
    expect(
      screen.getByText("Motion: on average, the picture in video A moves 25 and in video B 1 percent of the frame's width per second."),
    ).toBeInTheDocument();
    for (const svg of document.querySelectorAll("svg:not([aria-hidden])")) {
      expect(svg.closest("[aria-hidden]")).not.toBeNull();
    }
  });

  it("draws both tabs' charts at the same height, so the page doesn't jump between them", async () => {
    const user = userEvent.setup();
    render(<ClipCompare clips={CLIPS} />);
    const height = () => lane("A").querySelector("svg")!.getAttribute("height");
    const cuts = height();
    await user.click(screen.getByRole("button", { name: "Motion" }));
    expect(height()).toBe(cuts);
  });

  it("links each video's title to its page on the site, with its channel under it", () => {
    render(<ClipCompare clips={CLIPS} />);
    expect(screen.getByRole("link", { name: "Ducks, fast" })).toHaveAttribute("href", "/video?id=aaaaaaaaaaa");
    expect(screen.getByRole("link", { name: "Ducks, slow" })).toHaveAttribute("href", "/video?id=bbbbbbbbbbb");
    expect(screen.getByRole("link", { name: "Ducks, fast" }).nextElementSibling).toHaveTextContent(/^Fast Channel$/);
  });

  describe("the lanes control playback", () => {
    const command = (func: string, args: unknown[] = []) => JSON.stringify({ event: "command", func, args });
    const slider = (side: "A" | "B") => screen.getByRole("slider", { name: new RegExp(`^Video ${side}: `) });
    /** Lays out a lane's chart as 300 px wide from the page's left edge, as jsdom has no layout. */
    const place = (el: HTMLElement) => vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ left: 0, width: 300 } as DOMRect);
    /** The page position of `seconds` on a cuts lane: 4 px in, 12 px short of the end, an 18.6 s axis (B's stretch). */
    const cutsX = (seconds: number) => 4 + (seconds / 18.6) * (300 - 4 - 12);

    it("are sliders: named after their video, valued in seconds played, the whole stretch before Play", () => {
      render(<ClipCompare clips={CLIPS} />);
      expect(slider("A")).toHaveAccessibleName("Video A: Ducks, fast");
      expect(slider("A")).toHaveAttribute("aria-valuemax", "16");
      expect(slider("A")).toHaveAttribute("aria-valuetext", "16 of 16 seconds, 3 cuts so far");
      expect(slider("B")).toHaveAttribute("aria-valuetext", "18 of 19 seconds, 0 cuts so far");
    });

    it("dragging previews the moment, and letting go plays the video from exactly there", () => {
      render(<ClipCompare clips={CLIPS} />);
      const lane = slider("A");
      place(lane);
      fireEvent.pointerDown(lane, { clientX: cutsX(8), button: 0, pointerId: 1 });
      fireEvent.pointerMove(lane, { clientX: cutsX(10), pointerId: 1 });
      expect(lane).toHaveAttribute("aria-valuetext", "10 of 16 seconds, 3 cuts so far");
      expect(document.querySelector("iframe")).toBeNull(); // nothing from YouTube while dragging

      fireEvent.pointerUp(lane, { clientX: cutsX(10), pointerId: 1 });
      const player = (screen.getByTitle(/^A: .*Scene/) as HTMLIFrameElement).contentWindow!;
      const post = vi.spyOn(player, "postMessage").mockImplementation(() => {});
      report(/^A: .*Scene/, { playerState: 1, currentTime: 14 });
      const [[sent]] = post.mock.calls.filter(([m]) => String(m).includes("seekTo"));
      expect(JSON.parse(String(sent)).args[0]).toBeCloseTo(24.5); // 14.5 + 10, not snapped to a cut
      expect(lane).toHaveAttribute("aria-valuetext", "10 of 16 seconds, 3 cuts so far");
    });

    it("pauses the video that was playing, then plays the other from the clicked moment", async () => {
      const user = userEvent.setup();
      render(<ClipCompare clips={CLIPS} />);
      await user.click(screen.getByRole("button", { name: /^Play video: B: .*Scene/ }));
      const b = (screen.getByTitle(/^B: .*Scene/) as HTMLIFrameElement).contentWindow!;
      const postB = vi.spyOn(b, "postMessage").mockImplementation(() => {});

      const lane = slider("A");
      place(lane);
      fireEvent.pointerDown(lane, { clientX: cutsX(5), button: 0, pointerId: 1 });
      fireEvent.pointerUp(lane, { clientX: cutsX(5), pointerId: 1 });
      expect(postB).toHaveBeenCalledWith(command("pauseVideo"), PLAYER);
      expect(screen.getByTitle(/^A: .*Scene/)).toBeInTheDocument();
      expect(lane.querySelector("[data-playhead]")).not.toBeNull();
      expect(slider("B").querySelector("[data-playhead]")).toBeNull();
    });

    it("by keyboard: arrows move 1 s, Page Up/Down 5 s, Home and End to either end, each playing from there", async () => {
      const user = userEvent.setup();
      render(<ClipCompare clips={CLIPS} />);
      slider("A").focus();
      await user.keyboard("{Home}");
      expect(slider("A")).toHaveAttribute("aria-valuetext", "0 of 16 seconds, 0 cuts so far");
      expect(slider("A")).toHaveFocus(); // the player that started doesn't take it
      const player = (screen.getByTitle(/^A: .*Scene/) as HTMLIFrameElement).contentWindow!;
      const post = vi.spyOn(player, "postMessage").mockImplementation(() => {});
      report(/^A: .*Scene/, { playerState: 1, currentTime: 14 });
      expect(post).toHaveBeenCalledWith(command("seekTo", [14.5, true]), PLAYER);

      post.mockClear();
      await user.keyboard("{ArrowRight}{PageUp}");
      expect(slider("A")).toHaveAttribute("aria-valuenow", "6");
      const seeks = post.mock.calls.map(([m]) => JSON.parse(String(m))).filter((m) => m.func === "seekTo");
      expect(seeks.at(-1).args[0]).toBeCloseTo(20.5, 1); // 14.5 + 6 (the clock runs on a little in between)
      expect(post).toHaveBeenCalledWith(command("playVideo"), PLAYER);
      await user.keyboard("{End}");
      expect(slider("A")).toHaveAttribute("aria-valuetext", "16 of 16 seconds, 3 cuts so far");
    });

    it("a drag the browser takes over for scrolling is called off without playing", () => {
      render(<ClipCompare clips={CLIPS} />);
      const lane = slider("A");
      place(lane);
      fireEvent.pointerDown(lane, { clientX: cutsX(4), button: 0, pointerId: 1 });
      fireEvent.pointerCancel(lane, { pointerId: 1 });
      expect(lane).toHaveAttribute("aria-valuetext", "16 of 16 seconds, 3 cuts so far");
      expect(document.querySelector("iframe")).toBeNull();
    });
  });

  it("shows a single tab without the tab switch", () => {
    render(<ClipCompare clips={{ ...CLIPS, tabs: [CLIPS.tabs[0]] }} />);
    expect(screen.queryByRole("group")).toBeNull();
    expect(within(document.body).getAllByRole("button", { name: /^Play video/ })).toHaveLength(2);
  });

  it("has no accessibility violations", async () => {
    render(<ClipCompare clips={CLIPS} />);
    await expectNoAxeViolations();
  });
});
