"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import ChannelName from "@/components/ChannelName";
import InfoTip from "@/components/InfoTip";
import LinkedRow from "@/components/LinkedRow";
import ScoreMeter from "@/components/ScoreMeter";
import SegmentedControl from "@/components/SegmentedControl";
import { getChannels, getVideos, type ListResponse } from "@/lib/api";
import { asset } from "@/lib/asset";
import { channelHref, videoHref } from "@/lib/routes";
import { useApi } from "@/lib/use-api";

/** Rows shown from each end of the ranking. */
const END = 3;

type Row = {
  key: string;
  rank: number;
  name: ReactNode;
  detail: ReactNode;
  /** Link for the second line (the channel of a video). */
  detailHref?: string;
  score: number;
  href: string;
};

/**
 * Joins the most and least stimulating items into one ranking. Ranks of the least stimulating
 * count back from `total`; items already in the top are dropped when the dataset is small.
 */
export function joinEnds<T>(
  top: ListResponse<T>,
  bottom: ListResponse<T>,
  toRow: (item: T, rank: number) => Row,
): Row[] {
  const rows = top.items.map((item, i) => toRow(item, i + 1));
  const tail = bottom.items
    .map((item, i) => toRow(item, bottom.total - i))
    .filter((row) => row.rank > rows.length)
    .reverse();
  return [...rows, ...tail];
}

async function loadVideos(): Promise<Row[]> {
  const [top, bottom] = await Promise.all([
    getVideos({ sort: "score", order: "desc", limit: END }),
    getVideos({ sort: "score", order: "asc", limit: END }),
  ]);
  return joinEnds(top, bottom, (v, rank) => ({
    key: v.id,
    rank,
    name: v.title,
    detail: <ChannelName name={v.channel} id={v.channelId} />,
    detailHref: channelHref(v.channelId),
    score: v.score,
    href: videoHref(v.id),
  }));
}

async function loadChannels(): Promise<Row[]> {
  const [top, bottom] = await Promise.all([
    getChannels({ sort: "score", order: "desc", limit: END }),
    getChannels({ sort: "score", order: "asc", limit: END }),
  ]);
  return joinEnds(top, bottom, (c, rank) => ({
    key: c.id,
    rank,
    name: <ChannelName name={c.name} id={c.id} />,
    detail: c.videoCount === 1 ? "1 video" : `${c.videoCount.toLocaleString("en-US")} videos`,
    href: channelHref(c.id),
    score: c.score,
  }));
}

type View = "videos" | "channels";

const VIEWS: Record<View, { chip: string; column: string; caption: string }> = {
  videos: {
    chip: "Videos",
    column: "Video",
    caption: "The 3 most and 3 least stimulating videos",
  },
  channels: {
    chip: "Channels",
    column: "Channel",
    caption: "The 3 most and 3 least stimulating channels",
  },
};

// Every row has room for a two-line name plus the small second line, so switching
// between videos and channels never changes the card's height. The row just above the gap
// has no line, so the gap reads as a divider rather than a row.
const ROW = "h-20";
const ROW_LINE = "border-b border-navy/10 last:border-0";

export default function RankingsCard() {
  const [view, setView] = useState<View>("videos");
  // Both lists load up front so switching views is instant.
  const videos = useApi(loadVideos);
  const channels = useApi(loadChannels);
  const state = view === "videos" ? videos : channels;

  return (
    <section
      aria-labelledby="rankings-heading"
      className="relative rounded-[2rem] border border-navy/15 bg-white px-4 py-8 sm:px-8"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative */}
      <img
        src={asset("/images/flower_2.webp")}
        alt=""
        aria-hidden="true"
        width={300}
        height={150}
        className="pointer-events-none absolute -top-14 right-8 hidden h-auto w-36 md:block"
      />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 id="rankings-heading" className="font-hand text-2xl font-semibold text-navy sm:text-3xl">
          Stimulation rankings
        </h2>
        <SegmentedControl
          label="Show ranking of"
          options={(Object.keys(VIEWS) as View[]).map((v) => ({ value: v, label: VIEWS[v].chip }))}
          value={view}
          onChange={setView}
        />
      </div>

      <p role="status" className="sr-only">
        {state.status === "loading" ? "Loading rankings…" : ""}
      </p>

      {state.status === "error" ? (
        <div className="mt-6 rounded-2xl bg-sky p-6 text-center">
          <p>We couldn’t load the rankings.</p>
          <button
            type="button"
            onClick={state.retry}
            className="mt-3 min-h-11 rounded-full border-2 border-navy px-5 font-semibold text-navy hover:bg-white"
          >
            Try again
          </button>
        </div>
      ) : state.status === "success" && state.data.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-sky p-6 text-center">No rankings yet.</p>
      ) : (
        <table
          className="mt-6 w-full table-fixed border-collapse"
          aria-busy={state.status === "loading"}
        >
          <caption className="sr-only">{VIEWS[view].caption}</caption>
          <colgroup>
            <col className="w-10 sm:w-12" />
            <col />
            <col className="w-20 sm:w-28" />
          </colgroup>
          <thead>
            <tr className="border-b border-navy/15 text-left text-sm text-ink">
              <th scope="col" className="py-2 pr-4 text-right font-semibold sm:pr-5">
                <span aria-hidden="true">#</span>
                <span className="sr-only">Rank</span>
              </th>
              <th scope="col" className="py-2 pr-4 sm:pr-6 font-semibold">
                {VIEWS[view].column}
              </th>
              <th scope="col" className="py-2 font-semibold">
                <span className="flex items-center gap-1">
                  Score
                  <InfoTip id="score-info" label="About the score" className="-my-3">
                    <p>Scores range from 0 to 100. Videos with higher scores are more stimulating.</p>
                  </InfoTip>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {state.status === "loading" ? (
              <SkeletonRows />
            ) : (
              <RankRows rows={state.data} />
            )}
          </tbody>
        </table>
      )}

      <Link
        href={view === "videos" ? "/rankings" : "/rankings?view=channels"}
        className="mt-6 inline-flex min-h-11 items-center font-bold text-navy underline decoration-2 underline-offset-4 hover:decoration-sunny"
      >
        See full rankings&nbsp;<span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}

