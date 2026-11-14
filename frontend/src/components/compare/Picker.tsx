"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import ChannelName from "@/components/ChannelName";
import { Thumbnail } from "@/components/Thumbnail";
import { getChannels, getVideos, lookupChannel } from "@/lib/api";
import { LOOKING_UP, PRESS_ENTER, lookupErrorText } from "@/lib/lookup-text";
import { useApi } from "@/lib/use-api";
import { readSearchInput } from "@/lib/youtube";
import { Badge } from "./parts";
import type { Side, View } from "./state";

export const DEBOUNCE_MS = 300;
/** Suggestions per request; more load as the list scrolls near its end. */
export const PAGE = 20;
const MAX_QUERY = 100;
/** Load the next page when the list is scrolled to within this many px of its end. */
const LOAD_AHEAD_PX = 120;

/** `thumb`: the video whose thumbnail leads the option. */
type Option = { id: string; name: ReactNode; detail: ReactNode; thumb?: string };
type Page = { items: Option[]; total: number };

const TEXT = {
  videos: {
    label: "Video name or video link",
    placeholder: "Title, channel, or video link…",
    hint: "Search our dataset, or paste a YouTube video link to check any video.",
    noMatch: (q: string) => `No videos in our dataset match “${q}”. Paste a YouTube video link to check any video.`,
    badLink: "That doesn’t look like a YouTube link or video ID.",
  },
  channels: {
    label: "Channel name or channel link",
    placeholder: "Channel name or link…",
    hint: "Search our dataset, or paste a YouTube channel link.",
    noMatch: (q: string) => `No channels in our dataset match “${q}”. You can also paste a channel’s link.`,
    badLink: "That doesn’t look like a YouTube channel link.",
  },
};

const LOOKUP = {
  notInDataset: (name: string | null) =>
    `${name ?? "This channel"} isn’t in our dataset yet. Checking a whole channel is coming soon. For now, pick a channel from our dataset.`,
  taken: "That channel is already in the other slot.",
};

const videoCount = (n: number) => (n === 1 ? "1 video" : `${n.toLocaleString("en-US")} videos`);

/** The dataset's version the picker's first list was from (as on the rankings page, plan 013). */
type Pin = { asOf?: string };

async function search(view: View, q: string, offset: number, pin: Pin): Promise<Page> {
  const params = { sort: "score", order: "desc" as const, q, offset, limit: PAGE, asOf: pin.asOf };
  if (view === "videos") {
    const { items, total, asOf } = await getVideos(params);
    pin.asOf ??= asOf;
    return { total, items: items.map((v) => ({
        id: v.id,
        name: v.title,
        detail: <ChannelName name={v.channel} id={v.channelId} />,
        thumb: v.id,
      })) };
  }
  const { items, total, asOf } = await getChannels({ ...params, minVideos: 1 });
  pin.asOf ??= asOf;
  return {
    total,
    items: items.map((c) => ({
      id: c.id,
      name: <ChannelName name={c.name} id={c.id} />,
      detail: videoCount(c.videoCount),
    })),
  };
}

/**
 * An empty slot's field (see STYLE.md, Compare picker): typing a name suggests videos or
 * channels from the dataset, in a list that scrolls and loads more as it nears its end. A
 * pasted video link is offered as is, and checked live if it isn't in the dataset. A channel
 * link is looked up when pasted or on Enter (it may ask YouTube), and a channel we have is
 * offered by its name. An ARIA combobox with a listbox; `otherId` (the other slot's item) is
 * never offered.
 */
