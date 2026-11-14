import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getAnalysis,
  getChannel,
  getChannels,
  getVideo,
  getVideos,
  lookupChannel,
  startAnalysis,
  type ChannelDetail,
  type Feature,
  type RankedChannel,
  type RankedVideo,
  type VideoDetail,
} from "@/lib/api";
import { FEATURE_GROUPS } from "@/lib/features";
import { expectNoAxeViolations } from "@/test/axe";
import ComparePage from "./ComparePage";

// The URL: router calls change it, and the page re-reads it, as in the browser.
const url = vi.hoisted(() => {
  let search = new URLSearchParams();
  const listeners = new Set<() => void>();
  const navigate = (href: string) => {
    search = new URLSearchParams(href.split("?")[1] ?? "");
    listeners.forEach((l) => l());
  };
  return {
    get search() {
      return search;
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    navigate,
    push: vi.fn(navigate),
  };
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => useSyncExternalStore(url.subscribe, () => url.search),
  useRouter: () => ({ push: url.push }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getVideo: vi.fn(),
  getChannel: vi.fn(),
  getVideos: vi.fn(),
  getChannels: vi.fn(),
  startAnalysis: vi.fn(),
  getAnalysis: vi.fn(),
  lookupChannel: vi.fn(),
}));

const KEYS = FEATURE_GROUPS.flatMap((g) => g.keys);
const features = (percentile: number, overrides: Record<string, Partial<Feature>> = {}): Feature[] =>
  KEYS.map((key) => ({ key, value: 2, percentile, ...overrides[key] }));

const VIDEO_A = "aaaaaaaaaa1";
const VIDEO_B = "bbbbbbbbbb2";
const NEW_VIDEO = "nnnnnnnnnn3";
const CHANNEL_A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const CHANNEL_B = "UCbbbbbbbbbbbbbbbbbbbbbb";

const videos: Record<string, VideoDetail> = {
  [VIDEO_A]: {
    id: VIDEO_A,
    title: "Turbo Trucks",
    channelId: CHANNEL_A,
    channel: "Zoom Kids",
    channelInDataset: true,
    score: 82.4,
    features: features(50, { cuts_per_min: { value: 22.6, percentile: 88 } }),
  },
  [VIDEO_B]: {
    id: VIDEO_B,
    title: "Garden Walk",
    channelId: CHANNEL_B,
    channel: "Quiet Lane",
    channelInDataset: true,
    score: 41,
    features: features(50, { cuts_per_min: { value: 7.1, percentile: 35 } }),
  },
};

const channelVideo = (id: string, year: number, score: number) => ({
  id,
  title: `Video ${id}`,
  publishedAt: `${year}-03-01`,
  score,
  features: features(score),
});
const channels: Record<string, ChannelDetail> = {
  [CHANNEL_A]: {
    id: CHANNEL_A,
    name: "Zoom Kids",
    videoCount: 3,
    score: 80,
    features: features(80),
    videos: [channelVideo("za", 2019, 70), channelVideo("zb", 2020, 80), channelVideo("zc", 2021, 90)],
  },
  [CHANNEL_B]: {
    id: CHANNEL_B,
    name: "Quiet Lane",
    videoCount: 2,
    score: 78,
    features: features(78),
    videos: [channelVideo("qa", 2021, 75), channelVideo("qb", 2022, 81)],
  },
};

const ranked = (v: VideoDetail): RankedVideo => ({ ...v, category: "music", rank: 1 });
const rankedChannel = (c: ChannelDetail): RankedChannel => ({ ...c, rank: 1 });

function open(query = "") {
  url.navigate(`/compare?${query}`);
  return render(<ComparePage />);
}

const lastPush = () => url.push.mock.calls.at(-1)?.[0];

beforeEach(() => {
  url.push.mockClear();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), media: query }));
  vi.mocked(getVideo)
    .mockReset()
    .mockImplementation(async (id) => {
      if (videos[id]) return videos[id];
      throw new ApiError(404, "not found");
    });
  vi.mocked(getChannel)
    .mockReset()
    .mockImplementation(async (id) => {
      if (channels[id]) return channels[id];
      throw new ApiError(404, "not found");
    });
  vi.mocked(getVideos)
    .mockReset()
    .mockImplementation(async ({ q }) => {
      const items = Object.values(videos)
        .filter((v) => v.title.toLowerCase().includes((q ?? "").toLowerCase()))
        .map(ranked);
      return { items, total: items.length, asOf: "2026-10-26T00:00:00Z" };
    });
  vi.mocked(getChannels)
    .mockReset()
    .mockImplementation(async ({ q }) => {
      const items = Object.values(channels)
        .filter((c) => c.name.toLowerCase().includes((q ?? "").toLowerCase()))
        .map(rankedChannel);
      return { items, total: items.length, asOf: "2026-10-26T00:00:00Z" };
    });
  vi.mocked(startAnalysis).mockReset().mockResolvedValue({
    status: "download",
    queuePosition: null,
    progress: 0.3,
    remainingS: 40,
    error: null,
  });
  vi.mocked(getAnalysis).mockReset();
  vi.mocked(lookupChannel).mockReset();
});

