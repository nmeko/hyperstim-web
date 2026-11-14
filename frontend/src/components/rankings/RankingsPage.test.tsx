import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getChannels,
  getMeta,
  getVideos,
  lookupChannel,
  type ListParams,
  type RankedChannel,
  type RankedVideo,
} from "@/lib/api";
import { FEATURE_GROUPS } from "@/lib/features";
import { expectNoAxeViolations } from "@/test/axe";
import RankingsPage from "./RankingsPage";

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
    replace: vi.fn(navigate),
  };
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => useSyncExternalStore(url.subscribe, () => url.search),
  useRouter: () => ({ push: url.push, replace: url.replace }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getVideos: vi.fn(),
  getChannels: vi.fn(),
  lookupChannel: vi.fn(),
  getMeta: vi.fn(),
}));

const KEYS = FEATURE_GROUPS.flatMap((g) => g.keys);

function video(n: number): RankedVideo {
  return {
    id: `video${String(n).padStart(6, "0")}`,
    title: `Tiny Trucks ${n}`,
    channelId: `UCchan${n}`,
    channel: `Channel ${n}`,
    category: "music",
    rank: n,
    score: Math.max(0, 100 - n),
    features: KEYS.map((key) =>
      key === "lstar_flash_per_min" && n === 2
        ? { key, value: 0, percentile: 0 } // a count of 0
        : { key, value: 1.5, percentile: 50 },
    ),
  };
}

const channel = (n: number): RankedChannel => ({
  id: `UCchan${n}`,
  name: `Channel ${n}`,
  videoCount: 12,
  rank: n,
  score: 80 - n,
  features: KEYS.map((key) => ({ key, value: 1, percentile: 40 })),
});

/** A ranking of `total` items, sliced by `offset`/`limit` as the API does. */
function list<T>(make: (n: number) => T, total: number) {
  return async ({ offset = 0, limit }: ListParams) => ({
    items: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => make(offset + i + 1)),
    total,
    asOf: "2026-10-26T00:00:00Z",
  });
}

// The table and the cards (and chips and select) are both rendered; CSS shows one by width,
// which jsdom doesn't apply, so tests look inside the one they mean.
const table = () => screen.getByRole("table");
const cards = () => screen.getByRole("list", { name: /ranked by/ });
const busy = (element: HTMLElement) => element.closest("[aria-busy]");
/** The order button on the category row (`lg`+), or the one next to "Rank by" (below). */
const orderButton = (where: "wide" | "narrow") =>
  screen.getAllByRole("button", { name: /^Order:/ }).find((b) => b.classList.contains("lg:flex") === (where === "wide"))!;

function open(query = "") {
  url.navigate(`/rankings?${query}`);
  return render(<RankingsPage />);
}

const lastCall = <T,>(fn: { mock: { calls: T[][] } }) => fn.mock.calls.at(-1)?.[0];

beforeEach(() => {
  url.push.mockClear();
  url.replace.mockClear();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduced-motion"), media: query }));
  vi.mocked(getVideos).mockReset().mockImplementation(list(video, 60));
  vi.mocked(getChannels).mockReset().mockImplementation(list(channel, 30));
  vi.mocked(lookupChannel).mockReset();
  vi.mocked(getMeta).mockReset().mockResolvedValue({
    videoCount: 16402,
    channelCount: 542,
    updatedAt: "2026-10-26",
    addedLast7Days: 1043,
    channelCount7DaysAgo: 540,
    lastAddedAt: "2026-10-26T10:00:00Z",
    referenceCount: 16375,
    channelsCheckedAt: null,
  });
});

