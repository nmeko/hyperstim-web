"use client";

import { useRef, useState } from "react";
import ScoreMeter from "@/components/ScoreMeter";
import type { ChannelVideo } from "@/lib/api";
import { useWidth } from "@/lib/use-layout";
import { Thumbnail } from "@/components/Thumbnail";
import { VIDEO_GONE } from "@/components/VideoGoneNote";
import { useThumbnailGone } from "@/lib/thumbnails";
import { ChartGrid, TimeAxis } from "./ChartAxes";
import {
  formatDate,
  LABELS,
  measureName,
  monotonePath,
  placeThumbs,
  stackShifts,
  pointOf,
  smooth,
  timeScale,
  TOP,
  yearRange,
  type Measure,
} from "./chart";

// Layout in px (the plot's margins are in chart.ts).
const CROSS = 4; // half the size of a "No cuts" ×
const CROSS_LIFT = 7; // the × sits this far above the 0 line, so the line doesn't cut it
const THUMB_W = 64;
const THUMB_H = 36;
const THUMB_GAP = 6; // between thumbnails in a row
const ROW_PITCH = 10; // rows overlap like a fanned deck
const FOCUS_NUDGE = 8; // the focused thumbnail drops this far
const FOCUS_OPEN = THUMB_H + 16; // and the ones below it in its stack slide down this far

/**
 * One channel's videos over the years (see STYLE.md, Over-years chart): a dot per video at its
 * publish date (a × just above the 0 line for no cuts), a smoothed trend
 * line, and (when `wide`) each video's thumbnail hanging from its date under the axis. The size
 * and the axis stay the same for every measurement. Clicking a dot or thumbnail calls `onOpen`.
 * `marked` is the opened (or tapped) video; `band` is the range of videos to highlight, as indexes
 * into `videos`.
 */
