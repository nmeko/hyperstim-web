"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ScoreMeter from "@/components/ScoreMeter";
import type { ChannelVideo } from "@/lib/api";
import { videoHref } from "@/lib/routes";
import { Thumbnail } from "@/components/Thumbnail";
import { formatDate, pointOf, type Measure } from "./chart";

/** Share of the strip's width the ‹ › buttons scroll by. */
const PAGE = 0.8;

/**
 * Phones: the channel's videos as a horizontal scroller of cards in date order, each linking to
 * the video's page (see STYLE.md, Video strip). `onVisible` gets the range of cards in view (for
 * the chart's band); the `marked` card is scrolled into view and highlighted.
 */
export default function VideoStrip({
  videos,
  measure,
  marked,
  onVisible,
}: {
  videos: ChannelVideo[];
  measure: Measure;
  marked: string | null;
  onVisible: (range: [number, number]) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [ends, setEnds] = useState({ atStart: true, atEnd: true });

  const update = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const { scrollLeft, clientWidth, scrollWidth } = el;
    setEnds({ atStart: scrollLeft <= 1, atEnd: scrollLeft + clientWidth >= scrollWidth - 1 });
    const cards = [...el.children] as HTMLElement[];
    const inView = cards.flatMap((card, i) => {
      const left = card.offsetLeft - scrollLeft;
      return left + card.offsetWidth > 0 && left < clientWidth ? [i] : [];
    });
    if (inView.length) onVisible([inView[0], inView[inView.length - 1]]);
  }, [onVisible]);

  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update]);

  // A tapped dot scrolls its card to the start.
  useEffect(() => {
    const el = list.current;
    const card = marked ? el?.querySelector<HTMLElement>(`[data-card="${marked}"]`) : null;
    if (!el || !card) return;
    el.scrollTo?.({ left: card.offsetLeft - Number.parseFloat(getComputedStyle(el).paddingLeft || "0"), behavior: scrollBehavior() });
  }, [marked]);

  const page = (direction: 1 | -1) => {
    const el = list.current;
    el?.scrollBy?.({ left: direction * PAGE * el.clientWidth, behavior: scrollBehavior() });
  };

  const count = videos.length === 1 ? "The 1 video we measured" : `The ${videos.length} videos we measured`;
  const arrow = "flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-navy text-navy disabled:border-navy/20 disabled:text-navy/30";
  return (
    <section aria-labelledby="strip-heading" className="mt-6">
      <div className="flex items-center justify-between gap-2">
        <h3 id="strip-heading" className="font-hand text-lg leading-tight font-semibold text-navy">
          {count}
        </h3>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => page(-1)} disabled={ends.atStart} className={arrow}>
            <Chevron left />
            <span className="sr-only">Older videos</span>
          </button>
          <button type="button" onClick={() => page(1)} disabled={ends.atEnd} className={arrow}>
            <Chevron />
            <span className="sr-only">Newer videos</span>
          </button>
        </div>
      </div>
      <ol
        ref={list}
        onScroll={update}
        className="relative -mx-4 mt-2 flex snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 pb-2"
      >
        {videos.map((video, i) => {
          const year = video.publishedAt.slice(0, 4);
          const firstOfYear = i === 0 || videos[i - 1].publishedAt.slice(0, 4) !== year;
          const point = pointOf(video, measure);
          return (
            <li key={video.id} data-card={video.id} className="w-40 shrink-0 snap-start pr-3">
              {/* The timeline: a dot per video, the year at its first one. */}
              <div aria-hidden="true" className="relative flex h-6 items-center">
                <span className="absolute inset-x-0 -right-3 border-t border-navy/20" />
                {firstOfYear ? (
                  <span className="relative bg-white pr-1.5 text-xs font-bold text-navy">{year}</span>
                ) : (
                  <span className="relative ml-2 size-1.5 rounded-full bg-navy/40" />
                )}
              </div>
              <Link
                href={videoHref(video.id)}
                className={`-mx-1.5 mt-1 block rounded-2xl p-1.5 ${video.id === marked ? "bg-sky" : ""}`}
              >
                <Thumbnail
                  id={video.id}
                  size="mq"
                  loading="lazy"
                  width={320}
                  height={180}
                  className="aspect-video w-full rounded-xl bg-navy/10 object-cover"
                />
                <span className="mt-1.5 block text-xs text-ink">{formatDate(video.publishedAt)}</span>
                <span className="mt-0.5 line-clamp-2 text-sm leading-snug font-semibold text-navy">{video.title}</span>
                <span className="mt-1 block">
                  {point.kind === "value" ? (
                    <ScoreMeter score={point.value} size="compact" />
                  ) : (
                    <span className="text-sm text-ink/80">{point.text}</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function scrollBehavior(): ScrollBehavior {
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduce ? "auto" : "smooth";
}

function Chevron({ left = false }: { left?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`size-4 ${left ? "rotate-180" : ""}`}>
      <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}
