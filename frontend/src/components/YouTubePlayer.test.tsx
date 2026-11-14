import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import YouTubePlayer, { type PlayerHandle } from "./YouTubePlayer";

describe("YouTubePlayer", () => {
  it("shows only the thumbnail until Play is clicked, then the player in focus", async () => {
    const user = userEvent.setup();
    const { container } = render(<YouTubePlayer id="dQw4w9WgXcQ" title="Snail time" />);
    const focus = vi.spyOn(HTMLIFrameElement.prototype, "focus");

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.innerHTML).not.toContain("youtube-nocookie.com");
    expect(container.querySelector("img")).toHaveAttribute("src", "/api/thumbnails/dQw4w9WgXcQ?size=hq");

    await user.click(screen.getByRole("button", { name: "Play video: Snail time" }));

    const frame = screen.getByTitle("Snail time");
    expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1");
    expect(frame).toHaveFocus();
    // Without scrolling: WebKit would scroll to it later, undoing where a page put it (the channel panel).
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(container.querySelector("img")).toBeNull();
    focus.mockRestore();
  });

  // Before Play only: axe can't reach into jsdom's iframe once the player is there.
  it("has no accessibility violations", async () => {
    render(<YouTubePlayer id="dQw4w9WgXcQ" title="Snail time" />);
    await expectNoAxeViolations();
  });
});

describe("YouTubePlayer with onStart", () => {
  it("leaves the playing state to its parent", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const { container, rerender } = render(<YouTubePlayer id="dQw4w9WgXcQ" title="Snail time" onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: "Play video: Snail time" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(container.querySelector("iframe")).toBeNull();

    rerender(<YouTubePlayer id="dQw4w9WgXcQ" title="Snail time" playing />);
    expect(screen.getByTitle("Snail time")).toHaveFocus();
  });
});

describe("YouTubePlayer with cover", () => {
  it("keeps the thumbnail over the player until it has loaded", () => {
    vi.useFakeTimers();
    const { container } = render(<YouTubePlayer id="dQw4w9WgXcQ" title="Snail time" playing cover />);
    const cover = container.querySelector("img[data-cover]");
    expect(cover).toHaveAttribute("src", "/api/thumbnails/dQw4w9WgXcQ?size=hq");
    expect(cover).not.toHaveClass("opacity-0");

    act(() => {
      screen.getByTitle("Snail time").dispatchEvent(new Event("load"));
    });
    expect(cover).not.toHaveClass("opacity-0");
    act(() => vi.advanceTimersByTime(400));
    expect(cover).toHaveClass("opacity-0", "pointer-events-none");
    vi.useRealTimers();
  });
});

describe("YouTubePlayer with onPlay", () => {
  it("reports each start, and pauses through the embed's message API", async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const ref = createRef<PlayerHandle>();
    render(<YouTubePlayer id="dQw4w9WgXcQ" title="Snail time" onPlay={onPlay} ref={ref} />);

    await user.click(screen.getByRole("button", { name: "Play video: Snail time" }));
    const frame = screen.getByTitle("Snail time") as HTMLIFrameElement;
    expect(frame.src).toContain("enablejsapi=1");
    expect(onPlay).toHaveBeenCalledTimes(1);

    const player = frame.contentWindow!;
    const post = vi.spyOn(player, "postMessage").mockImplementation(() => {});
    const report = (state: number) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "https://www.youtube-nocookie.com",
            source: player,
            data: JSON.stringify({ event: "infoDelivery", info: { playerState: state } }),
          }),
        );
      });
    report(1); // still the same start
    report(2); // paused
    report(1); // playing again
    expect(onPlay).toHaveBeenCalledTimes(2);

    ref.current!.pause();
    expect(post).toHaveBeenCalledWith(
      JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
      "https://www.youtube-nocookie.com",
    );
  });
});

describe("YouTubePlayer with a stretch and onTime", () => {
  it("plays from start to end, reports the time, and starts over when played again after the end", async () => {
    const user = userEvent.setup();
    const onTime = vi.fn();
    render(<YouTubePlayer id="dQw4w9WgXcQ" title="Snail time" start={14.5} end={30.5} onTime={onTime} />);
    await user.click(screen.getByRole("button", { name: "Play video: Snail time" }));
    const frame = screen.getByTitle("Snail time") as HTMLIFrameElement;
    expect(frame.src).toContain("?autoplay=1&playsinline=1&start=14&end=31&enablejsapi=1");

    const player = frame.contentWindow!;
    const post = vi.spyOn(player, "postMessage").mockImplementation(() => {});
    const sent = (func: string, args: unknown[] = []) =>
      expect(post).toHaveBeenCalledWith(JSON.stringify({ event: "command", func, args }), "https://www.youtube-nocookie.com");
    const report = (info: object) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "https://www.youtube-nocookie.com",
            source: player,
            data: JSON.stringify({ event: "infoDelivery", info }),
          }),
        );
      });

    report({ playerState: 1, currentTime: 14 }); // the embed starts on whole seconds
    sent("seekTo", [14.5, true]);
    report({ playerState: 2, currentTime: 20 });
    expect(onTime).toHaveBeenLastCalledWith(20);

    report({ playerState: 1, currentTime: 20 });
    report({ currentTime: 30.6 });
    sent("pauseVideo");
    report({ playerState: 2, currentTime: 30.7 });
    expect(onTime).toHaveBeenLastCalledWith(30.5); // never past the end

    post.mockClear();
    report({ playerState: 1, currentTime: 30.7 }); // Play again
    sent("seekTo", [14.5, true]);
  });
});

