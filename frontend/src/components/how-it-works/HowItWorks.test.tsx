import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMeta, type Meta } from "@/lib/api";
import { FEATURE_GROUPS, FEATURE_INFO, featureSlug } from "@/lib/features";
import { videoHref } from "@/lib/routes";
import { expectNoAxeViolations } from "@/test/axe";
import HowItWorks from "./HowItWorks";
import { MARKERS } from "./WhatWeMeasure";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getMeta: vi.fn(),
}));

const meta = (channelsCheckedAt: string | null): Meta => ({
  videoCount: 16402,
  channelCount: 542,
  updatedAt: "2026-10-26",
  addedLast7Days: 1043,
  channelCount7DaysAgo: 540,
  lastAddedAt: "2026-10-26T10:00:00Z",
  referenceCount: 16375,
  channelsCheckedAt,
});

beforeEach(() => {
  vi.mocked(getMeta).mockReset().mockResolvedValue(meta(null));
});

const KEYS = FEATURE_GROUPS.flatMap((g) => g.keys);

describe("HowItWorks", () => {
  it("has one H1 without a highlight, then steps 1–4 and the questions in order", () => {
    render(<HowItWorks />);
    const [h1] = screen.getAllByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("How it works");
    expect(h1.querySelector(".marker")).toBeNull();
    const names = [
      "Step 1: Paste a link",
      "Step 2: We measure 12 things",
      "Step 3: We compare it with our dataset",
      "Step 4: You get a score",
      "Common questions",
    ];
    expect(names.map((name) => screen.getByRole("heading", { level: 2, name }))).toEqual(
      screen.getAllByRole("heading", { level: 2 }),
    );
  });

  it("lists every measurement with its anchor, marker number, description, and timeline label", () => {
    const { container } = render(<HowItWorks />);
    expect(Object.keys(MARKERS).sort()).toEqual([...KEYS].sort());
    expect(new Set(Object.values(MARKERS)).size).toBe(12);
    for (const key of KEYS) {
      const item = container.querySelector(`#${featureSlug(key)}`);
      expect(item, key).not.toBeNull();
      expect(item).toHaveTextContent(`${MARKERS[key]}${FEATURE_INFO[key].name}`);
      expect(item).toHaveTextContent(FEATURE_INFO[key].description);
      expect(screen.getByText(FEATURE_INFO[key].label)).toBeInTheDocument();
    }
  });

  it("dates the channel search from the latest scan, v2's until there is one", async () => {
    vi.mocked(getMeta).mockResolvedValue(meta("2026-10-31"));
    render(<HowItWorks />);
    expect(await screen.findByText("(at our latest scan, October 2026)")).toBeInTheDocument();
    expect(screen.getByText("We keep adding videos.")).toBeInTheDocument();
  });

  it("says v2's scan date while the latest is unknown", async () => {
    render(<HowItWorks />);
    expect(screen.getByText("(at our latest scan, August 2026)")).toBeInTheDocument();
    await screen.findByText("(at our latest scan, August 2026)");
  });

  it("says scores compare with a fixed set, and how videos are picked", () => {
    render(<HowItWorks />);
    expect(
      screen.getByText("A score of 74 means a video is more stimulating than 74 of every 100 videos we compare with."),
    ).toBeInTheDocument();
    expect(screen.getByText("How do you choose the channels and videos?")).toBeInTheDocument();
    expect(screen.getByText(/we randomly pick about the same number of videos from every year since 2015/)).toBeInTheDocument();
    expect(screen.getByText(/compared with the same set of 16,375 videos from 2015 to August 2026/)).toBeInTheDocument();
  });

  it("opens every common question", async () => {
    const user = userEvent.setup();
    const { container } = render(<HowItWorks />);
    const questions = container.querySelector("#questions")!;
    const items = within(questions as HTMLElement).getAllByRole("group");
    expect(items).toHaveLength(8);
    for (const item of items) {
      expect(item).not.toHaveAttribute("open");
      await user.click(item.querySelector("summary")!);
      expect(item).toHaveAttribute("open");
    }
  });

  it("checks a video from step 1, like the home page", async () => {
    const user = userEvent.setup();
    render(<HowItWorks />);
    const step = screen.getByRole("region", { name: "Step 1: Paste a link" });

    await user.type(within(step).getByLabelText("YouTube link or video ID"), "dQw4w9WgXcQ{Enter}");

    expect(push).toHaveBeenCalledWith(videoHref("dQw4w9WgXcQ"));
  });

  it("has no accessibility violations, with the questions closed or open", async () => {
    const user = userEvent.setup();
    vi.mocked(getMeta).mockResolvedValue(meta("2026-10-31"));
    const { container } = render(<HowItWorks />);
    await screen.findByText("(at our latest scan, October 2026)");
    await expectNoAxeViolations();
    for (const summary of container.querySelectorAll("#questions summary")) await user.click(summary);
    await expectNoAxeViolations();
  });
});
