"use client";

import { useCallback, useState } from "react";
import { channelLabel } from "@/components/ChannelName";
import type { ChannelDetail } from "@/lib/api";
import { SM_UP, useMediaQuery } from "@/lib/use-layout";
import { formatDate, measureName, pointOf, pointText, type Measure } from "./chart";
import MeasurementPicker from "@/components/MeasurementPicker";
import TimeChart from "./TimeChart";
import VideoPanel from "./VideoPanel";
import VideoStrip from "./VideoStrip";

export const SECTION_CARD = "rounded-[2rem] border border-navy/15 bg-white px-4 py-8 sm:px-8";

/**
 * How the channel's videos scored over the years, one measurement at a time. From `sm` a click
 * opens a video in the panel under the chart; on phones the strip of cards links to the videos.
 */
export default function OverYears({ channel }: { channel: ChannelDetail }) {
  const wide = useMediaQuery(SM_UP);
  const [measure, setMeasure] = useState<Measure>("overall");
  // The video opened in the panel (from sm), or tapped on the chart (phones).
  const [marked, setMarked] = useState<string | null>(null);
  const [band, setBand] = useState<[number, number] | null>(null);
  const onVisible = useCallback((range: [number, number]) => {
    setBand((old) => (old?.[0] === range[0] && old?.[1] === range[1] ? old : range));
  }, []);

  const { videos } = channel;
  const opened = wide ? videos.find((v) => v.id === marked) : undefined;
  const missing = videos.filter((v) => pointOf(v, measure).kind === "missing").length;
  // Audio intensity is missing only for clips without sound.
  const missingNote = measure === "lufs" ? "without sound" : "not measured";

  const close = () => {
    const id = marked;
    setMarked(null);
    document.getElementById(`thumb-${id}`)?.focus();
  };

  return (
    <section aria-labelledby="years-heading" className={`mt-8 ${SECTION_CARD}`}>
      <h2 id="years-heading" className="font-hand text-2xl font-semibold text-navy sm:text-3xl">
        How it changed over years?
      </h2>
      <MeasurementPicker value={measure} onChange={setMeasure} wide={wide} />

      {/* In a box: a table ignores sr-only's 1 px width and would widen the page. */}
      <div className="sr-only">
        <table>
          <caption>{channelLabel(channel.name, channel.id)}’s videos over the years</caption>
          <thead>
            <tr>
              <th scope="col">Published</th>
              <th scope="col">Video</th>
              <th scope="col">{measureName(measure)}</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((video) => (
              <tr key={video.id}>
                <td>{formatDate(video.publishedAt)}</td>
                <td>{video.title}</td>
                <td>{pointText(pointOf(video, measure))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TimeChart
        videos={videos}
        measure={measure}
        wide={wide}
        marked={marked}
        band={wide ? null : band}
        onOpen={setMarked}
      />
      {missing > 0 && (
        <p className="mt-3 text-center text-sm text-ink/80">
          {missing === 1 ? "1 video" : `${missing} videos`} {missingNote}
        </p>
      )}
      {opened && <VideoPanel key={opened.id} video={opened} measure={measure} onClose={close} />}
      {!wide && <VideoStrip videos={videos} measure={measure} marked={marked} onVisible={onVisible} />}
    </section>
  );
}