export default function TimeChart({
  videos,
  measure,
  wide,
  marked,
  band,
  onOpen,
}: {
  videos: ChannelVideo[];
  measure: Measure;
  wide: boolean;
  marked: string | null;
  band: [number, number] | null;
  onOpen: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box, 640);
  const [hovered, setHovered] = useState<string | null>(null);

  const scale = timeScale(width, wide, ...yearRange(videos));
  const { x, y, axisY } = scale;

  const points = videos.map((video) => ({ video, point: pointOf(video, measure), cx: x(video.publishedAt) }));
  const dots = points.flatMap(({ video, point, cx }) => {
    if (point.kind === "missing") return [];
    const cy = point.kind === "value" ? y(point.value) : y(0) - CROSS_LIFT;
    return [{ video, point, cx, cy }];
  });
  // A video the measurement doesn't apply to stays out of the trend.
  const valued = dots.flatMap((d) => (d.point.kind === "value" ? [{ cx: d.cx, value: d.point.value }] : []));
  const trend = smooth(valued.map((d) => d.value));
  const trendPath = monotonePath(trend.map((value, i) => [valued[i].cx, y(value)]));

  // The hovered video, or on phones the tapped one, gets the popover.
  const active = hovered ?? (wide ? null : marked);
  const isMarked = (id: string) => id === active || id === marked;

  const thumbs = wide ? placeThumbs(points.map((p) => p.cx), width, THUMB_W, THUMB_GAP) : [];
  const rows = thumbs.reduce((n, t) => Math.max(n, t.row + 1), 0);
  // The hovered thumbnail, else the opened one, stands out of its stack.
  const focusId = hovered ?? marked;
  const focus = points.findIndex((p) => p.video.id === focusId);
  const shifts = stackShifts(thumbs, focus === -1 ? null : focus, THUMB_W, FOCUS_NUDGE, FOCUS_OPEN);
  const thumbsTop = axisY + LABELS;
  const thumbTop = (i: number) => thumbsTop + thumbs[i].row * ROW_PITCH + shifts[i].dy;
  // Room for a stack to open below its last row, so nothing under the chart moves on hover.
  const height = rows ? thumbsTop + (rows - 1) * ROW_PITCH + THUMB_H + FOCUS_OPEN : axisY + LABELS;
  const activeDot = dots.find((d) => d.video.id === active);
  const activePoint = points.find((p) => p.video.id === active);

  const hover = (id: string | null) => (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") setHovered(id);
  };

  return (
    <div ref={box} className="relative mt-6" data-chart="">
      <svg aria-hidden="true" width={width} height={height} className="block overflow-visible">
        <ChartGrid scale={scale} />
        {band && (
          <rect
            data-band=""
            x={x(videos[band[0]].publishedAt) - 6}
            width={Math.max(12, x(videos[band[1]].publishedAt) - x(videos[band[0]].publishedAt) + 12)}
            y={TOP - 4}
            height={axisY - TOP + 4}
            className="fill-sunny/25"
          />
        )}

        {/* Lines from each date down to its thumbnail; the marked one on top. */}
        {[...thumbs.keys()]
          .sort((a, b) => Number(isMarked(points[a].video.id)) - Number(isMarked(points[b].video.id)))
          .map((i) => {
            const on = isMarked(points[i].video.id);
            return (
              <line
                key={points[i].video.id}
                x1={points[i].cx}
                y1={axisY}
                x2={thumbs[i].left + THUMB_W / 2}
                y2={thumbTop(i) + 2}
                strokeWidth={on ? 2 : 1}
                className={on ? "stroke-navy" : "stroke-navy/20"}
              />
            );
          })}

        <TimeAxis scale={scale} />

        {activeDot && (
          <line
            x1={activeDot.cx}
            x2={activeDot.cx}
            y1={axisY}
            y2={activeDot.cy}
            strokeDasharray="3 3"
            className="stroke-navy/50"
          />
        )}

        {/* Fades in again when the measurement changes (none with reduced motion). */}
        <g key={measure} className="motion-safe:animate-fade-in">
          {trendPath && <path d={trendPath} fill="none" strokeWidth={2.5} className="stroke-navy" data-trend="" />}
          {dots.map(({ video, point, cx, cy }) => {
            const on = isMarked(video.id);
            if (point.kind === "na") {
              const d = CROSS + (on ? 1.5 : 0);
              return (
                <path
                  key={video.id}
                  d={`M ${cx - d} ${cy - d} L ${cx + d} ${cy + d} M ${cx + d} ${cy - d} L ${cx - d} ${cy + d}`}
                  strokeWidth={on ? 2.75 : 2}
                  strokeLinecap="round"
                  className={on ? "stroke-navy" : "stroke-navy/60"}
                  data-dot={video.id}
                  data-mark="na"
                />
              );
            }
            return (
              <circle
                key={video.id}
                cx={cx}
                cy={cy}
                r={on ? 7 : 4.5}
                className={on ? "fill-navy" : "fill-navy/50"}
                data-dot={video.id}
              />
            );
          })}
        </g>
        {/* Pointer targets, ~24 px; keyboard users have the thumbnails (or the strip's cards). */}
        {dots.map(({ video, cx, cy }) => (
          <circle
            key={video.id}
            cx={cx}
            cy={cy}
            r={12}
            fill="transparent"
            className="cursor-pointer"
            data-hit={video.id}
            onPointerEnter={hover(video.id)}
            onPointerLeave={hover(null)}
            onClick={() => onOpen(video.id)}
          />
        ))}
      </svg>

      {thumbs.map(({ left, row }, i) => {
        const { video } = points[i];
        const on = isMarked(video.id);
        const { front } = shifts[i];
        return (
          <button
            key={video.id}
            id={`thumb-${video.id}`}
            type="button"
            aria-label={`${video.title}, ${formatDate(video.publishedAt)}`}
            aria-current={video.id === marked ? "true" : undefined}
            onClick={() => onOpen(video.id)}
            onPointerEnter={hover(video.id)}
            onPointerLeave={hover(null)}
            onFocus={() => setHovered(video.id)}
            onBlur={() => setHovered(null)}
            // Later rows lie on top of earlier ones; the focused thumbnail on top of all.
            style={{ left, top: thumbTop(i), width: THUMB_W, height: THUMB_H, zIndex: front ? rows + 1 : row }}
            className={`absolute overflow-hidden rounded bg-navy/10 ring-2 transition-[top,scale] duration-200 ease-out motion-reduce:transition-none ${front ? "scale-108" : ""} ${on ? "ring-navy" : "ring-white"}`}
          >
            <Thumbnail id={video.id} size="mq" loading="lazy" width={THUMB_W} height={THUMB_H} className="size-full object-cover" />
          </button>
        );
      })}

      {activePoint && (
        <Popover
          video={activePoint.video}
          measure={measure}
          x={activePoint.cx}
          y={activeDot?.cy ?? axisY}
          width={width}
        />
      )}
    </div>
  );
}

const POPOVER_W = 256;

/** The hovered (or tapped) video: title, date and value, above its dot (below near the top). */
function Popover({
  video,
  measure,
  x,
  y,
  width,
}: {
  video: ChannelVideo;
  measure: Measure;
  x: number;
  y: number;
  width: number;
}) {
  const point = pointOf(video, measure);
  const gone = useThumbnailGone(video.id);
  const left = Math.min(Math.max(x - POPOVER_W / 2, 0), Math.max(0, width - POPOVER_W));
  const below = y < 110;
  return (
    <div
      aria-hidden="true"
      data-popover=""
      style={below ? { left, top: y + 14 } : { left, bottom: `calc(100% - ${y - 14}px)` }}
      className="pointer-events-none absolute z-[100] w-64 max-w-full rounded-2xl border border-navy/15 bg-white px-4 py-3 text-sm text-ink shadow-[0_4px_16px_rgb(15_46_138/0.08)]"
    >
      <p className="line-clamp-2 font-semibold text-navy">“{video.title}”</p>
      <p className="mt-1">{formatDate(video.publishedAt)}</p>
      {point.kind === "value" ? (
        <p className="mt-1 flex items-center gap-1">
          {measureName(measure)}:
          <ScoreMeter score={point.value} size="compact" />
        </p>
      ) : (
        <p className="mt-1">{point.text}</p>
      )}
      {gone && <p className="mt-2 text-ink/80">{VIDEO_GONE}</p>}
    </div>
  );
}
