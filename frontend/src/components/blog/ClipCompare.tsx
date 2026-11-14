"use client";

import Link from "next/link";
import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import SegmentedControl from "@/components/SegmentedControl";
import YouTubePlayer, { type PlayerHandle } from "@/components/YouTubePlayer";
import {
  axisEnd,
  cutsSoFar,
  formatClock,
  motionAverage,
  motionRuns,
  motionTop,
  partLength,
  SIDES,
  timeLabels,
  type ClipSide,
  type Clips,
  type ClipTab,
  type CutsPart,
  type MotionPart,
} from "@/lib/blog/clips";
import { videoHref } from "@/lib/routes";
import { useWidth } from "@/lib/use-layout";

// A post's clip comparison (plan 018; STYLE.md, Clip comparison): two videos of the same song, a
// tab per stretch, and a lane per video. Before a video plays, its lane shows the whole result,
// for readers who never press Play; playing it starts the lane over, filling in with the video.
// One video plays at a time. Each tab keeps its own players and progress: switching pauses the
// tab left behind, and coming back finds it where it was, paused. Each lane is also a slider:
// clicking, dragging or the arrow keys move its video to that moment and play it from there.
// Screen readers get each tab's result as text, and the lanes' positions as slider values.

type Times = Partial<Record<ClipSide, number>>;
/** One tab's progress: seconds into the stretch each video has played to (missing until it has started), and the one playing last. */
type TabState = { times: Times; active?: ClipSide };

export default function ClipCompare({ clips }: { clips: Clips }) {
  const [tabIndex, setTabIndex] = useState(0);
  const [states, setStates] = useState<TabState[]>(() => clips.tabs.map(() => ({ times: {} })));
  // Each tab's two players, so switching tabs can pause the one left behind.
  const players = useRef<Partial<Record<ClipSide, PlayerHandle | null>>[]>(clips.tabs.map(() => ({})));
  const tab = clips.tabs[tabIndex];
  const { times, active } = states[tabIndex];

  const update = (index: number, change: (state: TabState) => TabState) =>
    setStates((all) => all.map((state, i) => (i === index ? change(state) : state)));
  const choose = (index: string) => {
    for (const side of SIDES) players.current[tabIndex][side]?.pause();
    setTabIndex(Number(index));
  };
  const onPlay = (index: number, side: ClipSide) => {
    update(index, ({ times }) => ({ times: { ...times, [side]: times[side] ?? 0 }, active: side }));
    players.current[index][side === "a" ? "b" : "a"]?.pause();
  };
  // A lane being dragged shows where the drag is, not where its video plays.
  const [scrub, setScrub] = useState<{ side: ClipSide; time: number }>();
  const onTime = (index: number, side: ClipSide, seconds: number) => {
    if (scrub?.side === side && index === tabIndex) return;
    const part = clips.tabs[index][side];
    const time = Math.max(0, Math.min(partLength(part), seconds - part.start));
    update(index, (state) => ({ ...state, times: { ...state.times, [side]: time } }));
  };

  /** Plays `side` from `time` seconds into the stretch, after pausing the other video. */
  const playFrom = (side: ClipSide, time: number) => {
    setScrub(undefined);
    players.current[tabIndex][side === "a" ? "b" : "a"]?.pause();
    update(tabIndex, ({ times }) => ({ times: { ...times, [side]: time }, active: side }));
    players.current[tabIndex][side]?.playFrom(tab[side].start + time);
  };

  const lane = (side: ClipSide) => (
    <Lane
      key={`lane-${side}`}
      side={side}
      tab={tab}
      title={clips.videos[side].title}
      // Not played yet: the whole stretch, so the result shows without pressing Play.
      time={scrub?.side === side ? scrub.time : (times[side] ?? partLength(tab[side]))}
      playing={(times[side] !== undefined && active === side) || scrub?.side === side}
      onScrub={(time) => setScrub(time === undefined ? undefined : { side, time })}
      onSeek={(time) => playFrom(side, time)}
    />
  );
  return (
    <div className="@container">
      {clips.tabs.length > 1 && (
        <SegmentedControl
          label="What the chart shows"
          options={clips.tabs.map((t, i) => ({ value: String(i), label: t.label }))}
          value={String(tabIndex)}
          onChange={choose}
          className="mx-auto mb-3.5"
        />
      )}
      <div className="grid grid-cols-1 gap-2.5 @[30rem]:grid-cols-2 @[30rem]:gap-4 @[44rem]:gap-5">
        {SIDES.map((side) => (
          <div key={side} className={side === "a" ? "order-1" : "order-3 mt-2.5 @[30rem]:order-2 @[30rem]:mt-0"}>
            <div className="mb-1.5 flex min-w-0 items-start gap-2">
              <span className="mt-0.5 flex">
                <Letter side={side} />
              </span>
              {/* The title, a link to the video's own page on the site, with the channel under it. */}
              <div className="flex min-w-0 flex-col leading-tight">
                <Link
                  href={videoHref(clips.videos[side].id)}
                  title={clips.videos[side].title}
                  className="truncate text-sm font-semibold text-navy decoration-2 underline-offset-4 hover:underline"
                >
                  {clips.videos[side].title}
                </Link>
                <span className="mt-px truncate text-xs text-ink" title={clips.videos[side].channel}>
                  {clips.videos[side].channel}
                </span>
              </div>
            </div>
            {/* Every tab's player stays in place, hidden on the other tabs, so it keeps its spot in the video. */}
            {clips.tabs.map((t, i) => (
              <div key={i} hidden={i !== tabIndex}>
                <YouTubePlayer
                  ref={(handle) => {
                    players.current[i][side] = handle;
                  }}
                  id={clips.videos[side].id}
                  title={`${side.toUpperCase()}: ${clips.videos[side].title} (${t.label})`}
                  start={t[side].start}
                  end={t[side].end}
                  onPlay={() => onPlay(i, side)}
                  onTime={(seconds) => onTime(i, side, seconds)}
                  captions={false}
                />
              </div>
            ))}
          </div>
        ))}
        {/* Below 30rem the panel's parts join the grid: each lane under its own video. */}
        <div className="contents @[30rem]:order-5 @[30rem]:col-span-2 @[30rem]:block @[30rem]:rounded-2xl @[30rem]:border @[30rem]:border-navy/15 @[30rem]:px-4 @[30rem]:pt-3 @[30rem]:pb-2">
          {lane("a")}
          {lane("b")}
        </div>
      </div>
      <p className="sr-only">{summary(tab)}</p>
    </div>
  );
}