describe("RankingsPage", () => {
  it("has no growing count; the results line is the count", async () => {
    open();
    expect(await screen.findByText(/^Showing 1–25 of 60 videos$/)).toBeInTheDocument();
    expect(screen.queryByTestId("rolling-number")).not.toBeInTheDocument();
    expect(getMeta).not.toHaveBeenCalled();
  });

  it("lists every channel, however few videos it has, so the count matches the home page's", async () => {
    open("view=channels");
    expect(await screen.findByText("Showing 1–25 of 30 channels")).toBeInTheDocument();
    expect(getChannels).toHaveBeenCalledWith(expect.not.objectContaining({ minVideos: expect.anything() }));
  });

  it("shows a channel without a name by its ID, labeled so it doesn't read as a name", async () => {
    vi.mocked(getChannels).mockImplementation(list((n) => (n === 2 ? { ...channel(n), name: "" } : channel(n)), 3));
    open("view=channels");
    const link = await within(await screen.findByRole("table")).findByRole("link", { name: "Channel ID UCchan2" });
    expect(link).toHaveAttribute("href", "/channel?id=UCchan2");
    await expectNoAxeViolations();
  });

  it("asks for the dataset as it was at the first list, so rows don't shift while browsing", async () => {
    const versions = ["2026-10-26T10:00:00Z", "2026-10-26T10:05:00Z"];
    vi.mocked(getVideos).mockImplementation(async (params) => ({
      ...(await list(video, 60)(params)),
      asOf: params.asOf ?? versions[vi.mocked(getVideos).mock.calls.length > 1 ? 1 : 0],
    }));
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");
    expect(lastCall(vi.mocked(getVideos))?.asOf).toBeUndefined();
    await user.click(within(screen.getByRole("navigation", { name: "Pages" })).getByRole("button", { name: "Next page" }));
    await screen.findByText("Showing 26–50 of 60 videos");
    expect(lastCall(vi.mocked(getVideos))).toMatchObject({ offset: 25, asOf: versions[0] });
    // Sorting, filtering and switching to channels keep it too.
    await user.click(screen.getByRole("button", { name: "Channels" }));
    await waitFor(() => expect(getChannels).toHaveBeenCalled());
    expect(lastCall(vi.mocked(getChannels))).toMatchObject({ asOf: versions[0] });
  });

  it("shows the first page of videos ranked by Overall", async () => {
    open();

    const table = await screen.findByRole("table", { name: "Videos, ranked by Overall, most stimulating first" });
    expect(getVideos).toHaveBeenLastCalledWith({
      sort: "score",
      order: "desc",
      category: "",
      q: "",
      offset: 0,
      limit: 25,
    });
    expect(screen.getByText("Showing 1–25 of 60 videos")).toBeInTheDocument();
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(2 + 25); // two header rows
    const first = rows[2];
    expect(within(first).getByRole("link", { name: "Tiny Trucks 1" })).toHaveAttribute("href", "/video?id=video000001");
    expect(within(first).getByRole("link", { name: "Channel 1" })).toHaveAttribute("href", "/channel?id=UCchan1");
    // Rank, name, Overall, then the 12.
    expect(within(first).getAllByRole("cell")).toHaveLength(15);
    expect(first.querySelectorAll("[data-filled]")[0]).toHaveTextContent("99");
    expect(first.querySelectorAll("[data-filled]")[0]).toHaveAttribute("data-filled", "5");
    expect(first.querySelectorAll("[data-filled]")[1]).toHaveAttribute("data-filled", "3");
    // A count of 0 is a 0 on the least stimulating tile.
    expect(rows[3].querySelectorAll("[data-filled]")[4]).toHaveTextContent("0");
    expect(screen.getByRole("columnheader", { name: "Overall" })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: "Pacing intensification" })).toBeInTheDocument();
  });

  it("opens a row's page from a click anywhere in it; the name's link covers its cell, not the row", async () => {
    const user = userEvent.setup();
    open();
    const table = await screen.findByRole("table", { name: "Videos, ranked by Overall, most stimulating first" });
    const name = within(table).getByRole("link", { name: "Tiny Trucks 2" });
    // Safari ignores `relative` on a row, so the link would cover the whole page's rows instead.
    expect(name.closest("td")).toHaveClass("relative");
    expect(table.querySelector("tr.relative")).toBeNull();

    url.push.mockClear();
    await user.click(within(name.closest("tr")!).getAllByRole("cell")[2]);
    expect(url.push).toHaveBeenCalledWith("/video?id=video000002");
  });

  it("ranks by a clicked column, and flips the order on a second click", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Rapid cutting" }));
    expect(lastCall(url.push)).toBe("/rankings?sort=cuts_per_min");
    expect(screen.getByRole("columnheader", { name: "Rapid cutting" })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: "Overall" })).not.toHaveAttribute("aria-sort");
    await waitFor(() => expect(lastCall(vi.mocked(getVideos))).toMatchObject({ sort: "cuts_per_min", order: "desc" }));

    await user.click(screen.getByRole("button", { name: "Rapid cutting" }));
    expect(lastCall(url.push)).toBe("/rankings?sort=cuts_per_min&order=asc");
    expect(screen.getByRole("columnheader", { name: "Rapid cutting" })).toHaveAttribute("aria-sort", "ascending");
    await waitFor(() => expect(lastCall(vi.mocked(getVideos))).toMatchObject({ sort: "cuts_per_min", order: "asc" }));
    expect(await screen.findByRole("table", { name: "Videos, ranked by Rapid cutting, least stimulating first" })).toBeInTheDocument();
  });

  it("counts back from the least stimulating end when least stimulating first: −1, −2, …", async () => {
    open("order=asc");
    await screen.findByRole("table");
    const rows = within(table()).getAllByRole("row");
    expect(within(rows[2]).getByText("−1")).toBeInTheDocument();
    expect(within(rows[2]).getByText("1st least stimulating")).toBeInTheDocument();
    expect(within(rows[12]).getByText("11th least stimulating")).toBeInTheDocument();
    expect(within(rows[23]).getByText("22nd least stimulating")).toBeInTheDocument();
    expect(within(cards()).getByText("−3")).toBeInTheDocument();
  });

  it("flips the order with the order button next to the category chips", async () => {
    const user = userEvent.setup();
    open("sort=lufs");
    await screen.findByRole("table");

    expect(orderButton("wide")).toHaveAccessibleName("Order: Most stimulating first");
    await user.click(orderButton("wide"));
    expect(lastCall(url.push)).toBe("/rankings?sort=lufs&order=asc");
    expect(screen.getByRole("columnheader", { name: "Audio intensity" })).toHaveAttribute("aria-sort", "ascending");

    expect(orderButton("wide")).toHaveAccessibleName("Order: Least stimulating first");
    await user.click(orderButton("wide"));
    expect(lastCall(url.push)).toBe("/rankings?sort=lufs");
  });

  it("keeps least stimulating first when ranking by another column", async () => {
    const user = userEvent.setup();
    open("order=asc");
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Rapid cutting" }));
    expect(lastCall(url.push)).toBe("/rankings?sort=cuts_per_min&order=asc");
    expect(screen.getByRole("columnheader", { name: "Rapid cutting" })).toHaveAttribute("aria-sort", "ascending");

    await user.selectOptions(screen.getByRole("combobox", { name: "Rank by" }), "lufs");
    expect(lastCall(url.push)).toBe("/rankings?sort=lufs&order=asc");
  });

  it("shows a dash for rows without a rank", async () => {
    vi.mocked(getVideos).mockImplementation(async () => ({ items: [{ ...video(1), rank: null }], total: 1, asOf: "2026-10-26T00:00:00Z" }));
    open();

    await screen.findByRole("table");
    expect(within(table()).getByText("Not ranked")).toBeInTheDocument();
    expect(within(cards()).getByText("Not ranked")).toBeInTheDocument();
  });

  it("switches to channels, keeping search, category and criterion, back to page 1", async () => {
    const user = userEvent.setup();
    open("q=zip&category=music&sort=lufs&page=2");
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Channels" }));

    expect(lastCall(url.push)).toBe("/rankings?view=channels&sort=lufs&q=category%3Amusic+zip");
    await screen.findByRole("table", { name: "Channels, ranked by Audio intensity, most stimulating first" });
    expect(getChannels).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "lufs", category: "music", q: "zip", offset: 0 }),
    );
    expect(within(table()).getByRole("link", { name: "Channel 1" })).toHaveAttribute("href", "/channel?id=UCchan1");
    expect(within(table()).getAllByText("12 videos")).toHaveLength(25);
    expect(
      screen.getByText("Showing 1–25 of 30 channels with music videos matching “zip”"),
    ).toBeInTheDocument();
  });

  it("searches after a pause in typing, replacing the history entry", async () => {
    const user = userEvent.setup();
    open("page=2");
    await screen.findByRole("table");

    await user.type(screen.getByRole("searchbox", { name: "Search videos" }), "zippy ");
    expect(url.replace).not.toHaveBeenCalled();

    await waitFor(() => expect(url.replace).toHaveBeenCalledTimes(1));
    expect(lastCall(url.replace)).toBe("/rankings?q=zippy");
    expect(url.push).not.toHaveBeenCalled();
    // The trailing space the user typed stays in the field.
    expect(screen.getByRole("searchbox")).toHaveValue("zippy ");
    await waitFor(() => expect(lastCall(vi.mocked(getVideos))).toMatchObject({ q: "zippy", offset: 0 }));
  });

  it("keeps letters typed while the URL catches up with the search", async () => {
    const user = userEvent.setup();
    // A slow navigation: the URL changes 400 ms after the search is sent.
    url.replace.mockImplementation((href: string) => void setTimeout(() => url.navigate(href), 400));
    open();
    await screen.findByRole("table");
    const box = screen.getByRole("searchbox");

    await user.type(box, "zip");
    await waitFor(() => expect(url.replace).toHaveBeenCalledTimes(1)); // "zip" sent
    await user.type(box, "py"); // typed before the URL has "zip"
    await waitFor(() => expect(url.search.get("q")).toBe("zip"));
    expect(box).toHaveValue("zippy");

    await waitFor(() => expect(url.search.get("q")).toBe("zippy"), { timeout: 2000 });
    expect(box).toHaveValue("zippy");
    url.replace.mockImplementation(url.navigate);
  });

  it("follows the URL when it changes from outside (Back)", async () => {
    open("q=zippy");
    await screen.findByRole("table");
    expect(screen.getByRole("searchbox")).toHaveValue("zippy");

    act(() => url.navigate("/rankings"));

    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("filters by category with chips, and with a select on phones", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Play & activity" }));
    expect(lastCall(url.push)).toBe("/rankings?q=category%3Aplay");
    expect(screen.getByRole("button", { name: "Play & activity" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText(/of 60 play & activity videos/)).toBeInTheDocument();
  });

  describe("search filters", () => {
    it("puts a picked category into the search box, highlighted", async () => {
      const user = userEvent.setup();
      open("q=peppa");
      await screen.findByRole("table");
      await user.click(screen.getByRole("button", { name: "Music" }));
      expect(lastCall(url.push)).toBe("/rankings?q=category%3Amusic+peppa");
      url.navigate("/rankings?q=category%3Amusic+peppa");
      await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue("category:music peppa"));
      expect(document.querySelector("mark")).toHaveTextContent("category:music");
    });

    it("adds a picked category after the filters already there, and changes it in place", async () => {
      const user = userEvent.setup();
      open("q=added%3A%3E2026-10-19"); // as the home page's pill links
      await screen.findByRole("table");
      await user.click(screen.getByRole("button", { name: "Music" }));
      expect(lastCall(url.push)).toBe("/rankings?q=added%3A%3E2026-10-19+category%3Amusic");
      url.navigate(lastCall(url.push)!);
      await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue("added:>2026-10-19 category:music"));
      await user.click(screen.getByRole("button", { name: "Gaming" }));
      expect(lastCall(url.push)).toBe("/rankings?q=added%3A%3E2026-10-19+category%3Agaming");
      await user.click(screen.getByRole("button", { name: "All" }));
      expect(lastCall(url.push)).toBe("/rankings?q=added%3A%3E2026-10-19");
    });

    it("picks the chip and filters by date when typed", async () => {
      const user = userEvent.setup();
      open();
      await screen.findByRole("table");
      await user.type(screen.getByRole("searchbox"), "category:gaming added:>2026-10-19 zip");
      // A slow keystroke can send part of the text first.
      await waitFor(() => expect(lastCall(url.replace)).toBe("/rankings?q=category%3Agaming+added%3A%3E2026-10-19+zip"));
      url.navigate(lastCall(url.replace)!);
      await waitFor(() =>
        expect(lastCall(vi.mocked(getVideos))).toMatchObject({
          q: "zip",
          category: "gaming",
          addedFrom: new Date(2026, 9, 20).toISOString().replace(".000Z", "Z"),
        }),
      );
      expect(screen.getByRole("button", { name: "Gaming" })).toHaveAttribute("aria-pressed", "true");
      expect(await screen.findByText(/of 60 gaming videos added after October 19(, 2026)? matching “zip”/)).toBeInTheDocument();
      expect(document.querySelectorAll("mark")).toHaveLength(2);
    });

    it("says what's wrong with a filter instead of searching", async () => {
      const user = userEvent.setup();
      open();
      await screen.findByRole("table");
      await user.type(screen.getByRole("searchbox"), "added:yesterday");
      expect(await screen.findByText(/“added:yesterday” isn’t a date filter/)).toBeInTheDocument();
      expect(url.replace).not.toHaveBeenCalled();
      expect(document.querySelector("mark")).toBeNull();
    });

    it("says when nothing was added in the window", async () => {
      vi.mocked(getVideos).mockResolvedValue({ items: [], total: 0, asOf: "2026-10-26T00:00:00Z" });
      open("q=added%3A2026-10-20");
      expect(await screen.findByText(/^No videos added on October 20(, 2026)?\.$/)).toBeInTheDocument();
    });

    it("explains the filters next to the box", () => {
      open();
      expect(screen.getByRole("button", { name: "How to search" })).toBeInTheDocument();
    });
  });

  it("uses a category select below sm", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("list", { name: /Videos, ranked by/ });

    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "gaming");

    expect(lastCall(url.push)).toBe("/rankings?q=category%3Agaming");
  });

  it("pages through the results and moves focus to the results line", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");
    const pages = screen.getByRole("navigation", { name: "Pages" });
    expect(within(pages).getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    expect(within(pages).getByRole("button", { name: "Previous page" })).toBeDisabled();

    await user.click(within(pages).getByRole("button", { name: "Next page" }));

    expect(lastCall(url.push)).toBe("/rankings?page=2");
    const line = await screen.findByText("Showing 26–50 of 60 videos");
    await waitFor(() => expect(line).toHaveFocus());
    expect(lastCall(vi.mocked(getVideos))).toMatchObject({ offset: 25, limit: 25 });
    expect(within(table()).getByRole("link", { name: "Tiny Trucks 26" })).toBeInTheDocument();
  });

  it("keeps the current rows, busy, while the next page loads", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table");
    vi.mocked(getVideos).mockReturnValue(new Promise(() => {}));

    await user.click(screen.getByRole("button", { name: "Page 2" }));

    expect(within(table()).getByRole("link", { name: "Tiny Trucks 1" })).toBeInTheDocument();
    expect(busy(table())).toHaveAttribute("aria-busy", "true");
  });

  it("goes to the last page from a link past the end", async () => {
    open("page=9");

    await waitFor(() => expect(lastCall(url.replace)).toBe("/rankings?page=3"));
    expect(await screen.findByText(/Showing 51–60 of 60 videos/)).toBeInTheDocument();
  });

  it("shows cards below lg, ranked with a select and the order button", async () => {
    const user = userEvent.setup();
    open("sort=cuts_per_min");

    const list = await screen.findByRole("list", { name: "Videos, ranked by Rapid cutting, most stimulating first" });
    const first = within(list).getAllByRole("listitem")[0];
    expect(within(first).getByText("Overall")).toBeInTheDocument();
    expect(within(first).getByText("Rapid cutting")).toBeInTheDocument();
    expect(first.querySelectorAll("[data-filled]")).toHaveLength(2);

    await user.selectOptions(screen.getByRole("combobox", { name: "Rank by" }), "overall");
    expect(lastCall(url.push)).toBe("/rankings");

    await user.click(orderButton("narrow"));
    expect(lastCall(url.push)).toBe("/rankings?order=asc");
    expect(orderButton("narrow")).toHaveTextContent("Least stimulating first");
  });

  it("shows a message with a clear button when nothing matches", async () => {
    const user = userEvent.setup();
    vi.mocked(getVideos).mockResolvedValue({ items: [], total: 0, asOf: "2026-10-26T00:00:00Z" });
    open("q=xyz&category=gaming");

    expect(await screen.findByText("No gaming videos match “xyz”.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();

    // The box holds the category filter too, so clearing it shows everything.
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(lastCall(url.push)).toBe("/rankings");
  });

  describe("links in the search", () => {
    const VIDEO_ID = "dQw4w9WgXcQ";
    const CHANNEL_ID = "UCbCmjCuTUZos6Inko4u57UQ";
    const nothing = { items: [], total: 0, asOf: "2026-10-26T00:00:00Z" };

    it("searches a pasted video link by its ID, and keeps the link in the field", async () => {
      const user = userEvent.setup();
      open();
      const box = screen.getByRole("searchbox", { name: "Search videos" });
      await user.click(box);
      await user.paste(`https://youtu.be/${VIDEO_ID}?si=abc`);
      await waitFor(() => expect(lastCall(url.replace)).toBe(`/rankings?q=${VIDEO_ID}`));
      expect(box).toHaveValue(`https://youtu.be/${VIDEO_ID}?si=abc`);
      // The results line doesn't repeat the ID.
      vi.mocked(getVideos).mockImplementation(list(video, 1));
      open(`q=${VIDEO_ID}`);
      expect(await screen.findByText("Showing 1–1 of 1 video for this link")).toBeInTheDocument();
    });

    it("says when a linked video isn't in our dataset, with a way to check it", async () => {
      vi.mocked(getVideos).mockResolvedValue(nothing);
      open(`q=${VIDEO_ID}`);
      expect(await screen.findByText(/This video isn’t in our dataset\./)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Check it/ })).toHaveAttribute("href", `/video?id=${VIDEO_ID}`);
    });

    it("searches a channel-ID link without a lookup", async () => {
      const user = userEvent.setup();
      open("view=channels");
      await user.type(screen.getByRole("searchbox", { name: "Search channels" }), `youtube.com/channel/${CHANNEL_ID}`);
      await waitFor(() => expect(lastCall(url.replace)).toBe(`/rankings?view=channels&q=${CHANNEL_ID}`));
      expect(lookupChannel).not.toHaveBeenCalled();
    });

    it("looks up a pasted handle link, and a typed one only on Enter", async () => {
      vi.mocked(lookupChannel).mockResolvedValue({ channelId: CHANNEL_ID, name: "Cocomelon", inDataset: true, videoCount: 40 });
      const user = userEvent.setup();
      open("view=channels");
      const box = screen.getByRole("searchbox");
      await user.click(box);
      await user.paste("https://www.youtube.com/@CoComelon");
      expect(lookupChannel).toHaveBeenCalledWith("https://www.youtube.com/@CoComelon");
      await waitFor(() => expect(lastCall(url.replace)).toBe(`/rankings?view=channels&q=${CHANNEL_ID}`));

      await user.clear(box);
      await user.type(box, "youtube.com/@Pinkfong");
      expect(await screen.findByText("Press Enter to look up this channel.")).toBeInTheDocument();
      expect(lookupChannel).toHaveBeenCalledTimes(1);
      await user.keyboard("{Enter}");
      expect(lookupChannel).toHaveBeenLastCalledWith("youtube.com/@Pinkfong");
    });

    it("says when a lookup is refused", async () => {
      vi.mocked(lookupChannel).mockRejectedValue(new ApiError(429, "limit"));
      const user = userEvent.setup();
      open("view=channels");
      await user.click(screen.getByRole("searchbox"));
      await user.paste("https://www.youtube.com/@CoComelon");
      expect(await screen.findByText(/You’ve looked up or checked several new videos and channels/)).toBeInTheDocument();
    });

    it("says when a linked channel isn't in the dataset", async () => {
      vi.mocked(getChannels).mockResolvedValue(nothing);
      vi.mocked(lookupChannel).mockResolvedValueOnce({ channelId: CHANNEL_ID, name: null, inDataset: false, videoCount: 0 });
      open(`view=channels&q=${CHANNEL_ID}`);
      expect(await screen.findByText("This channel isn’t in our dataset yet.")).toBeInTheDocument();
      expect(lookupChannel).toHaveBeenCalledWith(`https://www.youtube.com/channel/${CHANNEL_ID}`);
    });

    it("says when a link is the wrong kind, and Clear search empties the field", async () => {
      const user = userEvent.setup();
      open();
      const box = screen.getByRole("searchbox");
      await user.click(box);
      await user.paste("https://www.youtube.com/@CoComelon");
      expect(await screen.findByText("That’s a channel link. Switch to Channels to find a channel.")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(lookupChannel).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Clear search" }));
      expect(box).toHaveValue("");
      expect(await screen.findByRole("table")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Channels" }));
      await user.click(box);
      await user.paste(`https://youtu.be/${VIDEO_ID}`);
      expect(
        await screen.findByText("That’s a video link. To find a channel, paste a channel’s link or type its name."),
      ).toBeInTheDocument();
    });
  });

  it("shows a busy skeleton while loading", () => {
    vi.mocked(getVideos).mockReturnValue(new Promise(() => {}));
    open();

    expect(screen.getByRole("status")).toHaveTextContent("Loading rankings…");
    expect(busy(table())).toHaveAttribute("aria-busy", "true");
  });

  it("shows an error with a retry", async () => {
    const user = userEvent.setup();
    vi.mocked(getVideos).mockRejectedValueOnce(new Error("down"));
    open();

    expect(await screen.findByText("We couldn’t load the rankings.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("table");
    expect(within(table()).getByRole("link", { name: "Tiny Trucks 1" })).toBeInTheDocument();
  });

  it("lets CSS pick the layout by width, so the first paint already fits", async () => {
    open();
    await screen.findByRole("table");
    // Table from lg, cards below; chips from sm, a select below; "Rank by" only below lg.
    expect(table().parentElement).toHaveClass("hidden", "lg:block");
    expect(cards().parentElement).toHaveClass("lg:hidden");
    expect(screen.getByRole("group", { name: "Category" }).parentElement).toHaveClass("hidden", "sm:flex");
    expect(screen.getByRole("combobox", { name: "Category" }).closest("label")).toHaveClass("sm:hidden");
    expect(orderButton("narrow").parentElement).toHaveClass("lg:hidden");
    expect(orderButton("wide")).toHaveClass("hidden", "lg:flex");
  });

  it.each(["", "view=channels"])("has no accessibility violations: %j", async (query) => {
    open(query);
    await screen.findByText(/^Showing 1–25 of/);
    await expectNoAxeViolations();
  });

  it("has no accessibility violations when nothing matches, or on an error", async () => {
    vi.mocked(getVideos).mockResolvedValueOnce({ items: [], total: 0, asOf: "2026-10-26T00:00:00Z" });
    const { unmount } = open("q=xyz");
    await screen.findByText("No videos match “xyz”.");
    await expectNoAxeViolations();
    unmount();

    vi.mocked(getVideos).mockRejectedValueOnce(new Error("down"));
    open();
    await screen.findByText("We couldn’t load the rankings.");
    await expectNoAxeViolations();
  });
});