describe("YouTubePlayer in the static build", () => {
  it("renders without a page address before Play, with onPlay or onTime", async () => {
    const { renderToString } = await import("react-dom/server");
    const location = Object.getOwnPropertyDescriptor(window, "location")!;
    // The build has no window.location; reading it would throw.
    Object.defineProperty(window, "location", { configurable: true, get: () => undefined });
    try {
      expect(renderToString(<YouTubePlayer id="dQw4w9WgXcQ" title="Snail time" onTime={() => {}} start={3} end={9} />)).toContain(
        "Play video",
      );
    } finally {
      Object.defineProperty(window, "location", location);
    }
  });
});

describe("YouTubePlayer with captions off", () => {
  it("turns YouTube's captions off once, when the video first plays", async () => {
    const user = userEvent.setup();
    render(<YouTubePlayer id="dQw4w9WgXcQ" title="Snail time" captions={false} />);
    await user.click(screen.getByRole("button", { name: "Play video: Snail time" }));
    const frame = screen.getByTitle("Snail time") as HTMLIFrameElement;
    expect(frame.src).toContain("enablejsapi=1");
    const player = frame.contentWindow!;
    const post = vi.spyOn(player, "postMessage").mockImplementation(() => {});
    const report = (state: number) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "https://www.youtube-nocookie.com",
            source: player,
            data: JSON.stringify({ event: "infoDelivery", info: { playerState: state } }),
          }),
        );
      });
    const unloads = () => post.mock.calls.filter(([m]) => String(m).includes("unloadModule")).map(([m]) => JSON.parse(String(m)).args[0]);

    report(3); // buffering
    expect(unloads()).toEqual([]);
    report(1);
    expect(unloads()).toEqual(["captions", "cc"]);
    report(2);
    report(1); // a viewer who turned them back on keeps them
    expect(unloads()).toEqual(["captions", "cc"]);
  });
});

describe("YouTubePlayer's playFrom", () => {
  const report = (player: Window, info: object) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://www.youtube-nocookie.com",
          source: player,
          data: JSON.stringify({ event: "infoDelivery", info }),
        }),
      );
    });
  const command = (func: string, args: unknown[] = []) => JSON.stringify({ event: "command", func, args });

  it("starts a player that hasn't been, then goes to the moment once it answers", () => {
    const ref = createRef<PlayerHandle>();
    const onTime = vi.fn();
    render(<YouTubePlayer id="dQw4w9WgXcQ" title="Snail time" start={14.5} end={51.8} onTime={onTime} ref={ref} />);
    act(() => ref.current!.playFrom(30.2));
    const player = (screen.getByTitle("Snail time") as HTMLIFrameElement).contentWindow!;
    const post = vi.spyOn(player, "postMessage").mockImplementation(() => {});

    report(player, { playerState: 1, currentTime: 14 });
    expect(post).toHaveBeenCalledWith(command("seekTo", [30.2, true]), "https://www.youtube-nocookie.com");
    expect(post).not.toHaveBeenCalledWith(command("seekTo", [14.5, true]), expect.anything()); // not to the stretch's start
    report(player, { playerState: 2, currentTime: 30.2 });
    expect(onTime).toHaveBeenLastCalledWith(30.2);
  });

  it("moves a started player to the moment and plays it, also after the end", async () => {
    const user = userEvent.setup();
    const ref = createRef<PlayerHandle>();
    render(<YouTubePlayer id="dQw4w9WgXcQ" title="Snail time" start={14.5} end={51.8} onTime={() => {}} ref={ref} />);
    await user.click(screen.getByRole("button", { name: "Play video: Snail time" }));
    const player = (screen.getByTitle("Snail time") as HTMLIFrameElement).contentWindow!;
    const post = vi.spyOn(player, "postMessage").mockImplementation(() => {});
    report(player, { playerState: 1, currentTime: 51.7 });
    report(player, { playerState: 2, currentTime: 51.8 }); // ended

    post.mockClear();
    act(() => ref.current!.playFrom(20));
    expect(post.mock.calls.map(([m]) => m)).toEqual([command("seekTo", [20, true]), command("playVideo")]);
    report(player, { playerState: 1, currentTime: 20 });
    expect(post).not.toHaveBeenCalledWith(command("seekTo", [14.5, true]), expect.anything()); // not "start over"
  });
});
