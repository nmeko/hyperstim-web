import { describe, expect, it } from "vitest";
import { localMidnight, parseSearch, pastWeek, withCategory } from "./search-filters";

const NOW = new Date(2026, 9, 26, 15, 30); // October 26, 2026, in the test's time zone

describe("parseSearch", () => {
  it("splits filters from the search words", () => {
    const parsed = parseSearch("peppa category:Music added:>2026-10-19 pig", NOW);
    expect(parsed).toMatchObject({
      words: "peppa pig",
      category: "music",
      added: { from: localMidnight(2026, 10, 20) },
      addedText: "added after October 19",
      error: null,
    });
    expect(parsed.tokens.map(({ start, end }) => "peppa category:Music added:>2026-10-19 pig".slice(start, end))).toEqual([
      "category:Music",
      "added:>2026-10-19",
    ]);
  });

  it.each([
    ["added:2026-10-20", { from: localMidnight(2026, 10, 20), before: localMidnight(2026, 10, 21) }, "added on October 20"],
    ["added:>=2026-10-20", { from: localMidnight(2026, 10, 20) }, "added on or after October 20"],
    ["added:<2026-10-20", { before: localMidnight(2026, 10, 20) }, "added before October 20"],
    ["added:<=2025-12-31", { before: localMidnight(2026, 1, 1) }, "added on or before December 31, 2025"],
  ])("reads %s", (text, added, words) => {
    expect(parseSearch(text, NOW)).toMatchObject({ added, addedText: words, words: "" });
  });

  it("keeps the narrowest window when there are several date filters", () => {
    const parsed = parseSearch("added:>2026-10-01 added:<2026-10-20 added:>2026-10-05", NOW);
    expect(parsed.added).toEqual({ from: localMidnight(2026, 10, 6), before: localMidnight(2026, 10, 20) });
  });

  it("searches other words with a colon as text", () => {
    expect(parseSearch("Peppa Pig: Muddy Puddles episode:2", NOW)).toMatchObject({
      words: "Peppa Pig: Muddy Puddles episode:2",
      tokens: [],
      error: null,
    });
  });

  it.each(["added:yesterday", "added:2026-02-30", "added:", "category:dance", "category:"])(
    "says what's wrong with %s",
    (text) => {
      const parsed = parseSearch(`peppa ${text}`, NOW);
      expect(parsed.error).toContain(`“${text}”`);
      expect(parsed.tokens).toEqual([]);
    },
  );
});

describe("withCategory", () => {
  it("sets, replaces and removes the category filter", () => {
    expect(withCategory("peppa", "music")).toBe("category:music peppa");
    // A new one goes after the other filters; a changed one keeps its place.
    expect(withCategory("added:>2026-10-19", "music")).toBe("added:>2026-10-19 category:music");
    expect(withCategory("category:music added:2026-10-20 peppa", "play")).toBe("category:play added:2026-10-20 peppa");
    expect(withCategory("added:2026-10-20 category:music category:gaming", "play")).toBe("added:2026-10-20 category:play");
    expect(withCategory("category:music peppa", "")).toBe("peppa");
  });
});

describe("pastWeek", () => {
  it("is the last 7 days, today included", () => {
    expect(pastWeek(NOW)).toEqual({ from: localMidnight(2026, 10, 20), query: "added:>2026-10-19" });
    // The window and its link agree.
    expect(parseSearch(pastWeek(NOW).query).added.from).toBe(pastWeek(NOW).from);
  });
});
