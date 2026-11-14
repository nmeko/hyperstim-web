// The rankings page's state, kept in the URL (plan 007): /rankings?view=…&sort=…&order=…&q=…&page=…
import type { Order, SortKey } from "@/lib/api";
import { categoryLabel } from "@/lib/categories";
import { FEATURE_INFO } from "@/lib/features";
import { parseSearch, withCategory } from "@/lib/search-filters";

export type View = "videos" | "channels";

export type RankingState = {
  view: View;
  /** "score" or a feature key. */
  sort: SortKey;
  order: Order;
  /** Category key; "" = all. Read from `q`'s `category:` filter, so not in the URL itself. */
  category: string;
  /** The search box's text, filters included, trimmed; "" = none. */
  q: string;
  /** From 1. */
  page: number;
};

export const DEFAULT_STATE: RankingState = {
  view: "videos",
  sort: "score",
  order: "desc",
  category: "",
  q: "",
  page: 1,
};

export const PAGE_SIZE = 25;
/** Search words, as the API takes them. */
export const MAX_QUERY = 100;
/** The search box's text in the URL, filters included. */
export const MAX_TEXT = 200;

/** The state in a URL's query; anything invalid falls back to its default. */
export function parseState(params: URLSearchParams): RankingState {
  const view = params.get("view");
  const sort = params.get("sort") ?? "";
  const page = Number(params.get("page"));
  let q = (params.get("q") ?? "").trim().slice(0, MAX_TEXT);
  // Links from before the search filters (`category=music`) still work: it becomes the filter.
  const legacy = params.get("category") ?? "";
  if (categoryLabel(legacy) && !parseSearch(q).category) q = withCategory(q, legacy);
  return {
    view: view === "channels" ? "channels" : "videos",
    sort: Object.hasOwn(FEATURE_INFO, sort) ? sort : "score",
    order: params.get("order") === "asc" ? "asc" : "desc",
    category: parseSearch(q).category,
    q,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The state as a query string, defaults left out ("" when all are defaults). A changed
 * `category` is written into `q` as its filter. */
export function serializeState(state: RankingState, changedCategory?: string): string {
  const q = changedCategory === undefined ? state.q : withCategory(state.q, changedCategory);
  const params = new URLSearchParams();
  for (const key of Object.keys(DEFAULT_STATE) as (keyof RankingState)[]) {
    if (key === "category") continue;
    const value = key === "q" ? q : state[key];
    if (value !== DEFAULT_STATE[key]) params.set(key, String(value));
  }
  return params.toString();
}