/**
 * Marks where the least stimulating end of the ranking starts: a quiet divider between dotted
 * rules, without row lines, so it doesn't look like a row to click (plan 002).
 */
function GapRow() {
  return (
    <tr className="h-9">
      <td colSpan={3} className="text-sm text-ink/80">
        <span className="flex items-center gap-2.5 before:flex-1 before:border-t-2 before:border-dotted before:border-navy/20 after:flex-1 after:border-t-2 after:border-dotted after:border-navy/20">
          Least stimulating
        </span>
      </td>
    </tr>
  );
}

/**
 * Rows after a gap in the ranking count back from the end (−3, −2, −1); without a gap
 * (small dataset), every row shows its plain rank.
 */
function RankRows({ rows }: { rows: Row[] }) {
  const gapAt = rows.findIndex((row, i) => i > 0 && row.rank > rows[i - 1].rank + 1);
  const last = rows.at(-1)?.rank ?? 0;
  return rows.map((row, i) => {
    const fromEnd = gapAt > 0 && i >= gapAt ? last - row.rank + 1 : undefined;
    return [
      i === gapAt && <GapRow key="gap" />,
      <RankRow key={row.key} row={row} fromEnd={fromEnd} line={i !== gapAt - 1} />,
    ];
  });
}

/** "3rd", for the screen-reader text of ranks counted from the end. */
function ordinal(n: number): string {
  return n === 1 ? "" : n === 2 ? "2nd " : n === 3 ? "3rd " : `${n}th `;
}

function SkeletonRows() {
  const bar = "block animate-pulse rounded bg-gray-200";
  const row = (i: number) => (
    <tr key={i} className={i === 2 ? ROW : `${ROW} ${ROW_LINE}`}>
      <td className="pr-4 sm:pr-5">
        <span className={`${bar} ml-auto h-4 w-4`} />
      </td>
      <td className="pr-4 sm:pr-6">
        <span className={`${bar} h-4 w-4/5`} />
        <span className={`${bar} mt-2 h-3 w-2/5`} />
      </td>
      <td>
        <span className={`${bar} h-4 w-16`} />
      </td>
    </tr>
  );
  return (
    <>
      {[0, 1, 2].map(row)}
      <GapRow />
      {[3, 4, 5].map(row)}
    </>
  );
}

function RankRow({ row, fromEnd, line }: { row: Row; fromEnd?: number; line: boolean }) {
  const warn = row.rank <= END;
  return (
    <LinkedRow href={row.href} className={line ? `${ROW} ${ROW_LINE}` : ROW}>
      {/* Ranks 1–3 may get warning-triangle art behind the number later (plan 002). */}
      <td
        className={`pr-4 text-right align-middle text-sm font-bold tabular-nums sm:pr-5 sm:text-base ${warn ? "text-navy" : "text-ink"}`}
      >
        {fromEnd ? (
          <>
            <span aria-hidden="true">−{fromEnd}</span>
            <span className="sr-only">{`${ordinal(fromEnd)}least stimulating`}</span>
          </>
        ) : (
          row.rank.toLocaleString("en-US")
        )}
      </td>
      <td className="relative pr-4 align-middle sm:pr-6">
        {/* The name's link covers its cell; the second line's link sits above it. */}
        <Link
          href={row.href}
          className="line-clamp-2 font-semibold text-navy after:absolute after:inset-0 hover:underline"
        >
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
      </td>
      <td className="align-middle">
        <ScoreMeter score={row.score} />
      </td>
    </LinkedRow>
  );
}
