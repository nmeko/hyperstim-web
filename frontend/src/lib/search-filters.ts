// The rankings search box's filters (plan 007): `category:<key>` and `added:<date>` next to the
// search words, as GitHub's search does. Only these keys are filters; any other `word:` is searched
// as text, since titles often have colons.

import { CATEGORIES, categoryLabel } from "./categories";

/** A filter token's place in the text, for highlighting; only valid ones are listed. */
export type TokenSpan = { start: number; end: number };

/** When added, as UTC times: from (inclusive), before (exclusive). */
export type AddedRange = { from?: string; before?: string };

export type ParsedSearch = {
  /** The search words: the text without its filter tokens, spaces collapsed. */
  words: string;
  /** Category key; "" = all. */
  category: string;
  added: AddedRange;
  /** The `added:` filters in words, e.g. "added after October 19". */
  addedText: string;
  /** What's wrong with a filter, if anything; then nothing is searched. */
  error: string | null;
  tokens: TokenSpan[];
};

const TOKEN = /(^|\s)(category|added):(\S*)/gi;
const DATE = /^(>=|<=|>|<)?(\d{4})-(\d{2})-(\d{2})$/;

export const CATEGORY_HINT = `Categories: ${CATEGORIES.map((c) => c.key).join(", ")}.`;
export const DATE_HINT = "Use a date like added:2026-10-20, or added:>2026-10-20 for after it.";

/** Midnight at the start of a day in the visitor's time zone, as a UTC time the API takes. */
export function localMidnight(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** A date as `YYYY-MM-DD`, in the visitor's time zone. */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayName(year: number, month: number, day: number, now: Date): string {
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    ...(year === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function parseSearch(text: string, now = new Date()): ParsedSearch {
  const tokens: TokenSpan[] = [];
  const added: AddedRange = {};
  const addedText: string[] = [];
  let category = "";
  let error: string | null = null;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index + match[1].length;
    const key = match[2].toLowerCase();
    const value = match[3];
    if (key === "category") {
      if (!categoryLabel(value.toLowerCase())) {
        error ??= `“${match[0].trim()}” isn’t a category. ${CATEGORY_HINT}`;
        continue;
      }
      category = value.toLowerCase(); // a later one replaces an earlier one
    } else {
      const date = DATE.exec(value);
      const [y, m, d] = date ? [Number(date[2]), Number(date[3]), Number(date[4])] : [0, 0, 0];
      const real = date && new Date(y, m - 1, d).getDate() === d && m >= 1 && m <= 12;
      if (!real) {
        error ??= `“${match[0].trim()}” isn’t a date filter. ${DATE_HINT}`;
        continue;
      }
      const op = date[1] ?? "";
      const dayStart = localMidnight(y, m, d);
      const nextDay = localMidnight(y, m, d + 1);
      const from = op === "" || op === ">=" ? dayStart : op === ">" ? nextDay : undefined;
      const before = op === "" || op === "<=" ? nextDay : op === "<" ? dayStart : undefined;
      if (from && (!added.from || from > added.from)) added.from = from;
      if (before && (!added.before || before < added.before)) added.before = before;
      const words = { "": "on", ">": "after", ">=": "on or after", "<": "before", "<=": "on or before" }[op];
      addedText.push(`${words} ${dayName(y, m, d, now)}`);
    }
    tokens.push({ start, end: start + match[2].length + 1 + value.length });
  }
  return {
    words: text.replace(TOKEN, "$1").replace(/\s+/g, " ").trim(),
    category,
    added,
    addedText: addedText.length ? `added ${addedText.join(" and ")}` : "",
    error,
    tokens,
  };
}

/**
 * The text with its `category:` filter set to `key` ("" removes it): changed in place if there is
 * one, else added after the other filters. The filters come first, then the search words, as the
 * URL keeps them.
 */
export function withCategory(text: string, key: string): string {
  const tokens: string[] = [];
  let placed = !key;
  for (const token of filterTokens(text)) {
    if (!/^category:/i.test(token)) tokens.push(token);
    else if (!placed) {
      tokens.push(`category:${key}`);
      placed = true;
    }
  }
  if (!placed) tokens.push(`category:${key}`);
  const words = text.replace(TOKEN, "$1").replace(/\s+/g, " ").trim();
  return [...tokens, words].join(" ").trim();
}

/** The text's filter tokens, in order, as typed (for rebuilding the text around a link's ID). */
export function filterTokens(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((m) => `${m[2]}:${m[3]}`);
}

/** The rankings link for "added in the last 7 days, today included" (the home page's pill). */
export function pastWeek(now = new Date()): { from: string; query: string } {
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const dayBefore = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  return {
    from: localMidnight(first.getFullYear(), first.getMonth() + 1, first.getDate()),
    query: `added:>${isoDay(dayBefore)}`,
  };
}
