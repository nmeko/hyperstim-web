"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import ChannelName from "@/components/ChannelName";
import Chip from "@/components/Chip";
import MeasurementPicker from "@/components/MeasurementPicker";
import ScoreCell from "@/components/ScoreCell";
import SegmentedControl from "@/components/SegmentedControl";
import Select from "@/components/Select";
import { getChannels, getVideos, lookupChannel, type Feature, type ListResponse, type Order } from "@/lib/api";
import { asset } from "@/lib/asset";
import { CATEGORIES, categoryLabel } from "@/lib/categories";
import { FEATURE_GROUPS, FEATURE_INFO, featureDisplay } from "@/lib/features";
import { LOOKING_UP, PRESS_ENTER, lookupErrorText } from "@/lib/lookup-text";
import { channelHref, videoHref } from "@/lib/routes";
import { useApi } from "@/lib/use-api";
import { isChannelId, isVideoId, readSearchInput } from "@/lib/youtube";
import Pagination from "@/components/Pagination";
import { filterTokens, parseSearch, type TokenSpan } from "@/lib/search-filters";
import InfoTip from "@/components/InfoTip";
import LinkedRow from "@/components/LinkedRow";
import { MAX_QUERY, MAX_TEXT, PAGE_SIZE, parseState, serializeState, type RankingState, type View } from "./state";

// The rankings page (plan 007): every video or channel, ranked by Overall or one measurement.

const OUTLINED_BUTTON =
  "min-h-11 rounded-full border-2 border-navy px-5 font-semibold text-navy hover:bg-white";
const MESSAGE_BOX = "mt-6 rounded-2xl bg-sky p-6 text-center";
const FEATURE_KEYS = FEATURE_GROUPS.flatMap((g) => g.keys);

/** What the search field says instead of a search: a message, or that a channel is being looked up. */
type Notice = { kind: "message"; text: string } | { kind: "busy" } | null;

type Row = {
  key: string;
  rank: number | null;
  name: ReactNode;
  href: string;
  detail: ReactNode;
  /** Link for the second line (a video's channel). */
  detailHref?: string;
  score: number;
  features: Feature[];
};

const VIEWS: Record<View, { label: string; noun: string }> = {
  videos: { label: "Videos", noun: "videos" },
  channels: { label: "Channels", noun: "channels" },
};

/** What `sort` is called in text: "Overall" or the measurement's name. */
const sortName = (sort: string) => (sort === "score" ? "Overall" : FEATURE_INFO[sort].name);
const orderName = (order: Order) => (order === "desc" ? "most stimulating first" : "least stimulating first");
const formatCount = (n: number) => n.toLocaleString("en-US");

/**
 * The dataset's version this page showed first (plan 013): later pages, sorts and searches ask for
 * the dataset as it was then, so rows don't appear or shift while a visitor browses. A new page
 * load starts with the current version.
 */
export type Pin = { asOf?: string };