/** A video's letter: a white circle with a navy ring, as the compare page's badge. */
function Letter({ side }: { side: ClipSide }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-white font-sans text-sm font-bold text-navy ring-[1.5px] ring-navy ring-inset"
    >
      {side.toUpperCase()}
    </span>
  );
}

/** What the tab shows, as a sentence for screen readers. */
function summary(tab: ClipTab): string {
  const seconds = (side: ClipSide) => Math.round(partLength(tab[side]));
  if (tab.kind === "cuts") {
    const cuts = (side: ClipSide) => {
      const n = tab[side].cuts.length;
      return `${n || "no"} ${n === 1 ? "cut" : "cuts"} in ${seconds(side)} seconds`;
    };
    return `${tab.label}: video A has ${cuts("a")}; video B has ${cuts("b")}.`;
  }
  return `${tab.label}: on average, the picture in video A moves ${motionAverage(tab.a)} and in video B ${motionAverage(
    tab.b,
  )} percent of the frame's width per second.`;
}

const LANE = "rounded-2xl border border-navy/15 px-3 pt-2.5 pb-1.5 @[30rem]:rounded-none @[30rem]:border-0 @[30rem]:p-0";

/** One video's lane: its letter, the chart so far, and its number on the right. */
function Lane({
  side,
  tab,
  title,
  time,
  playing,
  onScrub,
  onSeek,
}: {
  side: ClipSide;
  tab: ClipTab;
  title: string;
  time: number;
  playing: boolean;
  /** While dragging: where the drag is (seconds into the stretch); undefined when it's called off. */
  onScrub: (time: number | undefined) => void;
  /** Play from this moment (seconds into the stretch). */
  onSeek: (time: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box, 300);
  const [hover, setHover] = useState<number>();
  const dragging = useRef(false);
  const part = tab[side];
  const length = partLength(part);
  const end = axisEnd(tab);
  const left = LEFT[tab.kind];
  const x = (s: number) => left + (s / end) * (width - left - RIGHT);
  /** The moment under the pointer, within the stretch. */
  const at = (e: ReactPointerEvent) => {
    const px = e.clientX - box.current!.getBoundingClientRect().left;
    return Math.max(0, Math.min(length, ((px - left) / (width - left - RIGHT)) * end));
  };
  const keys: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 5, PageDown: -5 };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    let to: number | undefined;
    if (e.key in keys) to = time + keys[e.key];
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = length;
    if (to === undefined) return;
    e.preventDefault();
    onSeek(Math.max(0, Math.min(length, to)));
  };
  return (
    <div className={`${side === "a" ? "order-2" : "order-4 @[30rem]:mt-2.5"} ${LANE}`}>
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_4.25rem] items-start gap-2">
        {/* Centered on the plot: the cuts track runs through its middle. */}
        <span className="mt-[26px] flex">
          <Letter side={side} />
        </span>
        {/* Sideways drags scrub; up and down still scroll the page. */}
        <div
          ref={box}
          role="slider"
          tabIndex={0}
          aria-label={`Video ${side.toUpperCase()}: ${title}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(length)}
          aria-valuenow={Math.floor(time)}
          aria-valuetext={positionText(tab, side, time)}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            dragging.current = true;
            box.current!.setPointerCapture?.(e.pointerId);
            setHover(undefined);
            onScrub(at(e));
          }}
          onPointerMove={(e) => {
            if (dragging.current) onScrub(at(e));
            else if (e.pointerType === "mouse") setHover(at(e));
          }}
          onPointerUp={(e) => {
            if (!dragging.current) return;
            dragging.current = false;
            onSeek(at(e));
          }}
          onPointerCancel={() => {
            dragging.current = false;
            onScrub(undefined);
          }}
          onPointerLeave={() => setHover(undefined)}
          className="relative cursor-pointer touch-pan-y rounded-lg outline-offset-4 select-none focus-visible:outline-2 focus-visible:outline-navy"
        >
          {tab.kind === "cuts" ? (
            <CutsChart part={tab[side]} end={end} width={width} time={time} playing={playing} />
          ) : (
            <MotionChart part={tab[side]} end={end} top={motionTop(tab)} width={width} time={time} playing={playing} />
          )}
          {hover !== undefined && (
            <span aria-hidden="true" className="pointer-events-none absolute" style={{ left: x(hover), top: PLOT_TOP - 2, height: PLOT_HEIGHT + 2 }}>
              <span className="absolute inset-y-0 w-px bg-navy/40" />
              <span className="absolute -top-0.5 left-1.5 rounded bg-white px-1 text-xs whitespace-nowrap text-navy tabular-nums shadow-sm">
                {formatClock(hover)}
              </span>
            </span>
          )}
        </div>
        <LaneNumber tab={tab} side={side} time={time} />
      </div>
    </div>
  );
}

/** A lane's position for screen readers: "12 of 37 seconds, 8 cuts so far". */
function positionText(tab: ClipTab, side: ClipSide, time: number): string {
  const position = `${Math.floor(time)} of ${Math.round(partLength(tab[side]))} seconds`;
  if (tab.kind === "cuts") {
    const n = cutsSoFar(tab[side], time).length;
    return `${position}, ${n} ${n === 1 ? "cut" : "cuts"} so far`;
  }
  return `${position}, moving ${motionAverage(tab[side], time)} percent of the frame's width per second on average`;
}

