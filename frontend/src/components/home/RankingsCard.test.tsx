import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getChannels, getVideos, type RankedChannel, type RankedVideo } from "@/lib/api";
import { expectNoAxeViolations } from "@/test/axe";
import RankingsCard, { joinEnds } from "./RankingsCard";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/lib/api", () => ({
  getVideos: vi.fn(),
  getChannels: vi.fn(),
}));

const video = (n: number, score: number): RankedVideo => ({
  id: `video${String(n).padStart(6, "0")}`,
  title: `Video ${n}`,
  channelId: `chan${n}`,
  channel: `Channel of ${n}`,
  category: "music",
  rank: n,
  score,
  features: [],
});

// 120 videos in the dataset; the API returns the 3 at each end.
const videosDesc = { items: [video(1, 96.6), video(2, 90.1), video(3, 85.4)], total: 120, asOf: "2026-10-26T00:00:00Z" };
const videosAsc = { items: [video(120, 3.2), video(119, 5.5), video(118, 7.9)], total: 120, asOf: "2026-10-26T00:00:00Z" };

const channel = (name: string, score: number): RankedChannel => ({
  id: `id-${name}`,
  name,
  score,
  videoCount: 12,
  rank: null,
  features: [],
});
const channelsDesc = { items: [channel("Loud", 88), channel("Busy", 80), channel("Zippy", 75)], total: 40, asOf: "2026-10-26T00:00:00Z" };
const channelsAsc = { items: [channel("Calm", 9), channel("Slow", 12), channel("Soft", 15)], total: 40, asOf: "2026-10-26T00:00:00Z" };

beforeEach(() => {
  push.mockReset();
  vi.mocked(getVideos)
    .mockReset()
    .mockImplementation(async ({ order }) => (order === "desc" ? videosDesc : videosAsc));
  vi.mocked(getChannels)
    .mockReset()
    .mockImplementation(async ({ order }) => (order === "desc" ? channelsDesc : channelsAsc));
});

// First cell of every body row (as read by screen readers too), including the gap row.
const rankCells = (table: HTMLElement) =>
  Array.from(table.querySelectorAll("tbody tr"), (row) => row.querySelector("td")?.textContent);

// The table shows while loading too (busy, with empty rows), so wait for the data.
async function loadedTable(name: string | RegExp) {
  const table = await screen.findByRole("table", { name });
  await waitFor(() => expect(table).toHaveAttribute("aria-busy", "false"));
  return table;
}