async function loadRows(state: RankingState, pin: Pin): Promise<ListResponse<Row>> {
  const search = parseSearch(state.q);
  const params = {
    sort: state.sort,
    order: state.order,
    category: state.category,
    q: search.words.slice(0, MAX_QUERY),
    addedFrom: search.added.from,
    addedBefore: search.added.before,
    offset: (state.page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
    asOf: pin.asOf,
  };
  if (state.view === "videos") {
    const { items, total, asOf } = await getVideos(params);
    pin.asOf ??= asOf;
    return {
      total,
      asOf,
      items: items.map((v) => ({
        key: v.id,
        rank: v.rank,
        name: v.title,
        href: videoHref(v.id),
        detail: <ChannelName name={v.channel} id={v.channelId} />,
        detailHref: channelHref(v.channelId),
        score: v.score,
        features: v.features,
      })),
    };
  }
  const { items, total, asOf } = await getChannels(params);
  pin.asOf ??= asOf;
  return {
    total,
    asOf,
    items: items.map((c) => ({
      key: c.id,
      rank: c.rank,
      name: <ChannelName name={c.name} id={c.id} />,
      href: channelHref(c.id),
      detail: c.videoCount === 1 ? "1 video" : `${formatCount(c.videoCount)} videos`,
      score: c.score,
      features: c.features,
    })),
  };
}

/** `/rankings`: reads its state from the URL on the client. */
export default function RankingsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const state = useMemo(() => parseState(params), [params]);

  /** Changes the state (back to page 1 unless a page is given) and writes it to the URL. */
  const update = useCallback(
    (change: Partial<RankingState>, how: "push" | "replace" = "push") => {
      const query = serializeState({ ...state, page: 1, ...change }, change.category);
      router[how](query ? `/rankings?${query}` : "/rankings", { scroll: false });
    },
    [state, router],
  );

  const { view, sort, order, category, q, page } = state;
  const pin = useRef<Pin>({});
  const load = useCallback(
    () => loadRows({ view, sort, order, category, q, page }, pin.current),
    [view, sort, order, category, q, page],
  );
  const result = useApi(load);

  // After a page change, focus moves to the results line once the new rows are in.
  const resultsRef = useRef<HTMLParagraphElement>(null);
  const focusResults = useRef(false);
  const ready = result.status === "success" && !result.stale;
  const total = result.status === "success" ? result.data.total : 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  useEffect(() => {
    if (!ready) return;
    if (total > 0 && page > pageCount) {
      update({ page: pageCount }, "replace"); // an old link past the end
      return;
    }
    if (focusResults.current && resultsRef.current) {
      focusResults.current = false;
      const reduce =
        typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      resultsRef.current.focus({ preventScroll: true });
      resultsRef.current.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
  }, [ready, total, page, pageCount, update]);

  const changePage = (next: number) => {
    focusResults.current = true;
    update({ page: next });
  };

  // A link in the search that can't be searched for (wrong kind, a lookup running or failed).
  const [notice, setNotice] = useState<Notice>(null);
  // "Clear search" empties the field too, also when the URL has no search to clear.
  const [clears, setClears] = useState(0);
  const clearSearch = () => {
    setClears((n) => n + 1);
    update({ q: "" });
  };
  const message = notice?.kind === "message" ? notice.text : null;

  // A new column keeps the current order; the selected column's header flips it.
  const sortBy = (key: string) => update(key === sort ? { order: order === "desc" ? "asc" : "desc" } : { sort: key });

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 md:pt-12 lg:px-8">
      <Hero />
      <section
        aria-label="Rankings"
        className="relative mt-8 rounded-[2rem] border border-navy/15 bg-white px-4 py-8 sm:px-8 md:mt-0"
      >
        <Controls state={state} update={update} onNotice={setNotice} clears={clears} />

        <p role="status" className="sr-only">
          {notice?.kind === "busy" ? LOOKING_UP : result.status === "loading" ? "Loading rankings…" : ""}
        </p>
        <p ref={resultsRef} tabIndex={-1} aria-live="polite" className="mt-6 scroll-mt-24 text-ink">
          {!message && result.status === "success" && result.data.total > 0 && resultsLine(state, result.data.total)}
        </p>

        {message ? (
          <div className={MESSAGE_BOX}>
            <p aria-live="polite">{message}</p>
            <button type="button" onClick={clearSearch} className={`mt-3 ${OUTLINED_BUTTON}`}>
              Clear search
            </button>
          </div>
        ) : result.status === "error" && !result.stale ? (
          <div className={MESSAGE_BOX}>
            <p>We couldn’t load the rankings.</p>
            <button type="button" onClick={result.retry} className={`mt-3 ${OUTLINED_BUTTON}`}>
              Try again
            </button>
          </div>
        ) : result.status === "success" && !result.stale && result.data.total === 0 ? (
          <NoMatch state={state} onClear={clearSearch} />
        ) : (
          <div
            aria-busy={result.status !== "success" || result.stale || notice?.kind === "busy"}
            className={result.stale || notice?.kind === "busy" ? "opacity-60 transition-opacity" : undefined}
          >
            {/* Both are rendered and CSS picks one, so the first paint already fits the screen. */}
            <div className="hidden lg:block">
              <RankTable state={state} rows={result.status === "success" ? result.data.items : null} onSort={sortBy} />
            </div>
            <div className="lg:hidden">
              <RankCards state={state} rows={result.status === "success" ? result.data.items : null} />
            </div>
          </div>
        )}

        {!message && result.status === "success" && (
          <Pagination page={page} pageCount={pageCount} onChange={changePage} />
        )}
      </section>
    </div>
  );
}