describe("ComparePage", () => {
  it("starts with two empty pickers and a way into the rankings", () => {
    open();
    expect(screen.getByRole("heading", { level: 1, name: "Compare" })).toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: "Video name or video link" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Browse the rankings/ })).toHaveAttribute("href", "/rankings");
  });

  it("suggests matching videos, leaves out the other slot's, and picks with the keyboard", async () => {
    const user = userEvent.setup();
    open(`a=${VIDEO_A}`);
    await screen.findByText("Turbo Trucks");

    const box = screen.getByRole("combobox");
    await user.type(box, "r"); // both titles contain an "r"
    const list = await screen.findByRole("listbox");
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(1));
    expect(getVideos).toHaveBeenLastCalledWith({ sort: "score", order: "desc", q: "r", offset: 0, limit: 20 });
    expect(within(list).getByRole("option")).toHaveTextContent("Garden Walk");
    // Each video leads with its thumbnail, from our backend.
    expect(within(list).getByRole("option").querySelector("img")?.getAttribute("src")).toContain(
      `/api/thumbnails/${VIDEO_B}?size=mq`,
    );
    expect(screen.getByText("1 suggestions")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", within(list).getByRole("option").id);
    await user.keyboard("{Enter}");
    expect(lastPush()).toBe(`/compare?a=${VIDEO_A}&b=${VIDEO_B}`);
    // Focus lands on the filled slot.
    await waitFor(() => expect(screen.getByRole("region", { name: "Video B" })).toHaveFocus());
  });

  it("offers a pasted link as is, without searching for it", async () => {
    const user = userEvent.setup();
    open();
    const [box] = screen.getAllByRole("combobox");
    await user.click(box);
    await user.paste(`https://www.youtube.com/watch?v=${NEW_VIDEO}`);
    expect(await screen.findByRole("option", { name: `Use this video: ${NEW_VIDEO}` })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    expect(getVideos).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(lastPush()).toBe(`/compare?a=${NEW_VIDEO}`);
  });

  it("says when nothing matches, and when a channel link is pasted in video mode", async () => {
    const user = userEvent.setup();
    open();
    const [box] = screen.getAllByRole("combobox");
    await user.type(box, "dinosaurs");
    // Shown under the field, and read out.
    expect(
      await screen.findAllByText("No videos in our dataset match “dinosaurs”. Paste a YouTube video link to check any video."),
    ).toHaveLength(2);

    await user.clear(box);
    await user.type(box, "youtube.com/@KitAndKate");
    expect(screen.getAllByText("That’s a channel link. Switch to Channels to compare channels.")).toHaveLength(2);
  });

  it("loads more suggestions as the list scrolls", async () => {
    vi.mocked(getVideos).mockImplementation(async ({ offset = 0, limit }) => ({
      items: Array.from({ length: Math.min(limit, 45 - offset) }, (_, i) =>
        ranked({ ...videos[VIDEO_B], id: `more${String(offset + i).padStart(7, "0")}`, title: `Walk ${offset + i}` }),
      ),
      total: 45,
      asOf: "2026-10-26T00:00:00Z",
    }));
    const user = userEvent.setup();
    open();
    await user.type(screen.getAllByRole("combobox")[0], "walk");
    const list = await screen.findByRole("listbox");
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(20));

    // Scrolled near the end: the next page is fetched and added.
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 336 },
      scrollTop: { configurable: true, value: 600 },
    });
    fireEvent.scroll(list);
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(40));
    // As of the first list's version, so rows don't shift while browsing (plan 013).
    expect(getVideos).toHaveBeenLastCalledWith({
      sort: "score",
      order: "desc",
      q: "walk",
      offset: 20,
      limit: 20,
      asOf: "2026-10-26T00:00:00Z",
    });
  });

  it("looks up a pasted channel link and offers the channel by its name", async () => {
    vi.mocked(lookupChannel).mockResolvedValue({ channelId: CHANNEL_B, name: "Quiet Lane", inDataset: true, videoCount: 2 });
    const user = userEvent.setup();
    open("view=channels");
    const [box] = screen.getAllByRole("combobox", { name: "Channel name or channel link" });
    await user.click(box);
    await user.paste("https://www.youtube.com/@QuietLane");
    expect(lookupChannel).toHaveBeenCalledWith("https://www.youtube.com/@QuietLane");
    const option = await screen.findByRole("option", { name: /Quiet Lane/ });
    expect(option).toHaveTextContent("Quiet Lane2 videos");
    expect(url.push).not.toHaveBeenCalled();
    await user.click(option);
    expect(lastPush()).toBe(`/compare?view=channels&a=${CHANNEL_B}`);
  });

  it("looks up a typed channel link only on Enter", async () => {
    vi.mocked(lookupChannel).mockResolvedValue({ channelId: CHANNEL_B, name: "Quiet Lane", inDataset: true, videoCount: 2 });
    const user = userEvent.setup();
    open("view=channels");
    const [box] = screen.getAllByRole("combobox");
    await user.type(box, `youtube.com/channel/${CHANNEL_B}`);
    expect(await screen.findAllByText("Press Enter to look up this channel.")).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 400));
    expect(lookupChannel).not.toHaveBeenCalled();
    expect(getChannels).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(lookupChannel).toHaveBeenCalledWith(`youtube.com/channel/${CHANNEL_B}`);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(lastPush()).toBe(`/compare?view=channels&a=${CHANNEL_B}`));
  });

  it("doesn't take video links for channels", async () => {
    const user = userEvent.setup();
    open("view=channels");
    const [box] = screen.getAllByRole("combobox");
    await user.click(box);
    await user.paste(`https://youtu.be/${NEW_VIDEO}`);
    expect(
      await screen.findAllByText("That’s a video link. To compare channels, paste a channel’s link or type its name."),
    ).toHaveLength(2);
    expect(screen.queryByRole("option")).toBeNull();
    expect(lookupChannel).not.toHaveBeenCalled();
  });

  it("says when a linked channel isn't in our dataset, or the lookup is refused", async () => {
    vi.mocked(lookupChannel).mockResolvedValueOnce({
      channelId: "UCzzzzzzzzzzzzzzzzzzzzzz",
      name: "Faraway Friends",
      inDataset: false,
      videoCount: 0,
    });
    const user = userEvent.setup();
    open("view=channels");
    const [box] = screen.getAllByRole("combobox");
    await user.click(box);
    await user.paste("https://www.youtube.com/@FarawayFriends");
    expect(
      await screen.findByText(
        "Faraway Friends isn’t in our dataset yet. Checking a whole channel is coming soon. For now, pick a channel from our dataset.",
      ),
    ).toBeInTheDocument();
    expect(url.push).not.toHaveBeenCalled();

    vi.mocked(lookupChannel).mockRejectedValueOnce(new ApiError(429, "limit"));
    await user.clear(box);
    await user.paste("https://www.youtube.com/@Another");
    expect(await screen.findByText(/You’ve looked up or checked several new videos and channels/)).toBeInTheDocument();
  });

  it("compares two videos: summary, the biggest difference in words, and every measurement", async () => {
    open(`a=${VIDEO_A}&b=${VIDEO_B}`);
    const summary = await screen.findByText(/is more stimulating overall/);
    // The badge's letter is hidden from screen readers, which hear the title instead.
    expect(summary).toHaveTextContent("ATurbo Trucks is more stimulating overall: 82 vs 41.");

    // Only differences of 20+ points make a headline: here just one.
    const headlines = within(document.querySelector("[data-headlines]") as HTMLElement).getAllByRole("listitem");
    expect(headlines).toHaveLength(1);
    expect(headlines[0]).toHaveTextContent("ATurbo Trucks cuts to a new shot more often: 88 vs 35.");

    // Overall and Pacing in one table, the other two groups in the other.
    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(2);
    expect(within(tables[0]).getAllByRole("rowheader").map((h) => h.textContent)).toContain("Overall");
    const cuts = document.querySelector('[data-row="cuts_per_min"]') as HTMLElement;
    expect([...cuts.querySelectorAll("[data-filled]")].map((c) => c.textContent)).toEqual(["88", "35"]);
    // The headline's row is highlighted, and only that one.
    expect([...document.querySelectorAll("[data-highlight]")].map((r) => r.getAttribute("data-row"))).toEqual([
      "cuts_per_min",
    ]);
    expect(screen.getByText("vs.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Garden Walk" })).toHaveAttribute("href", `/video?id=${VIDEO_B}`);
    // The title is set in an effect, which can run just after the text shows.
    await waitFor(() => expect(document.title).toBe("Turbo Trucks vs Garden Walk - HyperStim?"));
    expect(screen.queryByRole("link", { name: /Browse the rankings/ })).toBeNull();
  });

  it("opens a measurement's info popup from its row header, not the row (Safari ignores `relative` on a row)", async () => {
    open(`a=${VIDEO_A}&b=${VIDEO_B}`);
    const cuts = (await screen.findAllByRole("button", { name: /^About / })).find((b) =>
      b.closest('[data-row="cuts_per_min"]'),
    )!;
    expect(cuts.closest("th")).toHaveClass("relative");
    expect(document.querySelector("tr.relative")).toBeNull();
  });

  it("empties a slot with × and puts focus in its picker", async () => {
    const user = userEvent.setup();
    open(`a=${VIDEO_A}&b=${VIDEO_B}`);
    await user.click(await screen.findByRole("button", { name: "Remove video B" }));
    expect(lastPush()).toBe(`/compare?a=${VIDEO_A}`);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveFocus());
  });

  it("checks a video outside the dataset live, inside its slot", async () => {
    open(`a=${VIDEO_A}&b=${NEW_VIDEO}`);
    expect(await screen.findByText("Checking this video…")).toBeInTheDocument();
    expect(startAnalysis).toHaveBeenCalledWith(NEW_VIDEO);
    const slot = screen.getByRole("region", { name: "Video B" });
    await waitFor(() => expect(within(slot).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30"));
    // No comparison until both are scored; A stays usable.
    expect(screen.queryByText(/more stimulating/)).toBeNull();
    expect(screen.getByText("Turbo Trucks")).toBeInTheDocument();
  });

  it("says when a slot's ID can't be found, or fails to load", async () => {
    vi.mocked(getChannel).mockRejectedValueOnce(new ApiError(500, "boom"));
    open(`view=channels&a=${CHANNEL_A}&b=not-a-channel`);
    expect(await screen.findByText("We couldn’t find this channel.")).toBeInTheDocument();
    expect(await screen.findByText("We couldn’t load this channel.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Remove channel/ })).toHaveLength(2);
  });

  it("compares two channels, with both over the years on one chart", async () => {
    open(`view=channels&a=${CHANNEL_A}&b=${CHANNEL_B}`);
    const summary = await screen.findByText(/as stimulating as each other/);
    expect(summary).toHaveTextContent("AZoom Kids and BQuiet Lane’s videos are about as stimulating as each other: 80 vs 78.");
    expect(screen.getByText("Their 12 measurements are all within 20 points of each other.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Quiet Lane" })).toHaveAttribute("href", `/channel?id=${CHANNEL_B}`);
    expect(screen.getByRole("heading", { name: "Over the years" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /videos over the years/ });
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 5);
    expect(document.querySelectorAll('[data-dot="a"]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-dot="b"]')).toHaveLength(2);
    expect(document.querySelector('[data-trend="a"]')).toBeInTheDocument();
    // Two videos are too few for a trend.
    expect(document.querySelector('[data-trend="b"]')).toBeNull();
  });

  it("opens a clicked dot's video in the panel under the chart, from sm", async () => {
    const user = userEvent.setup();
    open(`view=channels&a=${CHANNEL_A}&b=${CHANNEL_B}`);
    await screen.findByRole("heading", { name: "Over the years" });
    await user.click(document.querySelector('[data-hit="b-qa"]')!);
    const panel = screen.getByRole("region", { name: "Video qa" });
    expect(within(panel).getByText("Quiet Lane")).toBeInTheDocument();
    expect(url.push).not.toHaveBeenCalled();
    // Its thumbnail under the chart is marked as the open one.
    expect(screen.getByRole("button", { name: /^B: Video qa/ })).toHaveAttribute("aria-current", "true");
    await user.click(within(panel).getByRole("button", { name: "Close video panel" }));
    expect(screen.queryByRole("region", { name: "Video qa" })).toBeNull();
  });

  it("shows a tapped dot's video in a card under the chart on phones, and stays on the page", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    const user = userEvent.setup();
    open(`view=channels&a=${CHANNEL_A}&b=${CHANNEL_B}`);
    await screen.findByRole("heading", { name: "Over the years" });
    // A tap: a touch pointer, then the click.
    const hit = document.querySelector('[data-hit="a-zb"]')!;
    fireEvent.pointerOver(hit, { pointerType: "touch" });
    fireEvent.click(hit);
    const card = screen.getByRole("region", { name: "Picked video" });
    expect(within(card).getByText("Zoom Kids")).toBeInTheDocument();
    expect(within(card).getByRole("link")).toHaveAttribute("href", expect.stringMatching(/^\/video\?id=/));
    expect(document.querySelector("[data-popover]")).toBeNull();
    expect(url.push).not.toHaveBeenCalled();
    await user.click(within(card).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Picked video" })).toBeNull();
  });

  it("fits the suggestions above the on-screen keyboard, moving a low field up first and keeping it in view", async () => {
    // A phone with the keyboard up: 373 px of a 664 px screen stay visible.
    const view = Object.assign(new EventTarget(), { offsetTop: 0, height: 373 });
    vi.stubGlobal("visualViewport", view);
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    let fieldTop = 400; // low on the screen, behind the keyboard
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("role") === "combobox") return { top: fieldTop, bottom: fieldTop + 48 } as DOMRect;
      if (this.getAttribute("role") === "listbox") return { top: fieldTop + 60 } as DOMRect;
      return { top: 0, bottom: 0 } as DOMRect;
    });
    const user = userEvent.setup();
    open();
    await user.type(screen.getAllByRole("combobox")[0], "r");
    const list = await screen.findByRole("listbox");
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(2));
    // The page moves the field to 16 px below the top of what's visible…
    expect(scrollBy).toHaveBeenCalledWith({ top: 400 - 16 });
    fieldTop = 16;
    fireEvent.scroll(window);
    // …and the list ends 20 px above the keyboard: 373 − (16 + 60) − 20.
    expect(list.style.maxHeight).toBe("min(21rem, 277px)");
    expect(scrollBy).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("has no accessibility violations with empty pickers and with suggestions open", async () => {
    const user = userEvent.setup();
    open();
    await expectNoAxeViolations();
    await user.type(screen.getAllByRole("combobox")[0], "r");
    const list = await screen.findByRole("listbox");
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(2));
    await expectNoAxeViolations();
  });

  it("has no accessibility violations comparing two videos", async () => {
    open(`a=${VIDEO_A}&b=${VIDEO_B}`);
    await screen.findByText(/is more stimulating overall/);
    await expectNoAxeViolations();
  });

  it("has no accessibility violations comparing two channels", async () => {
    open(`view=channels&a=${CHANNEL_A}&b=${CHANNEL_B}`);
    await screen.findByText(/as stimulating as each other/);
    await expectNoAxeViolations();
  });

  it("has no accessibility violations while checking a video, and on slot errors", async () => {
    const { unmount } = open(`a=${VIDEO_A}&b=${NEW_VIDEO}`);
    await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30"));
    await expectNoAxeViolations();
    unmount();

    vi.mocked(getChannel).mockRejectedValueOnce(new ApiError(500, "boom"));
    open(`view=channels&a=${CHANNEL_A}&b=not-a-channel`);
    await screen.findByText("We couldn’t find this channel.");
    await screen.findByText("We couldn’t load this channel.");
    await expectNoAxeViolations();
  });
});
