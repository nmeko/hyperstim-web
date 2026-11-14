"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { formatDate, measureName, pointOf, type Measure } from "@/components/channel/chart";
import ScoreMeter from "@/components/ScoreMeter";
import type { ChannelVideo } from "@/lib/api";
import { videoHref } from "@/lib/routes";
import { Badge } from "./parts";
import type { Side } from "./state";

/**
 * The video tapped on the compare chart, on phones: a small card right under the chart, so the
 * finger doesn't cover it and the chart stays in view. Its title links to the video's page.
 */
export default function PickedVideo({
  side,
  channel,
  video,
  measure,
  onClose,
}: {
  side: Side;
  channel: string;
  video: ChannelVideo;
  measure: Measure;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  // Into view if it's below the screen; the chart above stays where it is otherwise.
  useEffect(() => card.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), [video.id]);
  const point = pointOf(video, measure);
  return (
    <div
      ref={card}
      role="region"
      aria-label="Picked video"
      aria-live="polite"
      className="relative mt-4 rounded-2xl bg-sky p-4 pr-12"
      data-picked=""
    >
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-navy">
        <Badge side={side} decorative />
        <span className="truncate">{channel}</span>
      </p>
      <p className="mt-2 font-hand text-lg leading-snug font-semibold text-navy">
        <Link
          href={videoHref(video.id)}
          className="line-clamp-2 underline decoration-navy/30 decoration-2 underline-offset-4 hover:decoration-navy"
        >
          {video.title}
        </Link>
      </p>
      <p className="mt-1 text-sm text-ink">{formatDate(video.publishedAt)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-navy">{measureName(measure)}</span>
        {point.kind === "value" ? (
          <ScoreMeter score={point.value} size="compact" />
        ) : (
          <span className="text-sm text-ink/80">{point.text}</span>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-1.5 right-1.5 flex size-11 items-center justify-center rounded-full text-navy hover:bg-white"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 fill-none stroke-current stroke-2">
          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