/** The search words are a video ID (Videos) or a channel ID (Channels), as a pasted link leaves them. */
const isLinkId = (state: RankingState) => {
  const { words } = parseSearch(state.q);
  return state.view === "videos" ? isVideoId(words) : isChannelId(words);
};

function resultsLine(state: RankingState, total: number): string {
  const from = (state.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, state.page * PAGE_SIZE);
  const label = categoryLabel(state.category)?.toLowerCase();
  const s = total === 1 ? "" : "s";
  const { words, addedText } = parseSearch(state.q);
  const added = addedText ? ` ${addedText}` : "";
  // A pasted link is searched by its ID, which means nothing to read.
  const matching = isLinkId(state) ? " for this link" : words ? ` matching “${words}”` : "";
  const things =
    state.view === "videos"
      ? `${label ? `${label} ` : ""}video${s}${added}${matching}`
      : `channel${s}${label ? ` with ${label} videos` : ""}${added}${matching}`;
  return `Showing ${formatCount(from)}–${formatCount(to)} of ${formatCount(total)} ${things}`;
}

/** The Suspense fallback: the page's top, before its state is read from the URL. */
export function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 md:pt-12 lg:px-8" aria-busy="true">
      <Hero />
      <p role="status" className="sr-only">
        Loading rankings…
      </p>
    </div>
  );
}

/**
 * The H1 and intro, and the kid stacking blocks on the card's top edge. The kid's head is as large
 * as on the other pages (plan 001); where it's taller than the text, it rises above the text's top
 * instead of pushing the H1 down.
 */
function Hero() {
  return (
    <div className="relative md:pr-[15.5rem] lg:pr-[19rem] xl:pr-[21.5rem]">
      <div className="md:pb-6">
        <h1 className="font-hand text-[2rem] leading-tight font-semibold text-navy sm:text-[2.75rem] lg:text-[3.25rem]">
          Stimulation rankings
        </h1>
        <p className="mt-3 max-w-prose text-lg">
          Videos and channels in our dataset, ranked by how stimulating they are.
        </p>
        <p className="mt-1 text-lg">
          <Link
            href="/how-it-works"
            className="font-bold text-navy underline decoration-2 underline-offset-4 hover:decoration-sunny"
          >
            What the measurements mean&nbsp;<span aria-hidden="true">→</span>
          </Link>
        </p>
      </div>
      {/* Body and blocks rest on the card's border (the art's floor is 92 % down the image); flipped, so
          the kid faces the page. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, images pre-converted */}
      <img
        src={asset("/images/kid_blocks_2.webp")}
        alt=""
        aria-hidden="true"
        width={576}
        height={384}
        data-kid=""
        className="pointer-events-none absolute right-0 bottom-0 z-10 hidden h-auto w-54 translate-y-[10%] -scale-x-100 md:mr-4 md:block lg:mr-8 lg:w-62 xl:w-72"
      />
    </div>
  );
}

