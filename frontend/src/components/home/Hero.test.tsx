import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getChannels, getMeta, getVideos, type Meta } from "@/lib/api";
import { expectNoAxeViolations } from "@/test/axe";
import Hero from "./Hero";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getMeta: vi.fn(),
  getVideos: vi.fn(),
  getChannels: vi.fn(),
}));

const meta = (changes: Partial<Meta> = {}): Meta => ({
  videoCount: 16402,
  channelCount: 542,
  updatedAt: "2026-10-26",
  addedLast7Days: 1043,
  channelCount7DaysAgo: 540,
  lastAddedAt: "2026-10-26T10:00:00Z",
  referenceCount: 16375,
  channelsCheckedAt: null,
  ...changes,
});

/** What a screen reader reads: the text without the moving digits (aria-hidden). */
function readable(element: Element | null): string {
  const copy = element!.cloneNode(true) as Element;
  copy.querySelectorAll("[aria-hidden='true']").forEach((hidden) => hidden.remove());
  return copy.textContent!.replace(/\s+/g, " ").trim();
}

const pastWeek = (videos: number, channels: number) => {
  vi.mocked(getVideos).mockResolvedValue({ items: [], total: videos, asOf: "2026-10-26T10:00:00Z" });
  vi.mocked(getChannels).mockResolvedValue({ items: [], total: channels, asOf: "2026-10-26T10:00:00Z" });
};

const KEY = "added in the past week";

beforeEach(() => {
  pastWeek(1043, 12);
  // Reduced motion: the numbers show at once.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduced-motion"), media: query }));
});

describe("Hero", () => {
  it("says how many videos and channels, each with what it gained in the past week", async () => {
    vi.mocked(getMeta).mockResolvedValue(meta());
    render(<Hero />);
    const videos = await screen.findByRole("link", { name: "1,043 videos added in the past week" });
    const channels = screen.getByRole("link", { name: "12 channels added in the past week" });
    expect(videos).toHaveClass("bg-sky", "text-navy", "rounded-full");
    // Each opens the rankings with what it counts: the videos, or the Channels tab.
    expect(videos).toHaveAttribute("href", expect.stringMatching(/^\/rankings\?q=added%3A%3E\d{4}-\d{2}-\d{2}$/));
    expect(channels).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/rankings\?view=channels&q=added%3A%3E\d{4}-\d{2}-\d{2}$/),
    );
    expect(readable(screen.getByText(/channels to better/))).toBe(
      "Explore and compare 16,402 1,043 videos from 542 12 channels to better understand what your child is watching.",
    );
    // The key is for the eye; screen readers hear it in each link.
    expect(screen.getByText(KEY)).toHaveAttribute("aria-hidden", "true");
  });

  it("leaves a badge out when nothing was added, and the key when neither was", async () => {
    vi.mocked(getMeta).mockResolvedValue(meta());
    pastWeek(5, 0);
    const { unmount } = render(<Hero />);
    expect(await screen.findByRole("link", { name: /videos added/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /channels added/ })).not.toBeInTheDocument();
    expect(screen.getByText(KEY)).toBeInTheDocument();
    unmount();

    pastWeek(0, 0);
    render(<Hero />);
    expect(readable(await screen.findByText(/channels to better/))).toContain("16,402 videos from 542 channels");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(KEY)).not.toBeInTheDocument();
  });

  it("shows the sentence, badges and key at once, with room kept for the numbers", () => {
    vi.mocked(getMeta).mockReturnValue(new Promise(() => {}));
    render(<Hero />);
    expect(screen.getByText(/channels to better/)).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(KEY)).toBeInTheDocument();
    expect(screen.queryByTestId("rolling-number")).not.toBeInTheDocument();
  });

  it("reads as a sentence before the numbers come, with no placeholder digits in its text", () => {
    vi.mocked(getMeta).mockReturnValue(new Promise(() => {}));
    render(<Hero />);
    const sentence = screen.getByText(/channels to better/);
    // What crawlers and link previews read from the page as built (plan 011).
    expect(sentence.textContent!.replace(/\s+/g, " ").trim()).toBe(
      "Explore and compare thousands of videos from hundreds of channels to better understand what your child is watching.",
    );
    expect(readable(sentence)).toBe(sentence.textContent!.replace(/\s+/g, " ").trim());
    // The bars keep their width from digits drawn by CSS.
    expect(sentence.querySelectorAll("[data-digits]")).toHaveLength(4);
  });

  it("says “thousands of” if the numbers can't be had", async () => {
    vi.mocked(getMeta).mockRejectedValue(new Error("offline"));
    render(<Hero />);
    expect(await screen.findByText(/Explore and compare thousands of videos/)).toBeInTheDocument();
    expect(screen.queryByText(KEY)).not.toBeInTheDocument();
  });

  it("has no accessibility violations, loading and loaded", async () => {
    let resolve!: (m: Meta) => void;
    vi.mocked(getMeta).mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Hero />);
    await expectNoAxeViolations();
    resolve(meta());
    await screen.findByRole("link", { name: /channels added in the past week/ });
    await expectNoAxeViolations();
  });
});
