import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, parseState, serializeState } from "./state";

describe("parseState", () => {
  it("reads every field", () => {
    const params = new URLSearchParams(
      "view=channels&sort=cuts_per_min&order=asc&category=play&q=%20zippy%20&page=3",
    );
    expect(parseState(params)).toEqual({
      view: "channels",
      sort: "cuts_per_min",
      order: "asc",
      category: "play",
      q: "category:play zippy", // an old link's category becomes the filter
      page: 3,
    });
    expect(parseState(new URLSearchParams("q=category%3Amusic+added%3A%3E2026-10-19"))).toMatchObject({
      category: "music",
      q: "category:music added:>2026-10-19",
    });
  });

  it("falls back to the defaults for missing or invalid values", () => {
    expect(parseState(new URLSearchParams())).toEqual(DEFAULT_STATE);
    const params = new URLSearchParams("view=x&sort=toString&order=up&category=sports&page=-2");
    expect(parseState(params)).toEqual(DEFAULT_STATE);
    expect(parseState(new URLSearchParams("page=2.5")).page).toBe(1);
  });

  it("cuts the search box's text to 200 characters", () => {
    expect(parseState(new URLSearchParams({ q: "a".repeat(250) })).q).toHaveLength(200);
  });
});

describe("serializeState", () => {
  it("leaves out defaults", () => {
    expect(serializeState(DEFAULT_STATE)).toBe("");
    expect(serializeState({ ...DEFAULT_STATE, view: "channels", page: 2 })).toBe("view=channels&page=2");
  });

  it("round-trips", () => {
    const state = {
      view: "channels",
      sort: "lufs",
      order: "asc",
      category: "music",
      q: "category:music café & co",
      page: 4,
    } as const;
    expect(parseState(new URLSearchParams(serializeState(state)))).toEqual(state);
  });

  it("writes a changed category into the search as its filter", () => {
    const state = { ...DEFAULT_STATE, q: "category:music added:>2026-10-19 peppa" };
    expect(new URLSearchParams(serializeState(state, "gaming")).get("q")).toBe("category:gaming added:>2026-10-19 peppa");
    expect(new URLSearchParams(serializeState({ ...DEFAULT_STATE, q: "added:>2026-10-19" }, "music")).get("q")).toBe(
      "added:>2026-10-19 category:music",
    );
    expect(new URLSearchParams(serializeState(state, "")).get("q")).toBe("added:>2026-10-19 peppa");
  });
});