function Controls({
  state,
  update,
  onNotice,
  clears,
}: {
  state: RankingState;
  update: (change: Partial<RankingState>, how?: "push" | "replace") => void;
  onNotice: (notice: Notice) => void;
  clears: number;
}) {
  const onSearch = useCallback((q: string) => update({ q }, "replace"), [update]);
  return (
    <div className="grid gap-4">
      {/* The view control comes first (above the search on phones); from `md` it sits on the right. */}
      <div className="flex flex-col gap-3 md:flex-row-reverse md:items-center md:justify-between md:gap-6">
        <SegmentedControl
          label="Show ranking of"
          options={(Object.keys(VIEWS) as View[]).map((v) => ({ value: v, label: VIEWS[v].label }))}
          value={state.view}
          onChange={(view) => update({ view })}
          className="shrink-0"
        />
        <SearchBox value={state.q} view={state.view} onSearch={onSearch} onNotice={onNotice} clears={clears} />
      </div>

      {/* Chips from `sm`, a select below. CSS picks, so nothing flashes on load. */}
      <div className="hidden flex-wrap items-center justify-between gap-x-4 sm:flex">
        <div role="group" aria-label="Category" className="flex flex-wrap items-center gap-x-1.5">
          <span className="mr-1.5 text-sm text-ink">Category</span>
          <Chip pressed={state.category === ""} onClick={() => update({ category: "" })}>
            All
          </Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c.key} pressed={state.category === c.key} onClick={() => update({ category: c.key })}>
              {c.label}
            </Chip>
          ))}
        </div>
        <OrderButton order={state.order} onChange={(order) => update({ order })} className="ml-auto hidden lg:flex" />
      </div>
      {/*
        Below `lg` there are no column headers to click: a select and the order button rank the
        cards. On phones the category select sits beside "Rank by", so the results start higher.
      */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:flex sm:items-end sm:gap-4 lg:hidden">
        <Select
          label="Category"
          value={state.category}
          onChange={(category) => update({ category })}
          compact
          className="min-w-0 sm:hidden"
        >
          <option value="">All</option>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </Select>
        <MeasurementPicker
          label="Rank by"
          wide={false}
          value={state.sort === "score" ? "overall" : state.sort}
          onChange={(m) => update({ sort: m === "overall" ? "score" : m })}
          compact
          className="min-w-0 sm:w-72"
        />
        <OrderButton
          order={state.order}
          onChange={(order) => update({ order })}
          className="col-span-2 -ml-3 flex justify-self-start sm:mb-0.5 sm:ml-0"
        />
      </div>
    </div>
  );
}

/**
 * The order, flipped on click (see STYLE.md, Order button): quiet text, so it doesn't compete with
 * the view control and the chips. On the category row from `lg`, next to "Rank by" below.
 */
function OrderButton({
  order,
  onChange,
  className,
}: {
  order: Order;
  onChange: (order: Order) => void;
  className: string;
}) {
  const text = order === "desc" ? "Most stimulating first" : "Least stimulating first";
  return (
    <button
      type="button"
      aria-label={`Order: ${text}`}
      onClick={() => onChange(order === "desc" ? "asc" : "desc")}
      className={`group min-h-11 items-center text-sm font-semibold text-navy ${className}`}
    >
      <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5 group-hover:bg-sky">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4">
          <path
            d="M6.5 15.5v-11m-3 3 3-3 3 3m4-3v11m-3-3 3 3 3-3"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-navy"
          />
        </svg>
        {text}
      </span>
    </button>
  );
}

/**
 * Search as you type (after a 300 ms pause, or at once on Enter). Follows the URL on Back.
 * A link is searched for by its ID (plan 007): a video link with Videos, a channel link with
 * Channels. A handle, `/c/` or `/user/` link is looked up first, when pasted or on Enter, as it
 * may ask YouTube. Anything it can't search for goes to `onNotice` instead.
 */