export default function Picker({
  side,
  view,
  otherId,
  onPick,
  autoFocus = false,
}: {
  side: Side;
  view: View;
  otherId: string;
  onPick: (id: string) => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const text = TEXT[view];
  const [value, setValue] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Pages after the first, for the query they were loaded for.
  const [more, setMore] = useState<{ query: string; items: Option[]; loading: boolean }>({
    query: "",
    items: [],
    loading: false,
  });
  // The channel link being looked up (channels only), and whether the last change was a paste.
  const [linkToFind, setLinkToFind] = useState<string | null>(null);
  const pasted = useRef(false);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  const trimmed = value.trim();
  const entry = readSearchInput(trimmed);
  const channelLink = entry.kind === "channel" || entry.kind === "channelPage";
  // A link isn't searched for; a bare video ID is both offered and searched.
  const searchable = entry.kind === "name";

  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchable ? trimmed.slice(0, MAX_QUERY) : ""), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, searchable]);

  // While a new search runs, the last results stay (dimmed); an older response never wins.
  const pin = useRef<Pin>({});
  const load = useCallback(
    () => (query ? search(view, query, 0, pin.current) : Promise.resolve<Page>({ items: [], total: 0 })),
    [view, query],
  );
  const first = useApi(load);
  const current = first.status !== "loading" && !first.stale;
  const loaded = [
    ...(first.status === "success" ? first.data.items : []),
    ...(more.query === query ? more.items : []),
  ];
  const total = first.status === "success" ? first.data.total : 0;
  const hasMore = current && first.status === "success" && loaded.length < total;

  const loadMore = () => {
    if (!hasMore || (more.query === query && more.loading)) return;
    const offset = loaded.length;
    const forQuery = query;
    const kept = more.query === query ? more.items : [];
    setMore({ query: forQuery, items: kept, loading: true });
    search(view, forQuery, offset, pin.current).then(
      (page) =>
        setMore((old) => (old.query === forQuery ? { query: forQuery, items: [...kept, ...page.items], loading: false } : old)),
      () => setMore((old) => (old.query === forQuery ? { ...old, loading: false } : old)),
    );
  };

  // A channel link, looked up; a new value drops it, so an old answer never applies.
  const loadChannel = useCallback(
    () => (linkToFind ? lookupChannel(linkToFind) : Promise.resolve(null)),
    [linkToFind],
  );
  const found = useApi(loadChannel);
  const foundNow = linkToFind !== null && found.status !== "loading" && !found.stale;
  const foundChannel = foundNow && found.status === "success" ? found.data : null;
  let lookup: string | null = null;
  if (linkToFind !== null) {
    if (!foundNow) lookup = LOOKING_UP;
    else if (found.status === "error") lookup = lookupErrorText(found.error);
    else if (foundChannel) {
      if (!foundChannel.inDataset) lookup = LOOKUP.notInDataset(foundChannel.name);
      else if (foundChannel.channelId === otherId) lookup = LOOKUP.taken;
    }
  }

  const videoId = entry.kind === "video" ? entry.id : entry.kind === "name" ? entry.videoId : null;
  const linkOption: Option | null =
    view === "videos"
      ? videoId && videoId !== otherId
        ? { id: videoId, name: `Use this video: ${videoId}`, detail: "" }
        : null
      : foundChannel?.inDataset && foundChannel.channelId !== otherId
        ? {
            id: foundChannel.channelId,
            name: <ChannelName name={foundChannel.name ?? ""} id={foundChannel.channelId} />,
            detail: videoCount(foundChannel.videoCount),
          }
        : null;
  const options = [
    ...(linkOption ? [linkOption] : []),
    ...(searchable ? loaded.filter((o) => o.id !== otherId && o.id !== linkOption?.id) : []),
  ];

  let message: string | null = null;
  if (options.length === 0 && trimmed) {
    if (view === "videos" && channelLink) message = "That’s a channel link. Switch to Channels to compare channels.";
    else if (view === "channels" && entry.kind === "video") message = "That’s a video link. To compare channels, paste a channel’s link or type its name.";
    else if (entry.kind === "badLink") message = text.badLink;
    else if (view === "channels" && channelLink && linkToFind !== trimmed) message = PRESS_ENTER;
    else if (view === "videos" && videoId === otherId) message = "That video is already in the other slot.";
    else if (current && first.status === "error") message = "We couldn’t search right now. Please try again in a moment.";
    else if (current && first.status === "success" && query && query === trimmed.slice(0, MAX_QUERY)) message = text.noMatch(query);
  }
  const expanded = open && options.length > 0;
  const showPopup = open && (options.length > 0 || message !== null);
  const room = useRoomBelow(list, input, expanded);

  const choose = (option: Option) => {
    setOpen(false);
    setActive(-1);
    setValue("");
    setLinkToFind(null);
    onPick(option.id);
  };

  /** Looks up the channel link in the field (again, if the last try failed). */
  const findChannel = () => {
    if (linkToFind !== trimmed) setLinkToFind(trimmed);
    else if (found.status === "error") found.retry();
  };

  // Keeps the active option in view as the arrow keys move through the list.
  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, id]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const n = options.length;
      if (n === 0) return;
      if (e.key === "ArrowDown" && active >= n - 2) loadMore();
      setActive((i) => (e.key === "ArrowDown" ? Math.min(i + 1, n - 1) : i <= 0 ? n - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = options[active] ?? options[0];
      if (option) choose(option);
      else if (view === "channels" && channelLink) findChannel();
      setOpen(true);
    } else if (e.key === "Escape") {
      if (open) e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  const onScroll = (e: UIEvent<HTMLUListElement>) => {
    const list = e.currentTarget;
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - LOAD_AHEAD_PX) loadMore();
  };

  const optionId = (i: number) => `${id}-option-${i}`;
  return (
    <div>
      <label htmlFor={`${id}-input`} className="flex items-center gap-2 font-semibold text-navy">
        <Badge side={side} decorative large />
        {text.label}
      </label>
      <div className="relative mt-2">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 fill-none stroke-navy stroke-2"
        >
          <circle cx="8.5" cy="8.5" r="6" />
          <path d="m13 13 5 5" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
          placeholder={text.placeholder}
          value={value}
          onPaste={() => {
            pasted.current = true;
          }}
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            setOpen(true);
            setActive(-1);
            // A pasted channel link is looked up at once; a typed one waits for Enter.
            const kind = readSearchInput(next).kind;
            const lookUp = pasted.current && view === "channels" && (kind === "channel" || kind === "channelPage");
            pasted.current = false;
            setLinkToFind(lookUp ? next.trim() : null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="h-12 w-full min-w-0 rounded-full border-2 border-navy bg-white pr-5 pl-12 text-navy placeholder:text-ink/70 focus:shadow-[0_0_0_5px_var(--color-sunny)] focus:outline-none"
        />
        <div
          hidden={!showPopup}
          className="absolute inset-x-0 top-full z-20 mt-2 rounded-2xl border border-navy/15 bg-white p-2 shadow-[0_4px_16px_rgb(15_46_138/0.08)]"
        >
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={view === "videos" ? "Suggested videos" : "Suggested channels"}
            onScroll={onScroll}
            // About six options in view; the rest scroll, and more load near the end.
            style={room === null ? undefined : { maxHeight: `min(21rem, ${room}px)` }}
            className={`max-h-[21rem] overflow-y-auto overscroll-contain ${current ? "" : "opacity-60"}`}
          >
            {expanded &&
              options.map((option, i) => (
                <li
                  key={option.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  // Keeps focus in the field, so the click lands before it closes the list.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(option)}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-1.5 hover:bg-sky aria-selected:bg-sky"
                >
                  {option.thumb && (
                    <Thumbnail
                      id={option.thumb}
                      size="mq"
                      loading="lazy"
                      width={64}
                      height={36}
                      className="aspect-video w-12 shrink-0 rounded bg-navy/10 object-cover sm:w-16"
                    />
                  )}
                  <span className="flex min-w-0 flex-col">
                    {/* Below `sm`, a video's title gets two lines: the thumbnail leaves it little room. */}
                    <span
                      className={`text-sm font-semibold text-navy ${option.thumb ? "line-clamp-2 sm:line-clamp-1" : "truncate"}`}
                    >
                      {option.name}
                    </span>
                    {option.detail && <span className="truncate text-sm text-ink">{option.detail}</span>}
                  </span>
                </li>
              ))}
            {expanded && more.query === query && more.loading && (
              <li role="presentation" className="px-3 py-2 text-sm text-ink/80">
                Loading more…
              </li>
            )}
          </ul>
          {!expanded && message && <p className="px-3 py-2 text-sm text-ink">{message}</p>}
        </div>
      </div>
      <p id={`${id}-hint`} aria-live="polite" className={`mt-2 text-sm ${lookup ? "font-semibold text-navy" : "text-ink"}`}>
        {lookup ?? text.hint}
      </p>
      <p aria-live="polite" className="sr-only">
        {open && trimmed ? (expanded ? `${options.length} suggestions${hasMore ? `, more as you scroll` : ""}` : message ?? "") : ""}
      </p>
    </div>
  );
}

/** Room the list keeps above the screen's bottom edge, or the keyboard's top: its popup's padding and a gap. */
const BELOW = 20;
/** A list never gets shorter than two options. */
const MIN_ROOM = 104;
/** With less room than three options when it opens, the page moves the field up first. */
const FEW = 156;
/** Where the field lands when the page moves it: this far below the top of what's visible. */
const FIELD_TOP = 16;

/**
 * The list's height that fits on screen, above the on-screen keyboard when there is one: the
 * visual viewport shrinks for the keyboard, while `svh` and the layout don't (plan 008). When the
 * list opens with little room under the field (the field low on the screen, or under the
 * keyboard), the page first scrolls the field near the top of what's visible, once, so the field
 * stays in view with the list under it. Null while closed.
 */
function useRoomBelow(
  list: React.RefObject<HTMLUListElement | null>,
  field: React.RefObject<HTMLInputElement | null>,
  open: boolean,
): number | null {
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const view = window.visualViewport;
    let moved = false;
    const fit = () => {
      const top = list.current?.getBoundingClientRect().top;
      const box = field.current?.getBoundingClientRect();
      if (top === undefined || !box) return;
      // What's visible, in the page's coordinates: the keyboard covers the bottom.
      const visibleTop = view ? view.offsetTop : 0;
      const visibleBottom = view ? view.offsetTop + view.height : window.innerHeight;
      const space = Math.floor(visibleBottom - top - BELOW);
      const fieldHidden = box.top < visibleTop || box.bottom > visibleBottom;
      if (!moved && (space < FEW || fieldHidden)) {
        moved = true;
        window.scrollBy({ top: box.top - visibleTop - FIELD_TOP });
        // The scroll event fits the list again.
        return;
      }
      setRoom(Math.max(MIN_ROOM, space));
    };
    fit();
    view?.addEventListener("resize", fit);
    view?.addEventListener("scroll", fit);
    window.addEventListener("scroll", fit, { passive: true });
    return () => {
      view?.removeEventListener("resize", fit);
      view?.removeEventListener("scroll", fit);
      window.removeEventListener("scroll", fit);
    };
  }, [open, list, field]);
  return open ? room : null;
}