describe("RankingsCard", () => {
  it("shows the 3 most and 3 least stimulating videos in one table", async () => {
    render(<RankingsCard />);

    const table = await loadedTable("The 3 most and 3 least stimulating videos");
    expect(rankCells(table)).toEqual([
      "1",
      "2",
      "3",
      "Least stimulating",
      "−33rd least stimulating",
      "−22nd least stimulating",
      "−1least stimulating",
    ]);
    expect(within(table).getByRole("link", { name: "Video 1" })).toHaveAttribute(
      "href",
      "/video?id=video000001",
    );
    expect(within(table).getByRole("link", { name: "Channel of 1" })).toHaveAttribute("href", "/channel?id=chan1");
    expect(within(table).getByText("97")).toBeInTheDocument();
    const meters = table.querySelectorAll("[data-filled]");
    expect(Array.from(meters, (m) => m.getAttribute("data-filled"))).toEqual(["5", "5", "5", "1", "1", "1"]);
    expect(within(table).getByRole("link", { name: "Video 120" })).toBeInTheDocument();
  });

  it("shows the gap as a quiet divider that isn't a row to click", async () => {
    const user = userEvent.setup();
    render(<RankingsCard />);
    const table = await loadedTable(/videos/);
    const gap = within(table).getByText("Least stimulating").closest("tr")!;
    expect(within(gap).queryByRole("link")).toBeNull();
    // No row lines around it: neither its own nor the one of the row above.
    expect(gap).not.toHaveClass("border-b");
    expect(gap.previousElementSibling).not.toHaveClass("border-b");

    await user.click(within(gap).getByRole("cell"));
    expect(push).not.toHaveBeenCalled();
  });

  it("opens a row's page from a click anywhere in it; the name's link covers its cell, not the row", async () => {
    const user = userEvent.setup();
    render(<RankingsCard />);
    const table = await loadedTable(/videos/);
    const name = within(table).getByRole("link", { name: "Video 120" });
    // Safari ignores `relative` on a row, so the link would cover the whole card instead.
    expect(name.closest("td")).toHaveClass("relative");
    expect(table.querySelector("tr.relative")).toBeNull();

    const row = name.closest("tr")!;
    await user.click(within(row).getAllByRole("cell")[0]);
    expect(push).toHaveBeenCalledWith("/video?id=video000120");
  });

  it("switches to channels", async () => {
    const user = userEvent.setup();
    render(<RankingsCard />);
    await loadedTable(/videos/);
    expect(screen.getByRole("button", { name: "Videos" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Channels" }));

    const table = await loadedTable("The 3 most and 3 least stimulating channels");
    expect(rankCells(table).slice(3)).toEqual([
      "Least stimulating",
      "−33rd least stimulating",
      "−22nd least stimulating",
      "−1least stimulating",
    ]);
    expect(within(table).getByText("Loud")).toBeInTheDocument();
    expect(within(table).getAllByText("12 videos")).toHaveLength(6);
    expect(within(table).getByRole("link", { name: "Loud" })).toHaveAttribute("href", "/channel?id=id-Loud");
    expect(within(table).getAllByRole("link")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Channels" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Videos" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("link", { name: /See full rankings/ })).toHaveAttribute("href", "/rankings?view=channels");
  });

  it("ranks every channel, as the rankings page does, however few videos it has", async () => {
    vi.mocked(getChannels).mockImplementation(async ({ order }) =>
      order === "desc"
        ? { ...channelsDesc, items: [{ ...channel("Tiny", 99), videoCount: 1 }, ...channelsDesc.items.slice(1)] }
        : channelsAsc,
    );
    const user = userEvent.setup();
    render(<RankingsCard />);
    await loadedTable(/videos/);
    await user.click(screen.getByRole("button", { name: "Channels" }));
    const table = await loadedTable("The 3 most and 3 least stimulating channels");
    expect(within(table).getByText("1 video")).toBeInTheDocument();
    for (const [params] of vi.mocked(getChannels).mock.calls)
      expect(params).not.toHaveProperty("minVideos");
  });

  it("explains the score in an info popup next to the Score header", async () => {
    const user = userEvent.setup();
    render(<RankingsCard />);
    const text = await screen.findByText(/Videos with higher scores are more stimulating/);

    expect(text).not.toBeVisible();
    await user.hover(screen.getByRole("button", { name: "About the score" }));
    expect(text).toBeVisible();
  });

  it("shows plain ranks and no gap row when both ends meet", async () => {
    const v = [1, 2, 3, 4].map((n) => video(n, 100 - n * 10));
    vi.mocked(getVideos).mockImplementation(async ({ order }) =>
      order === "desc" ? { items: v.slice(0, 3), total: 4, asOf: "2026-10-26T00:00:00Z" } : { items: [v[3], v[2], v[1]], total: 4, asOf: "2026-10-26T00:00:00Z" },
    );
    render(<RankingsCard />);

    expect(rankCells(await loadedTable(/videos/))).toEqual(["1", "2", "3", "4"]);
  });

  it("shows a busy table with loading text while loading", () => {
    vi.mocked(getVideos).mockReturnValue(new Promise(() => {}));
    render(<RankingsCard />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading rankings…");
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
    expect(rankCells(screen.getByRole("table"))).toHaveLength(7); // 3 + gap + 3
  });

  it("shows an error with a retry that reloads", async () => {
    const user = userEvent.setup();
    vi.mocked(getVideos).mockRejectedValueOnce(new Error("down"));
    render(<RankingsCard />);

    expect(await screen.findByText("We couldn’t load the rankings.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("link", { name: "Video 1" })).toBeInTheDocument();
  });

  it("shows a message when there are no rankings", async () => {
    vi.mocked(getVideos).mockResolvedValue({ items: [], total: 0, asOf: "2026-10-26T00:00:00Z" });
    render(<RankingsCard />);

    expect(await screen.findByText("No rankings yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("has no accessibility violations, for videos and channels", async () => {
    const user = userEvent.setup();
    render(<RankingsCard />);
    await screen.findByRole("link", { name: "Video 1" });
    await expectNoAxeViolations();
    await user.click(screen.getByRole("button", { name: "Channels" }));
    await screen.findByRole("link", { name: "Loud" });
    await expectNoAxeViolations();
  });

  it("has no accessibility violations while loading or on an error", async () => {
    vi.mocked(getVideos).mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = render(<RankingsCard />);
    await expectNoAxeViolations();
    unmount();

    vi.mocked(getVideos).mockRejectedValueOnce(new Error("down"));
    render(<RankingsCard />);
    await screen.findByText("We couldn’t load the rankings.");
    await expectNoAxeViolations();
  });
});

describe("joinEnds", () => {
  const toRow = (v: RankedVideo, rank: number) => ({
    key: v.id,
    rank,
    name: v.title,
    detail: "",
    score: v.score,
    href: "",
  });
  const ranks = (top: RankedVideo[], bottom: RankedVideo[], total: number) =>
    joinEnds({ items: top, total, asOf: "2026-10-26T00:00:00Z" }, { items: bottom, total, asOf: "2026-10-26T00:00:00Z" }, toRow).map((r) => r.rank);

  it("drops items from the bottom that are already in the top", () => {
    const [a, b, c, d] = [video(1, 90), video(2, 80), video(3, 70), video(4, 60)];
    expect(ranks([a, b, c], [d, c, b], 4)).toEqual([1, 2, 3, 4]);
    expect(ranks([a, b], [b, a], 2)).toEqual([1, 2]);
  });

  it("keeps all 6 when the ends just meet", () => {
    const v = [1, 2, 3, 4, 5, 6].map((n) => video(n, 100 - n));
    expect(ranks(v.slice(0, 3), [v[5], v[4], v[3]], 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
