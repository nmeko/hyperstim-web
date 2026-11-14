"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import SegmentedControl from "@/components/SegmentedControl";
import type { PlayerHandle } from "@/components/YouTubePlayer";
import { asset } from "@/lib/asset";
import { compareHref } from "@/lib/routes";
import { useApi } from "@/lib/use-api";
import { itemName, loadItem, type Item } from "./items";
import CompareYears from "./OverYears";
import Comparison from "./Comparison";
import Slot, { type FocusRequest } from "./Slot";
import { parseState, type CompareState, type Side, type View } from "./state";

// The compare page (plan 008): two videos, or two channels, and where they differ.

const CONTAINER = "mx-auto max-w-6xl px-4 pt-8 sm:px-6 md:pt-12 lg:px-8";
const INTRO: Record<View, string> = {
  videos: "Put two videos side by side and see where their production differs.",
  channels: "Put two channels side by side and see where their production differs.",
};

function useItem(view: View, id: string) {
  const load = useCallback(() => loadItem(view, id), [view, id]);
  return useApi(load);
}

/** `/compare`: reads its state from the URL on the client. */
export default function ComparePage() {
  const params = useSearchParams();
  const router = useRouter();
  const state = useMemo(() => parseState(params), [params]);
  const { view } = state;
  const results = { a: useItem(view, state.a), b: useItem(view, state.b) };
  const [focus, setFocus] = useState<FocusRequest>(null);
  // Live check step changes in either slot, read out by screen readers.
  const [announcement, setAnnouncement] = useState("");

  const go = (next: CompareState) => router.push(compareHref(next), { scroll: false });
  const pick = (side: Side) => (id: string) => {
    go({ ...state, [side]: id });
    setFocus((f) => ({ side, to: "slot", n: (f?.n ?? 0) + 1 }));
  };
  const clear = (side: Side) => () => {
    go({ ...state, [side]: "" });
    setFocus((f) => ({ side, to: "picker", n: (f?.n ?? 0) + 1 }));
  };

  // One sound at a time: when one video starts, the other pauses.
  const players = { a: useRef<PlayerHandle>(null), b: useRef<PlayerHandle>(null) };
  const { a: playerA, b: playerB } = players;
  const onPlay = {
    a: useCallback(() => playerB.current?.pause(), [playerB]),
    b: useCallback(() => playerA.current?.pause(), [playerA]),
  };

  const ready = (side: Side): Item | null => {
    const r = results[side];
    return r.status === "success" && !r.stale ? r.data : null;
  };
  const a = ready("a");
  const b = ready("b");
  const both = a && b && a.kind === b.kind ? { a, b } : null;

  const title = both ? `${itemName(both.a)} vs ${itemName(both.b)} - HyperStim?` : "Compare - HyperStim?";
  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <div className={CONTAINER}>
      <Hero view={view}>
        <SegmentedControl
          label="Compare"
          options={[
            { value: "videos", label: "Videos" },
            { value: "channels", label: "Channels" },
          ]}
          value={view}
          onChange={(next) => next !== view && go({ view: next, a: "", b: "" })}
          className="mt-5"
        />
      </Hero>

      <div className="mt-8 rounded-[2rem] border border-navy/15 bg-white px-4 py-8 sm:px-8 md:mt-0">
        {/*
          Two items side by side at every width, so both stay in view; pickers stack below `md`.
          "vs." sits between them: level with the fields while picking, centred once both are in.
        */}
        <div
          className={
            both
              ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-2 sm:gap-x-6"
              : "grid gap-y-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-x-6"
          }
        >
          {(["a", "b"] as const).flatMap((side) => [
            ...(side === "b"
              ? [
                  <p
                    key="vs"
                    aria-hidden="true"
                    className={`justify-self-center text-lg text-ink ${both ? "self-center" : "md:mt-14 md:self-start"}`}
                  >
                    vs.
                  </p>,
                ]
              : []),
            <Slot
              key={`${view}-${side}`}
              side={side}
              view={view}
              id={state[side]}
              otherId={state[side === "a" ? "b" : "a"]}
              result={results[side]}
              onPick={pick(side)}
              onClear={clear(side)}
              focus={focus}
              announce={setAnnouncement}
              player={players[side]}
              onPlay={onPlay[side]}
            />,
          ])}
        </div>
        {both && (
          <div className="mt-8 border-t border-navy/10 pt-8">
            <Comparison a={both.a} b={both.b} />
          </div>
        )}
      </div>

      {both?.a.kind === "channel" && both.b.kind === "channel" && (
        <CompareYears channels={{ a: both.a.channel, b: both.b.channel }} />
      )}

      {!state.a && !state.b && (
        <p className="mt-4 text-center text-sm text-ink/80">
          Not sure where to start?{" "}
          <Link
            href={view === "channels" ? "/rankings?view=channels" : "/rankings"}
            className="font-bold text-navy underline decoration-2 underline-offset-4 hover:decoration-sunny"
          >
            Browse the rankings&nbsp;<span aria-hidden="true">→</span>
          </Link>
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

/**
 * The H1, intro and `children` (the view control), and the kid with two cards on the card's top
 * edge. The kid's head is as large as on the other pages (plan 001), so it's taller than the text; it
 * rises above the text's top instead of pushing the H1 down.
 */
function Hero({ view, children }: { view: View; children?: ReactNode }) {
  return (
    <div className="relative md:pr-[16.5rem] lg:pr-[20rem] xl:pr-[23rem]">
      <div className="md:pb-6">
        <h1 className="font-hand text-[2rem] leading-tight font-semibold text-navy sm:text-[2.75rem] lg:text-[3.25rem]">
          Compare
        </h1>
        <p className="mt-3 max-w-prose text-lg">{INTRO[view]}</p>
        {children}
      </div>
      {/* Sitting on the card's border: the art's bottom 3 % is empty, so it moves down a little more. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, images pre-converted */}
      <img
        src={asset("/images/kid_compare.webp")}
        alt=""
        aria-hidden="true"
        width={624}
        height={416}
        data-kid=""
        className="pointer-events-none absolute right-0 bottom-0 z-10 hidden h-auto w-58 translate-y-[7%] md:mr-4 md:block lg:mr-8 lg:w-66 xl:w-78"
      />
    </div>
  );
}

/** The Suspense fallback: the page's top, before its state is read from the URL. */
export function Loading() {
  return (
    <div className={CONTAINER} aria-busy="true">
      <Hero view="videos" />
      <p role="status" className="sr-only">
        Loading…
      </p>
    </div>
  );
}