function LaneNumber({ tab, side, time }: { tab: ClipTab; side: ClipSide; time: number }) {
  let content: ReactNode;
  if (tab.kind === "cuts") {
    const part = tab[side];
    const n = cutsSoFar(part, time).length;
    // The seconds played so far: whole seconds while playing, the stretch's length at its end.
    const seconds = time >= partLength(part) - 0.05 ? Math.round(partLength(part)) : Math.floor(time);
    content = (
      <>
        <b className="block text-[1.375rem] text-navy tabular-nums">{n}</b>
        <span>
          {n === 1 ? "cut" : "cuts"} in <span className="tabular-nums">{seconds}</span> s
        </span>
      </>
    );
  } else {
    content = (
      <>
        <b className="block text-[1.375rem] text-navy tabular-nums">{motionAverage(tab[side], time).toFixed(1)}</b>
        {/* The average so far, in the chart's unit; it may take two lines. */}
        <span className="whitespace-normal">% of width/s</span>
      </>
    );
  }
  return (
    <div aria-hidden="true" className="mt-1.5 flex h-16 flex-col justify-center text-xs leading-tight whitespace-nowrap text-ink">
      {content}
    </div>
  );
}

const LEFT = { cuts: 4, motion: 24 };
const RIGHT = 12;
// Both charts are the same height, so the page doesn't jump when the tab changes. The letter
// (mt-[26px], 24 px) and the number (mt-1.5 h-16) are centered on the plot, 6 to 70 px.
const PLOT_TOP = 6;
const PLOT_HEIGHT = 64;
const PLOT_BASE = PLOT_TOP + PLOT_HEIGHT;
const CHART_HEIGHT = PLOT_BASE + 22;

