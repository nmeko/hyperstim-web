import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getAnalysis,
  getVideo,
  startAnalysis,
  type Analysis,
  type Feature,
  type VideoDetail,
} from "@/lib/api";
import { FEATURE_GROUPS } from "@/lib/features";
import { expectNoAxeViolations } from "@/test/axe";
import { GIVE_UP_MS, POLL_MS } from "./LiveAnalysis";
import VideoPage from "./VideoPage";

let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getVideo: vi.fn(),
  startAnalysis: vi.fn(),
  getAnalysis: vi.fn(),
}));

const ID = "dQw4w9WgXcQ";
const KEYS = FEATURE_GROUPS.flatMap((g) => g.keys);

function video(overrides: Partial<Record<string, Partial<Feature>>> = {}): VideoDetail {
  return {
    id: ID,
    title: "Tiny Trucks Race",
    channelId: "UCwheelie",
    channel: "Wheelie Friends TV",
    score: 86.6,
    channelInDataset: true,
    features: KEYS.map((key) => ({ key, value: 1.5, percentile: 40, ...overrides[key] })),
  };
}

function open(id: string | null) {
  search = new URLSearchParams(id === null ? "" : { id });
  return render(<VideoPage />);
}

beforeEach(() => {
  // Reduced motion, so the gauge shows its final value at once.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query }));
  vi.mocked(getVideo).mockReset().mockResolvedValue(video());
  vi.mocked(startAnalysis).mockReset();
  vi.mocked(getAnalysis).mockReset();
  document.title = "Video details - HyperStim?";
});

