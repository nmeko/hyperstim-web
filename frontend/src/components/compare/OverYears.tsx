"use client";

import { useState } from "react";
import { formatDate, measureName, pointOf, pointText, type Measure } from "@/components/channel/chart";
import { SECTION_CARD } from "@/components/channel/OverYears";
import MeasurementPicker from "@/components/MeasurementPicker";
import type { ChannelDetail } from "@/lib/api";
import { SM_UP, useMediaQuery } from "@/lib/use-layout";
import VideoPanel from "@/components/channel/VideoPanel";
import CompareChart, { videoKey } from "./CompareChart";
import PickedVideo from "./PickedVideo";
import { Badge } from "./parts";
import type { Side } from "./state";

/** Both channels over the years, one measurement at a time, on one chart. */
export default function CompareYears({ channels }: { channels: Record<Side, ChannelDetail> }) {
  const wide = useMediaQuery(SM_UP);
  const [measure, setMeasure] = useState<Measure>("overall");
  // The video opened from the chart, as `a-<id>`: in the panel from sm, in a small card on phones.
  const [marked, setMarked] = useState<string | null>(null);
  const rows = (["a", "b"] as const).flatMap((side) => channels[side].videos.map((video) => ({ side, video })));
  rows.sort((p, q) => p.video.publishedAt.localeCompare(q.video.publishedAt));
  const opened = rows.find((r) => videoKey(r.side, r.video.id) === marked);
  const close = () => {
    const key = marked;
    setMarked(null);
    document.getElementById(`thumb-${key}`)?.focus();
  };

  return (
    <section aria-labelledby="years-heading" className={`mt-8 ${SECTION_CARD}`}>
      <h2 id="years-heading" className="font-hand text-2xl font-semibold text-navy sm:text-3xl">
        Over the years
      </h2>
      <MeasurementPicker value={measure} onChange={setMeasure} wide={wide} />

      <ul aria-hidden="true" className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink" data-legend="">
        {(["a", "b"] as const).map((side) => (
          <li key={side} className="flex min-w-0 items-center gap-2">
            <Badge side={side} />
            <span className="truncate font-semibold text-navy">{channels[side].name}</span>
            <svg viewBox="0 0 32 8" className="h-2 w-8 shrink-0">
              <line
                x1="1"
                x2="31"
                y1="4"
                y2="4"
                strokeWidth="2.5"
                strokeDasharray={side === "b" ? "7 5" : undefined}
                className="stroke-navy"
              />
            </svg>
          </li>
        ))}
      </ul>

      {/* In a box: a table ignores sr-only's 1 px width and would widen the page. */}
      <div className="sr-only">
        <table>
          <caption>
            {channels.a.name} (A) and {channels.b.name} (B): videos over the years
          </caption>
          <thead>
            <tr>
              <th scope="col">Published</th>
              <th scope="col">Channel</th>
              <th scope="col">Video</th>
              <th scope="col">{measureName(measure)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ side, video }) => (
              <tr key={`${side}-${video.id}`}>
                <td>{formatDate(video.publishedAt)}</td>
                <td>{side.toUpperCase()}</td>
                <td>{video.title}</td>
                <td>{pointText(pointOf(video, measure))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CompareChart channels={channels} measure={measure} wide={wide} marked={marked} onOpen={setMarked} />
      {opened &&
        (wide ? (
          <VideoPanel
            key={marked}
            video={opened.video}
            measure={measure}
            label={
              <p className="mb-2 flex min-w-0 items-center gap-2 text-sm font-semibold text-navy">
                <Badge side={opened.side} decorative />
                <span className="truncate">{channels[opened.side].name}</span>
              </p>
            }
            onClose={close}
          />
        ) : (
          <PickedVideo
            side={opened.side}
            channel={channels[opened.side].name}
            video={opened.video}
            measure={measure}
            onClose={() => setMarked(null)}
          />
        ))}
    </section>
  );
}