/** The time axis' labels under a chart. */
function TimeLabels({ end, width, x, y }: { end: number; width: number; x: (s: number) => number; y: number }) {
  // Centered on their marks, the first excepted; the chart's right margin holds the last one's unit.
  return timeLabels(end, width).map(({ seconds, text }) => (
    <text key={seconds} x={x(seconds)} y={y} textAnchor={seconds === 0 ? "start" : "middle"}>
      {text}
    </text>
  ));
}

function Playhead({ x, y1, y2 }: { x: number; y1: number; y2: number }) {
  return <line data-playhead="" x1={x} x2={x} y1={y1} y2={y2} strokeWidth={3} strokeLinecap="round" className="stroke-scale-mid" />;
}

function CutsChart({ part, end, width, time, playing }: { part: CutsPart; end: number; width: number; time: number; playing: boolean }) {
  const x = (s: number) => LEFT.cuts + (s / end) * (width - LEFT.cuts - RIGHT);
  const y = PLOT_TOP + PLOT_HEIGHT / 2;
  const length = partLength(part);
  return (
    <svg aria-hidden="true" width={width} height={CHART_HEIGHT} className="block overflow-visible fill-ink text-xs">
      <line x1={x(0)} x2={x(length)} y1={y} y2={y} strokeWidth={2} strokeLinecap="round" className="stroke-navy/15" />
      <line x1={x(0)} x2={x(time)} y1={y} y2={y} strokeWidth={2} strokeLinecap="round" className="stroke-navy" />
      {cutsSoFar(part, time).map((cut) => (
        <rect key={cut} data-cut="" x={x(cut) - 1.75} y={y - 18} width={3.5} height={36} rx={1.75} className="fill-navy" />
      ))}
      <TimeLabels end={end} width={width} x={x} y={PLOT_BASE + 16} />
      {playing && time < length - 0.05 && <Playhead x={x(time)} y1={PLOT_TOP - 2} y2={PLOT_BASE} />}
    </svg>
  );
}

function MotionChart({
  part,
  end,
  top,
  width,
  time,
  playing,
}: {
  part: MotionPart;
  end: number;
  top: number;
  width: number;
  time: number;
  playing: boolean;
}) {
  const x = (s: number) => LEFT.motion + (s / end) * (width - LEFT.motion - RIGHT);
  const base = PLOT_BASE;
  const y = (v: number) => base - (v / top) * PLOT_HEIGHT;
  const runs = motionRuns(part, time);
  const line = (run: [number, number][]) => run.map(([s, v], i) => `${i ? "L" : "M"}${x(s).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  return (
    <svg aria-hidden="true" width={width} height={CHART_HEIGHT} className="block overflow-visible fill-ink text-xs">
      {[0, top / 2, top].map((g) => (
        <g key={g}>
          <line x1={LEFT.motion} x2={width - RIGHT} y1={y(g)} y2={y(g)} className={g ? "stroke-navy/8" : "stroke-navy/25"} />
          <text x={LEFT.motion - 5} y={y(g) + 4} textAnchor="end">
            {g}
          </text>
        </g>
      ))}
      {runs.map((run) => (
        <g key={run[0][0]} data-motion="">
          {run.length > 1 && (
            <path d={`${line(run)}L${x(run[run.length - 1][0]).toFixed(1)} ${base}L${x(run[0][0]).toFixed(1)} ${base}Z`} className="fill-navy/12" />
          )}
          <path d={line(run)} fill="none" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" className="stroke-navy" />
        </g>
      ))}
      <TimeLabels end={end} width={width} x={x} y={base + 16} />
      {playing && time < partLength(part) - 0.05 && <Playhead x={x(time)} y1={PLOT_TOP - 2} y2={base} />}
    </svg>
  );
}