describe("VideoPage", () => {
  it("shows the score, the 12 measurements and sets the title", async () => {
    open(ID);

    expect(await screen.findByRole("heading", { level: 1, name: "Tiny Trucks Race" })).toBeInTheDocument();
    expect(getVideo).toHaveBeenCalledWith(ID);
    expect(screen.getByRole("link", { name: "Wheelie Friends TV" })).toHaveAttribute("href", "/channel?id=UCwheelie");
    expect(screen.getByRole("link", { name: /Compare with another video/ })).toHaveAttribute("href", `/compare?a=${ID}`);
    expect(screen.queryByRole("link", { name: /Watch on YouTube/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Stimulation score" })).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "About the stimulation score" })).toBeInTheDocument();
    expect(screen.getByText("Stimulation score 87 out of 100")).toBeInTheDocument();
    expect(screen.queryByText(/More stimulating than/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Higher than 40% of videos in our dataset")).toHaveLength(12);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Pacing intensification",
      "Sustained sensory intensity",
      "Reward patterning",
    ]);
    expect(screen.getByRole("button", { name: "Play video: Tiny Trucks Race" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Tiny Trucks Race - HyperStim?"));
  });

  it("moves the player under the title on play, and the shrink button puts the preview back", async () => {
    const user = userEvent.setup();
    const { container } = open(ID);
    const header = ".grid-cols-\\[2fr_1fr\\]";
    const play = await screen.findByRole("button", { name: "Play video: Tiny Trucks Race" });
    expect(container.querySelector(header)).not.toBeNull();
    await user.click(play);

    const frame = screen.getByTitle("Tiny Trucks Race");
    expect(frame).toHaveFocus();
    // Only the cover over the player, until it has loaded.
    expect(container.querySelector('img[src^="/api/thumbnails/"]:not([data-cover])')).toBeNull();
    // Under the title and channel line, not in the header's 1/3 column.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector(header)).toBeNull();
    // The title stays at the left; only the player is centred, at the screen-fitting width.
    expect(heading.closest(".mx-auto")).not.toHaveClass("max-w-[min(100%,max(24rem,calc((100svh_-_22rem)*16/9)))]");
    expect(frame.closest(".mx-auto")).toHaveClass("max-w-[min(100%,max(24rem,calc((100svh_-_22rem)*16/9)))]");

    await user.click(screen.getByRole("button", { name: "Shrink video" }));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector('img[src^="/api/thumbnails/"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Play video: Tiny Trucks Race" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Shrink video" })).not.toBeInTheDocument();
    expect(container.querySelector(header)).not.toBeNull();
  });

  it("ducks the kid behind the panel while the video plays", async () => {
    const user = userEvent.setup();
    const { container } = open(ID);
    await user.click(await screen.findByRole("button", { name: "Play video: Tiny Trucks Race" }));
    const kid = container.querySelector("img[data-kid]");
    expect(kid).toHaveClass("translate-y-0", "[clip-path:inset(0_0_100%_0)]");
    expect(container.querySelector("img[data-cover]")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Shrink video" }));
    expect(kid).toHaveClass("-translate-y-[92.1%]");
  });

  it("shows the channel as a pill link", async () => {
    open(ID);
    const link = await screen.findByRole("link", { name: "Wheelie Friends TV" });
    expect(screen.getByText("Wheelie Friends TV")).toHaveClass("rounded-full", "bg-sky");
    expect(link).toHaveClass("min-h-11");
  });

  it("names a channel we don't have without linking it", async () => {
    vi.mocked(getVideo).mockResolvedValue({ ...video(), channelInDataset: false });
    open(ID);
    expect(await screen.findByText("Wheelie Friends TV")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Wheelie Friends TV" })).not.toBeInTheDocument();
    expect(screen.getByText("Wheelie Friends TV")).not.toHaveClass("rounded-full");
  });

  it("shows the value with the description in the info popover", async () => {
    const user = userEvent.setup();
    open(ID);
    await user.click(await screen.findByRole("button", { name: "About Rapid cutting" }));
    expect(screen.getByText("How often the picture switches to a new shot.")).toBeVisible();
    expect(screen.getByText("1.5 cuts per minute")).toBeVisible();
    expect(screen.getByRole("link", { name: "More about this: Rapid cutting" })).toHaveAttribute(
      "href",
      "/how-it-works#rapid-cutting",
    );
  });

  it("says the score is about production style only", async () => {
    const user = userEvent.setup();
    open(ID);
    await user.click(await screen.findByRole("button", { name: "About the stimulation score" }));
    expect(screen.getByText(/We measure production style only\./)).toBeVisible();
    expect(screen.queryByText(/good or bad/)).not.toBeInTheDocument();
  });

  it("shows a count of 0 as 0, and No cuts, No sound and Not measured", async () => {
    vi.mocked(getVideo).mockResolvedValue(
      video({
        build_resolve_per_min: { value: 0, percentile: 0 },
        inter_cut_dssim_mean: { value: null, percentile: null },
        lufs: { value: null, percentile: null },
        motion_frac: { value: null, percentile: null },
      }),
    );
    open(ID);
    expect(await screen.findByText("No cuts")).toBeInTheDocument();
    expect(screen.getByText("No sound")).toBeInTheDocument();
    expect(screen.getByText("Not measured")).toBeInTheDocument();
    expect(screen.getByText("Higher than 0% of videos in our dataset")).toBeInTheDocument();
    expect(screen.getAllByText(/^Higher than/)).toHaveLength(9);
  });

  it("shows the kid peeking over the score panel", async () => {
    const { container } = open(ID);
    await screen.findByRole("heading", { level: 1, name: "Tiny Trucks Race" });
    const kid = container.querySelector("img[data-kid]");
    expect(kid).toHaveAttribute("src", "/images/kid_3.webp");
    expect(kid).toHaveAttribute("alt", "");
  });

  it("shows a busy skeleton while loading", () => {
    vi.mocked(getVideo).mockReturnValue(new Promise(() => {}));
    const { container } = open(ID);
    expect(screen.getByRole("status")).toHaveTextContent("Loading video…");
    expect(container.querySelector("[aria-busy=true]")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it.each([null, "", "short", `https://youtu.be/${ID}`])("rejects the ID %j", (id) => {
    open(id);
    expect(screen.getByText("That doesn’t look like a YouTube video ID.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Check another video/ })).toHaveAttribute("href", "/");
    expect(getVideo).not.toHaveBeenCalled();
  });

  it("shows an error with a retry that reloads", async () => {
    const user = userEvent.setup();
    vi.mocked(getVideo).mockRejectedValueOnce(new ApiError(500, "down"));
    open(ID);
    expect(await screen.findByText("We couldn’t load this video.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Tiny Trucks Race" })).toBeInTheDocument();
  });

  it("has no accessibility violations, with and without a popover open", async () => {
    const user = userEvent.setup();
    open(ID);
    await user.click(await screen.findByRole("button", { name: "About Rapid cutting" }));
    await expectNoAxeViolations();
    await user.keyboard("{Escape}");
    await expectNoAxeViolations();
  });

  it("has no accessibility violations on an error", async () => {
    vi.mocked(getVideo).mockRejectedValue(new ApiError(500, "down"));
    open(ID);
    await screen.findByText("We couldn’t load this video.");
    await expectNoAxeViolations();
  });
});

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    status: "download",
    queuePosition: null,
    progress: 0.4,
    remainingS: 30,
    error: null,
    ...overrides,
  };
}

describe("VideoPage, a video not in the dataset", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getVideo).mockRejectedValue(new ApiError(404, "Video not found"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const poll = () => act(() => vi.advanceTimersByTimeAsync(POLL_MS));
  // Visible text only: the live region repeats some of it for screen readers.
  const VISIBLE = { ignore: "[aria-live], script, style" };

  it("starts the analysis and shows its steps and progress", async () => {
    vi.mocked(startAnalysis).mockResolvedValue(analysis());
    const { container } = open(ID);

    expect(await screen.findByRole("heading", { level: 1, name: "Checking this video…" })).toBeInTheDocument();
    await waitFor(() => expect(startAnalysis).toHaveBeenCalledWith(ID));
    await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40"));
    expect(screen.queryByText(/^“/, VISIBLE)).not.toBeInTheDocument(); // no video title while checking
    const steps = screen.getAllByRole("listitem");
    expect(steps.map((li) => li.textContent)).toEqual([
      "Looking up the video(done)",
      "Downloading a 5-minute clip(current)",
      "Measuring",
    ]);
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    const bar = screen.getByRole("progressbar", { name: "Analysis progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar.firstElementChild).toHaveClass("motion-reduce:transition-none");
    expect(screen.getByText("Less than a minute left", VISIBLE)).toBeInTheDocument();
    expect(container.querySelector("img[data-kid]")).toHaveAttribute("src", "/images/kid_2.webp");
    expect(screen.queryByText("This one is taking longer than usual.", VISIBLE)).not.toBeInTheDocument();
  });

  it("polls until done, then shows the result", async () => {
    vi.mocked(startAnalysis).mockResolvedValue(analysis({ status: "lookup", progress: 0.05 }));
    vi.mocked(getAnalysis)
      .mockResolvedValueOnce(analysis({ status: "measure", progress: 0.7, remainingS: 75 }))
      .mockResolvedValueOnce(analysis({ status: "done", progress: 1, remainingS: null }));
    open(ID);
    expect(await screen.findByRole("heading", { level: 1, name: "Checking this video…" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Looking up the video/, VISIBLE).closest("li")).toHaveAttribute("aria-current", "step"));

    await poll();
    expect(screen.getByText("About 1 min left", VISIBLE)).toBeInTheDocument();
    expect(screen.getByText("Measuring", VISIBLE)).toBeInTheDocument();

    vi.mocked(getVideo).mockResolvedValue(video());
    await poll();
    expect(await screen.findByRole("heading", { level: 1, name: "Tiny Trucks Race" })).toBeInTheDocument();
    expect(getAnalysis).toHaveBeenCalledTimes(2);
    await poll();
    expect(getAnalysis).toHaveBeenCalledTimes(2); // polling stopped
  });

  it("announces step changes and the result to screen readers", async () => {
    vi.mocked(startAnalysis).mockResolvedValue(analysis({ status: "download" }));
    vi.mocked(getAnalysis)
      .mockResolvedValueOnce(analysis({ status: "measure" }))
      .mockResolvedValueOnce(analysis({ status: "done", progress: 1 }));
    const { container } = open(ID);
    const live = () => container.querySelector("[aria-live=polite]");
    await waitFor(() => expect(live()).toHaveTextContent("Downloading a 5-minute clip"));
    await poll();
    expect(live()).toHaveTextContent("Measuring");
    vi.mocked(getVideo).mockResolvedValue(video());
    await poll();
    await screen.findByRole("heading", { level: 1, name: "Tiny Trucks Race" });
    expect(live()).toHaveTextContent("Done");
  });

  it.each([
    [2, "2 videos ahead of yours."],
    [1, "1 video ahead of yours."],
  ])("says how many videos are ahead (%i)", async (position, text) => {
    vi.mocked(startAnalysis).mockResolvedValue(
      analysis({ status: "queued", queuePosition: position, progress: 0, remainingS: null }),
    );
    open(ID);
    expect(await screen.findByText(text, VISIBLE)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Looking up the video",
      "Downloading a 5-minute clip",
      "Measuring",
    ]);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("never shows a full bar before the result", async () => {
    vi.mocked(startAnalysis).mockResolvedValue(analysis({ status: "measure", progress: 0.999 }));
    open(ID);
    await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "99"));
  });

  it.each([
    ["unavailable", "We couldn’t get this video from YouTube. It may be private, removed, or restricted."],
    ["not_for_kids", "YouTube doesn’t list this video as made for kids, so we can’t check it."],
    ["too_short", "This video is too short to measure: we need at least 90 seconds."],
    ["live", "We can’t measure live streams or premieres that haven’t aired yet."],
  ] as const)("explains a failure (%s) and stops polling", async (error, text) => {
    vi.mocked(startAnalysis).mockResolvedValue(analysis());
    vi.mocked(getAnalysis).mockResolvedValue(analysis({ status: "failed", error }));
    open(ID);
    await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40"));
    await poll();
    expect(await screen.findByText(text, VISIBLE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Check another video/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /Watch on YouTube/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    await poll();
    expect(getAnalysis).toHaveBeenCalledTimes(1);
  });

  it("offers to try again when measuring failed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(startAnalysis)
      .mockResolvedValueOnce(analysis({ status: "failed", error: "failed" }))
      .mockResolvedValueOnce(analysis({ status: "queued", queuePosition: 0, progress: 0 }));
    open(ID);
    expect(await screen.findByText("Something went wrong while measuring this video.", VISIBLE)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Checking this video…" })).toBeInTheDocument();
    expect(startAnalysis).toHaveBeenCalledTimes(2);
  });

  it.each([
    [503, "We’re checking a lot of videos right now. Please try again in a few minutes."],
    [429, "You’ve checked several new videos in the last hour. Please try again later."],
  ])("says when the analysis can't start (%i), with a manual retry", async (status, text) => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(startAnalysis)
      .mockRejectedValueOnce(new ApiError(status, "refused"))
      .mockResolvedValueOnce(analysis());
    open(ID);
    expect(await screen.findByText(text, VISIBLE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Check another video/ })).toBeInTheDocument();
    await poll();
    expect(startAnalysis).toHaveBeenCalledTimes(1); // no automatic retry
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
  });

  it("keeps polling through a lost connection, then gives up", async () => {
    vi.mocked(startAnalysis).mockResolvedValue(analysis());
    vi.mocked(getAnalysis)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(analysis({ status: "measure" }))
      .mockRejectedValue(new TypeError("Failed to fetch"));
    open(ID);
    await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40"));
    await poll(); // fails quietly
    expect(screen.getByRole("heading", { level: 1, name: "Checking this video…" })).toBeInTheDocument();
    await poll(); // back
    expect(screen.getByText("Measuring", VISIBLE).closest("li")).toHaveAttribute("aria-current", "step");
    await act(() => vi.advanceTimersByTimeAsync(GIVE_UP_MS + POLL_MS));
    expect(screen.getByText("We couldn’t load this video.", VISIBLE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("has no accessibility violations while checking", async () => {
    vi.mocked(startAnalysis).mockResolvedValue(analysis());
    open(ID);
    await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40"));
    await expectNoAxeViolations();
  });

  it("has no accessibility violations when the check failed", async () => {
    vi.mocked(startAnalysis).mockResolvedValue(analysis({ status: "failed", error: "unavailable" }));
    open(ID);
    await screen.findByText(/We couldn’t get this video from YouTube/, VISIBLE);
    await expectNoAxeViolations();
  });
});