function SearchBox({
  value,
  view,
  onSearch,
  onNotice,
  clears,
}: {
  value: string;
  view: View;
  onSearch: (q: string) => void;
  onNotice: (notice: Notice) => void;
  clears: number;
}) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  // Searches sent to the URL that it hasn't caught up with yet. When the URL reaches one, that's
  // our own echo and the field keeps what was typed since; any other URL value (Back, "Clear
  // search") replaces the field. Without this, letters typed while the URL caught up were lost.
  const [pending, setPending] = useState<string[]>([]);
  // The channel link being looked up, and whether the last change was a paste.
  const [linkToFind, setLinkToFind] = useState<string | null>(null);
  const pasted = useRef(false);
  const [seenClears, setSeenClears] = useState(clears);
  if (clears !== seenClears) {
    setSeenClears(clears);
    setText("");
    setLinkToFind(null);
  }
  if (value !== seen) {
    setSeen(value);
    const echo = pending.indexOf(value);
    if (echo >= 0) {
      setPending(pending.slice(echo + 1));
    } else {
      setPending([]);
      if (text.trim() !== value) setText(value);
    }
  }
  const latest = pending.at(-1) ?? value;

  const trimmed = text.trim();
  const parsed = parseSearch(trimmed);
  const words = parsed.words;
  // The search words with the filters put back in front, as the URL keeps them.
  const withFilters = (q: string) => [...filterTokens(trimmed), q].join(" ").trim().slice(0, MAX_TEXT);
  const loadChannel = useCallback(
    () => (linkToFind ? lookupChannel(linkToFind) : Promise.resolve(null)),
    [linkToFind],
  );
  const found = useApi(loadChannel);
  const foundNow = linkToFind === words && found.status !== "loading" && !found.stale;

  // What to search for (null: nothing), or what to say instead.
  const entry = readSearchInput(words);
  let target: string | null = null;
  let message: string | null = null;
  let busy = false;
  if (parsed.error) message = parsed.error;
  else if (entry.kind === "empty") target = withFilters("");
  else if (entry.kind === "name") target = withFilters(words.slice(0, MAX_QUERY));
  else if (entry.kind === "badLink") message = "That doesn’t look like a YouTube link or video ID.";
  else if (view === "videos") {
    if (entry.kind === "video") target = withFilters(entry.id);
    else message = "That’s a channel link. Switch to Channels to find a channel.";
  } else if (entry.kind === "video") {
    message = "That’s a video link. To find a channel, paste a channel’s link or type its name.";
  } else if (entry.kind === "channel") {
    target = withFilters(entry.id); // its ID is in the link: no lookup
  } else if (linkToFind !== words) {
    message = PRESS_ENTER;
  } else if (!foundNow) {
    busy = true;
  } else if (found.status === "error") {
    message = lookupErrorText(found.error);
  } else if (found.status === "success" && found.data) {
    target = withFilters(found.data.channelId);
  }

  useEffect(() => {
    onNotice(message ? { kind: "message", text: message } : busy ? { kind: "busy" } : null);
  }, [message, busy, onNotice]);

  const search = useCallback(
    (q: string) => {
      setPending((sent) => [...sent, q]);
      onSearch(q);
    },
    [onSearch],
  );

  useEffect(() => {
    if (target === null || target === latest) return;
    const timer = setTimeout(() => search(target), 300);
    return () => clearTimeout(timer);
  }, [target, latest, search]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (view === "channels" && entry.kind === "channelPage" && !parsed.error) {
      if (linkToFind !== words) setLinkToFind(words);
      else if (found.status === "error") found.retry();
    } else if (target !== null && target !== latest) search(target);
  };

  // The filters typed so far are highlighted behind the text, so it's clear they're filters.
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const syncScroll = () => {
    if (backdropRef.current && inputRef.current) backdropRef.current.scrollLeft = inputRef.current.scrollLeft;
  };
  useEffect(syncScroll, [text]);

  const label = view === "videos" ? "Search videos" : "Search channels";
  return (
    <form role="search" onSubmit={submit} className="flex w-full items-center gap-1 md:max-w-md">
      <div className="relative min-w-0 flex-1">
        <label htmlFor="rankings-search" className="sr-only">
          {label}
        </label>
        {/* Behind the input: its text, transparent, with the filters marked; clipped and scrolled as the input's text is.
            The input has no built-in clear button, which would narrow its text and put the marks out of line. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full border-2 border-transparent bg-white">
          <div
            ref={backdropRef}
            className="absolute inset-y-0 right-5 left-12 overflow-hidden leading-[2.75rem] whitespace-pre text-transparent"
          >
            <Highlighted text={text} marks={parseSearch(text).tokens} />
          </div>
        </div>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2"
        >
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" strokeWidth="2.25" className="stroke-navy" />
          <path d="m12.75 12.75 4.5 4.5" strokeWidth="2.25" strokeLinecap="round" className="stroke-navy" />
        </svg>
        <input
          ref={inputRef}
          id="rankings-search"
          type="search"
          value={text}
          maxLength={500}
          onPaste={() => {
            pasted.current = true;
          }}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            // A pasted handle link is looked up at once; a typed one waits for Enter.
            const nextWords = parseSearch(next).words;
            const lookUp = pasted.current && view === "channels" && readSearchInput(nextWords).kind === "channelPage";
            pasted.current = false;
            setLinkToFind(lookUp ? nextWords : null);
          }}
          onScroll={syncScroll}
          onSelect={syncScroll}
          placeholder={view === "videos" ? "Title, channel, or video link…" : "Channel name or link…"}
          autoComplete="off"
          className="relative h-12 w-full rounded-full border-2 border-navy bg-transparent pr-5 pl-12 text-navy placeholder:text-ink/70 [&::-webkit-search-cancel-button]:hidden focus:shadow-[0_0_0_5px_var(--color-sunny)] focus:outline-none"
        />
      </div>
      <InfoTip id="search-info" label="How to search">
        <p>Search by title or channel, or paste a YouTube link. Filters:</p>
        <dl className="mt-2 grid gap-1.5">
          {SEARCH_FILTERS.map(([filter, meaning]) => (
            <div key={filter}>
              <dt className="font-semibold text-navy">{filter}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      </InfoTip>
    </form>
  );
}

const SEARCH_FILTERS = [
  ["category:music", "music, narrative, play, educational or gaming"],
  ["added:2026-10-20", "added that day"],
  ["added:>2026-10-20", "added after it (also <, >=, <=)"],
];

/** The search text with its filters marked (see STYLE.md, Search filters); the text itself is transparent. */
function Highlighted({ text, marks }: { text: string; marks: TokenSpan[] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const { start, end } of marks) {
    parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="rounded-sm bg-sky-blue/25 text-transparent">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

function NoMatch({ state, onClear }: { state: RankingState; onClear: () => void }) {
  const label = categoryLabel(state.category)?.toLowerCase();
  const things = `${label ? `${label} ` : ""}${VIEWS[state.view].noun}`;
  // A pasted link (searched by its ID) that isn't ranked: say why. With a category, the category may hide it.
  const { words, addedText } = parseSearch(state.q);
  const linked = !state.category && !addedText && isLinkId(state);
  const filtered = `${things}${addedText ? ` ${addedText}` : ""}`;
  if (!words) {
    if (!addedText) return <p className={MESSAGE_BOX}>No {things} yet.</p>;
    return (
      <div className={MESSAGE_BOX}>
        <p>No {filtered}.</p>
        <button type="button" onClick={onClear} className={`mt-3 ${OUTLINED_BUTTON}`}>
          Clear search
        </button>
      </div>
    );
  }
  return (
    <div className={MESSAGE_BOX}>
      {linked && state.view === "videos" ? (
        <p>
          This video isn’t in our dataset.{" "}
          <TextLink href={videoHref(words)}>Check it</TextLink>
        </p>
      ) : linked ? (
        <UnrankedChannel id={words} />
      ) : (
        <p>
          No {filtered} match “{words}”.
        </p>
      )}
      <button type="button" onClick={onClear} className={`mt-3 ${OUTLINED_BUTTON}`}>
        Clear search
      </button>
    </div>
  );
}

/** Why a linked channel isn't listed: it isn't in the dataset. A channel-ID lookup never asks YouTube. */
function UnrankedChannel({ id }: { id: string }) {
  const load = useCallback(() => lookupChannel(`https://www.youtube.com/channel/${id}`), [id]);
  const found = useApi(load);
  if (found.status === "loading") return <p>{LOOKING_UP}</p>;
  if (found.status === "error") return <p>No channels match “{id}”.</p>;
  const { name, inDataset } = found.data;
  if (!inDataset) return <p>{name ?? "This channel"} isn’t in our dataset yet.</p>;
  return <p>No channels match “{id}”.</p>;
}

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-bold text-navy underline decoration-2 underline-offset-4 hover:decoration-sunny">
      {children}&nbsp;<span aria-hidden="true">→</span>
    </Link>
  );
}

/** A measurement's tile, or a dash with the reason it has no value. */
function FeatureCell({ feature }: { feature: Feature | undefined }) {
  if (!feature) return <ScoreCell score={null} empty="Not measured" />;
  const display = featureDisplay(feature);
  return display.kind === "percentile" ? (
    <ScoreCell score={display.percentile} />
  ) : (
    <ScoreCell score={null} empty={display.text} />
  );
}

const ORDINAL = new Intl.PluralRules("en", { type: "ordinal" });
const SUFFIX: Partial<Record<Intl.LDMLPluralRule, string>> = { one: "st", two: "nd", few: "rd" };

/** Most stimulating first: 1, 2, 3…; least stimulating first: −1, −2, −3… (as on the home card). */
function Rank({ rank, order }: { rank: number | null; order: Order }) {
  if (rank === null) {
    return (
      <>
        <span aria-hidden="true">–</span>
        <span className="sr-only">Not ranked</span>
      </>
    );
  }
  if (order === "desc") return <>{formatCount(rank)}</>;
  return (
    <>
      <span aria-hidden="true">−{formatCount(rank)}</span>
      <span className="sr-only">{`${formatCount(rank)}${SUFFIX[ORDINAL.select(rank)] ?? "th"} least stimulating`}</span>
    </>
  );
}

/** The name's link covers its cell or the whole card; the second line's link sits above it. */
function NameLines({ row }: { row: Row }) {
  return (
    <>
      <Link href={row.href} className="line-clamp-2 font-semibold text-navy after:absolute after:inset-0 hover:underline">
        {row.name}
      </Link>
      <span className="mt-0.5 block truncate text-sm">
        {row.detailHref ? (
          <Link href={row.detailHref} className="relative z-10 hover:text-navy hover:underline">
            {row.detail}
          </Link>
        ) : (
          row.detail
        )}
      </span>
    </>
  );
}

const SKELETON_ROWS = 8;
const BAR = "block animate-pulse rounded bg-gray-200";
// First column of each group: a line on its left, so the groups read as blocks.
const GROUP_START = new Set(["score", ...FEATURE_GROUPS.map((g) => g.keys[0])]);
// The column names stay at the top of the screen as the rows scroll. Their line is a shadow, as
// collapsed borders stay with the table; links get a scroll margin so focus never hides under it.
const STICKY = "sticky top-0 z-20 bg-white shadow-[inset_0_-1px_0] shadow-navy/15";

function RankTable({
  state,
  rows,
  onSort,
}: {
  state: RankingState;
  rows: Row[] | null;
  onSort: (key: string) => void;
}) {
  const groupLine = (key: string) => (GROUP_START.has(key) ? "border-l border-navy/10" : "");
  const header = (key: string) => {
    const selected = state.sort === key;
    return (
      <th
        key={key}
        scope="col"
        aria-sort={selected ? (state.order === "desc" ? "descending" : "ascending") : undefined}
        className={`px-0.5 pt-1 pb-2 align-bottom ${STICKY} ${groupLine(key)}`}
      >
        <button
          type="button"
          onClick={() => onSort(key)}
          className={`mx-auto flex w-10 flex-col items-center justify-end gap-1 rounded-full py-2 text-xs font-semibold text-navy ${selected ? "bg-sunny" : "hover:bg-sky"}`}
        >
          <span className="rotate-180 whitespace-nowrap [writing-mode:vertical-rl]">{sortName(key)}</span>
          {/* Every column shows a faint ▼ so it reads as clickable; the selected one shows its order. */}
          <span aria-hidden="true" className={`h-3 text-[0.625rem] leading-3 ${selected ? "" : "text-navy/30"}`}>
            {selected && state.order === "asc" ? "▲" : "▼"}
          </span>
        </button>
      </th>
    );
  };

  return (
    <table className="mt-2 w-full table-fixed border-collapse [&_tbody_a]:scroll-mt-44">
      <caption className="sr-only">
        {VIEWS[state.view].label}, ranked by {sortName(state.sort)}, {orderName(state.order)}
      </caption>
      <colgroup>
        <col className="w-16" />
        <col />
        <col className="w-14" />
        {FEATURE_KEYS.map((key) => (
          <col key={key} className="w-12" />
        ))}
      </colgroup>
      <thead>
        <tr>
          <td colSpan={3} />
          {FEATURE_GROUPS.map((group) => (
            <th
              key={group.title}
              scope="colgroup"
              colSpan={group.keys.length}
              className="border-l border-navy/10 px-1.5 pb-1 text-center align-bottom text-xs leading-tight font-semibold text-ink"
            >
              {group.title}
            </th>
          ))}
        </tr>
        <tr className="text-sm text-ink">
          <th scope="col" className={`pr-4 pb-2 text-right align-bottom font-semibold ${STICKY}`}>
            <span aria-hidden="true">#</span>
            <span className="sr-only">Rank</span>
          </th>
          <th scope="col" className={`pr-4 pb-2 text-left align-bottom font-semibold ${STICKY}`}>
            {state.view === "videos" ? "Video" : "Channel"}
          </th>
          {header("score")}
          {FEATURE_KEYS.map(header)}
        </tr>
      </thead>
      <tbody>
        {rows
          ? rows.map((row) => (
              <LinkedRow
                key={row.key}
                href={row.href}
                className="h-16 border-b border-navy/10 last:border-0 hover:bg-sky/60"
              >
                <td className="pr-4 text-right text-sm font-bold text-navy tabular-nums">
                  <Rank rank={row.rank} order={state.order} />
                </td>
                <td className="relative pr-4">
                  <NameLines row={row} />
                </td>
                <td className={`text-center ${groupLine("score")}`}>
                  <ScoreCell score={row.score} />
                </td>
                {FEATURE_KEYS.map((key) => (
                  <td key={key} className={`text-center ${groupLine(key)}`}>
                    <FeatureCell feature={row.features.find((f) => f.key === key)} />
                  </td>
                ))}
              </LinkedRow>
            ))
          : Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <tr key={i} className="h-16 border-b border-navy/10 last:border-0">
                <td className="pr-4">
                  <span className={`${BAR} ml-auto h-4 w-6`} />
                </td>
                <td className="pr-4">
                  <span className={`${BAR} h-4 w-4/5`} />
                  <span className={`${BAR} mt-2 h-3 w-2/5`} />
                </td>
                {["score", ...FEATURE_KEYS].map((key) => (
                  <td key={key} className={groupLine(key)}>
                    <span className={`${BAR} mx-auto h-8 w-10`} />
                  </td>
                ))}
              </tr>
            ))}
      </tbody>
    </table>
  );
}

