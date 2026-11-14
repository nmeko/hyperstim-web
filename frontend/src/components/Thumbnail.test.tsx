import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { Thumbnail } from "./Thumbnail";
import YouTubePlayer from "./YouTubePlayer";

const BOX = "aspect-video w-full rounded-xl bg-navy/10 object-cover";

describe("Thumbnail", () => {
  it("shows the thumbnail from our backend", () => {
    const { container } = render(<Thumbnail id="dQw4w9WgXcQ" size="mq" width={320} height={180} className={BOX} />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "/api/thumbnails/dQw4w9WgXcQ?size=mq");
    expect(img).toHaveAttribute("alt", "");
  });

  it("is a placeholder box with a picture icon when it can't load", () => {
    const { container } = render(<Thumbnail id="dQw4w9WgXcQ" width={320} height={180} className={BOX} />);
    fireEvent.error(container.querySelector("img")!);

    expect(container.querySelector("img")).toBeNull();
    const box = container.querySelector("[data-thumbnail-missing]");
    expect(box).toHaveClass("aspect-video", "rounded-xl", "bg-navy/10"); // the image's own box
    expect(box).toHaveAttribute("aria-hidden", "true");
    expect(box?.querySelector("svg")).not.toBeNull();
  });

  it("is a placeholder for an image that failed before it mounted", () => {
    const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete");
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => true });
    try {
      const { container } = render(<Thumbnail id="dQw4w9WgXcQ" width={320} height={180} className={BOX} />);
      expect(container.querySelector("[data-thumbnail-missing]")).not.toBeNull();
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, "complete", complete!);
    }
  });

  it("tries again for another video", () => {
    const { container, rerender } = render(<Thumbnail id="dQw4w9WgXcQ" width={320} height={180} className={BOX} />);
    fireEvent.error(container.querySelector("img")!);
    rerender(<Thumbnail id="aaaaaaaaaaa" width={320} height={180} className={BOX} />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/api/thumbnails/aaaaaaaaaaa?size=hq");
  });

  it("has no icon in a video preview, whose Play button stays", () => {
    const { container } = render(<YouTubePlayer id="dQw4w9WgXcQ" title="Snail time" />);
    fireEvent.error(container.querySelector("img")!);

    expect(container.querySelector("[data-thumbnail-missing]")?.querySelector("svg")).toBeNull();
    expect(screen.getByRole("button", { name: "Play video: Snail time" })).toBeInTheDocument();
  });

  it("has no accessibility violations as a placeholder", async () => {
    const { container } = render(
      <button type="button" aria-label="Snail time, Sep 6, 2024">
        <Thumbnail id="dQw4w9WgXcQ" width={64} height={36} className="size-full" />
      </button>,
    );
    fireEvent.error(container.querySelector("img")!);
    await expectNoAxeViolations();
  });
});
