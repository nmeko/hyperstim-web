"use client";

import Link from "next/link";
import { useEffect, useRef, type Ref } from "react";
import ChannelName from "@/components/ChannelName";
import { metaLine } from "@/components/channel/chart";
import LiveAnalysis from "@/components/video/LiveAnalysis";
import { OUTLINED_BUTTON } from "@/components/video/parts";
import { VideoGoneNote } from "@/components/VideoGoneNote";
import YouTubePlayer, { type PlayerHandle } from "@/components/YouTubePlayer";
import { ApiError } from "@/lib/api";
import { channelHref, videoHref } from "@/lib/routes";
import type { ApiState } from "@/lib/use-api";
import { INVALID_ID, type Item } from "./items";
import { Badge } from "./parts";
import Picker from "./Picker";
import type { Side, View } from "./state";

/** Where focus goes after a change: into the picker, or onto the filled slot. */
export type FocusRequest = { side: Side; to: "picker" | "slot"; n: number } | null;

/**
 * One side of the comparison (see STYLE.md, Compare slot): the picker while empty, else the
 * item's header, or its loading, live check or error state, with × to empty it again.
 */
export default function Slot({
  side,
  view,
  id,
  otherId,
  result,
  onPick,
  onClear,
  focus,
  announce,
  player,
  onPlay,
}: {
  side: Side;
  view: View;
  id: string;
  otherId: string;
  result: ApiState<Item | null> & { stale: boolean; retry: () => void };
  onPick: (id: string) => void;
  onClear: () => void;
  focus: FocusRequest;
  announce: (text: string) => void;
  player: Ref<PlayerHandle>;
  onPlay: () => void;
}) {
  const box = useRef<HTMLElement>(null);
  const noun = view === "videos" ? "video" : "channel";
  const heading = `${noun === "video" ? "Video" : "Channel"} ${side.toUpperCase()}`;

  const focusSlot = focus?.side === side && focus.to === "slot" ? focus.n : null;
  useEffect(() => {
    if (focusSlot !== null) box.current?.focus({ preventScroll: true });
  }, [focusSlot]);

  const remove = (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Remove ${noun} ${side.toUpperCase()}`}
      className="-my-2.5 -mr-2.5 flex size-11 items-center justify-center rounded-full text-navy hover:bg-sky"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 fill-none stroke-current stroke-2">
        <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
      </svg>
    </button>
  );

  let body;
  if (!id) {
    body = (
      <Picker
        side={side}
        view={view}
        otherId={otherId}
        onPick={onPick}
        autoFocus={focus?.side === side && focus.to === "picker"}
      />
    );
  } else if (result.status === "loading" || result.stale) {
    body = <Skeleton view={view} />;
  } else if (result.status === "error") {
    const status = result.error instanceof ApiError ? result.error.status : null;
    const missing = status === 404 || status === INVALID_ID;
    body =
      view === "videos" && status === 404 ? (
        <LiveAnalysis id={id} onDone={result.retry} announce={announce} compact />
      ) : (
        <div className="rounded-2xl bg-sky p-4 text-center sm:p-5">
          <p>{missing ? `We couldn’t find this ${noun}.` : `We couldn’t load this ${noun}.`}</p>
          {!missing && (
            <button type="button" onClick={result.retry} className={`mt-3 ${OUTLINED_BUTTON} text-sm`}>
              Try again
            </button>
          )}
        </div>
      );
  } else if (result.data) {
    body = <Header item={result.data} player={player} onPlay={onPlay} />;
  }

  return (
    <section ref={box} tabIndex={-1} aria-labelledby={`slot-${side}`} className="min-w-0 focus:outline-none">
      <h2 id={`slot-${side}`} className="sr-only">
        {heading}
      </h2>
      {/* The picker's label carries the badge; a filled slot shows it above its item, with × at the right. */}
      {id && (
        <div className="mb-2 flex items-center justify-between">
          <Badge side={side} decorative large />
          {remove}
        </div>
      )}
      {body}
    </section>
  );
}

/** A filled slot: the video's preview and linked title, or the channel's linked name. */
function Header({ item, player, onPlay }: { item: Item; player: Ref<PlayerHandle>; onPlay: () => void }) {
  if (item.kind === "video") {
    const { video } = item;
    return (
      <div>
        <YouTubePlayer id={video.id} title={video.title} ref={player} onPlay={onPlay} />
        <VideoGoneNote id={video.id} />
        <Link
          href={videoHref(video.id)}
          className="mt-3 line-clamp-3 font-hand text-lg leading-snug font-semibold text-navy hover:underline"
        >
          {video.title}
        </Link>
        <p className="mt-1 truncate text-sm text-ink">
          <ChannelName name={video.channel} id={video.channelId} />
        </p>
      </div>
    );
  }
  const { channel } = item;
  return (
    <div>
      <Link
        href={channelHref(channel.id)}
        className="line-clamp-2 font-hand text-xl leading-snug font-semibold text-navy hover:underline sm:text-2xl"
      >
        <ChannelName name={channel.name} id={channel.id} />
      </Link>
      <p className="mt-1 text-sm text-ink">{metaLine(channel.videos)}</p>
    </div>
  );
}

function Skeleton({ view }: { view: View }) {
  const bar = "block animate-pulse rounded bg-gray-200";
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Loading {view === "videos" ? "video" : "channel"}…
      </p>
      {view === "videos" && <div className="aspect-video w-full animate-pulse rounded-2xl bg-gray-200" />}
      <span className={`${bar} mt-3 h-6 w-4/5`} />
      <span className={`${bar} mt-2 h-4 w-1/2`} />
    </div>
  );
}