/** Phones and tablets: one card per row with Overall and the measurement it's ranked by. */
function RankCards({ state, rows }: { state: RankingState; rows: Row[] | null }) {
  const tile = (label: string, cell: ReactNode) => (
    <span className="flex items-center gap-2 text-sm">
      {label}
      {cell}
    </span>
  );
  if (!rows) {
    return (
      <ul className="mt-2">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <li key={i} className="grid grid-cols-[3.5rem_1fr] border-b border-navy/10 py-3 last:border-0">
            <span className={`${BAR} mt-1 h-4 w-6`} />
            <span>
              <span className={`${BAR} h-4 w-4/5`} />
              <span className={`${BAR} mt-2 h-3 w-2/5`} />
              <span className={`${BAR} mt-3 h-8 w-24`} />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ol aria-label={`${VIEWS[state.view].label}, ranked by ${sortName(state.sort)}, ${orderName(state.order)}`} className="mt-2">
      {rows.map((row) => (
        <li
          key={row.key}
          className="relative grid grid-cols-[3.5rem_1fr] border-b border-navy/10 py-3 last:border-0 hover:bg-sky/60"
        >
          <span className="pt-0.5 pr-3 text-right text-sm font-bold text-navy tabular-nums">
            <Rank rank={row.rank} order={state.order} />
          </span>
          <div className="min-w-0">
            <NameLines row={row} />
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {tile("Overall", <ScoreCell score={row.score} />)}
              {state.sort !== "score" &&
                tile(FEATURE_INFO[state.sort].name, <FeatureCell feature={row.features.find((f) => f.key === state.sort)} />)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
