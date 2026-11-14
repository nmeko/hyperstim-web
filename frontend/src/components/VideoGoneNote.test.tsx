import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { VIDEO_GONE, VideoGoneNote } from "./VideoGoneNote";
import YouTubePlayer from "./YouTubePlayer";

// The thumbnail store lives for the page load, so each test uses its own video ID.

function preview(id: string, status: number) {
  const fetch = vi.fn(async () => ({ status }));
  vi.stubGlobal("fetch", fetch);
  const view = render(
    <div>
      <YouTubePlayer id={id} title="Snail time" />
      <VideoGoneNote id={id} />
    </div>,
  );
  fireEvent.error(view.container.querySelector("img")!);
  return { ...view, fetch };
}

afterEach(() => vi.unstubAllGlobals());

describe("VideoGoneNote", () => {
  it("says the video may be gone when YouTube has no thumbnail for it", async () => {
    preview("note0000001", 404);
    expect(await screen.findByText(VIDEO_GONE)).toHaveClass("text-sm", "text-ink/80");
    expect(VIDEO_GONE).toBe("This video may have been removed or made private on YouTube.");
  });

  it("says nothing when YouTube can't be reached", async () => {
    const { fetch } = preview("note0000002", 502);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByText(VIDEO_GONE)).not.toBeInTheDocument();
  });

  it("says nothing while the thumbnail loads", () => {
    render(<VideoGoneNote id="note0000003" />);
    expect(screen.queryByText(VIDEO_GONE)).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = preview("note0000004", 404);
    await screen.findByText(VIDEO_GONE);
    await expectNoAxeViolations(container);
  });
});
