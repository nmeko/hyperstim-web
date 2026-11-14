import type { CSSProperties } from "react";
import { FEATURE_INFO, featureSlug } from "@/lib/features";
import LandAtTitle from "./LandAtTitle";
import { Marker, Section } from "./parts";

// Step 2, "We measure 12 things": one diagram, the annotated timeline of a made-up 5-minute clip, with the
// list of the 12 that its numbered markers point to.

/** Marker number per measurement: the visual track left to right (1–7), then the audio (8–12). */
export const MARKERS: Record<string, number> = {
  cuts_per_min: 1,
  inter_cut_dssim_mean: 2,
  palette_change_per_min: 3,
  lstar_flash_per_min: 4,
  motion_frac: 5,
  mean_saturation: 6,
  mean_lstar: 7,
  build_resolve_per_min: 8,
  loudness_jumps_per_min: 9,
  loudness_jump_at_cut_per_min: 10,
  lufs: 11,
  high_lufs_frac: 12,
};

const BY_MARKER = Object.keys(MARKERS).sort((a, b) => MARKERS[a] - MARKERS[b]);

export default function WhatWeMeasure() {
  return (
    <Section id="measure" title="We measure 12 things" step={2}>
      <div className="mt-6">
        <Timeline />
      </div>
      <MeasurementList />
      <LandAtTitle titleId="measure-heading" listId="measure-list" />
    </Section>
  );
}

// The tracks are drawn in a 1000-wide viewBox; markers and labels are HTML placed at the same x
// as a %, or at the same y as a % of the track's height, so they keep their size at every width.

const W = 1000;
/** Height of each track in the viewBox: tall enough to read on phones. */
const H = 120;
const CUTS = [0, 45, 95, 140, 230, 330, 470, 560, 650, 740, 860, 1000];
/**
 * Visual track, in two quiet colors: sky shots, then butter ones after the colors swap out at the
 * cut at 470; the flash's shot is white. The next shot after the cut at 230 is a darker sky.
 */
const SHOT_FILL = [
  "fill-sky",
  "fill-sky",
  "fill-sky",
  "fill-sky",
  "fill-sky-blue/40",
  "fill-sky",
  "fill-butter",
  "fill-white",
  "fill-butter",
  "fill-butter",
  "fill-butter",
];
const FLASH_X = 605;
const PALETTE_X = 470;
const MOTION = [740, 860];
const SURPRISE_X = 650;
/** A loud moment inside a shot, away from any cut. */
const JUMP_X = 490;
const QUIET = [880, 930];

const VISUAL_EVENTS: [string, number][] = [
  ["cuts_per_min", 70],
  ["inter_cut_dssim_mean", 230],
  ["palette_change_per_min", PALETTE_X],
  ["lstar_flash_per_min", FLASH_X],
  ["motion_frac", (MOTION[0] + MOTION[1]) / 2],
];
const AUDIO_EVENTS: [string, number][] = [
  ["build_resolve_per_min", 210],
  ["loudness_jumps_per_min", JUMP_X + 15],
  ["loudness_jump_at_cut_per_min", SURPRISE_X],
  ["high_lufs_frac", (QUIET[0] + QUIET[1]) / 2],
];
/** The visual levels, summed up beside the visual track. */
const VISUAL_LEVELS = ["mean_saturation", "mean_lstar"];

/** Loudness at x: a gentle wobble, a build-up that drops back, two sudden jumps, a quiet gap. */
function loudness(x: number): number {
  if (x >= QUIET[0] && x < QUIET[1]) return 0;
  let level = 12 + 4 * Math.sin(x / 7) + 3 * Math.sin(x / 2.3);
  if (x >= 120 && x < 300) level += ((x - 120) / 180) * 28;
  if (x >= JUMP_X && x < JUMP_X + 30) level += 28;
  if (x >= SURPRISE_X && x < SURPRISE_X + 30) level += 30;
  return level;
}

const XS = Array.from({ length: W / 4 + 1 }, (_, i) => i * 4);
/** Height in the viewBox per loudness unit, so the loudest moment nearly fills the track. */
const SCALE = (H - 8) / Math.max(...XS.map(loudness));
const levelY = (level: number) => H - SCALE * level;
const LOUDNESS_PATH = `M0,${H}L${XS.map((x) => `${x},${levelY(loudness(x)).toFixed(1)}`).join("L")}L${W},${H}Z`;
/** y of the average loudness, as a % of the track's height. */
const MEAN_AT = (levelY(XS.reduce((sum, x) => sum + loudness(x), 0) / XS.length) / H) * 100;

/** Grid: track name | track | what's summed up over the whole clip. */
const ROW = "grid grid-cols-[1fr_auto] items-center gap-x-3 sm:grid-cols-[3rem_1fr_auto]";
/** The summary column, wide enough for two markers, or two labels from lg. */
const SUMMARY = "flex w-14 justify-between lg:w-36";

function Timeline() {
  return (
    <div aria-hidden="true">
      <div className={ROW}>
        <span className="hidden sm:block" />
        <Annotations events={VISUAL_EVENTS} side="top" />
        <span className={`${SUMMARY} h-full items-end pb-1`}>
          {VISUAL_LEVELS.map((key) => (
            <Annotation key={key} feature={key} side="top" className="w-6 lg:w-16" />
          ))}
        </span>
      </div>

      <div className={ROW}>
        <TrackName>Visual</TrackName>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible">
          {CUTS.slice(0, -1).map((x, i) => (
            <rect key={x} x={x + 3} y={4} width={CUTS[i + 1] - x - 6} height={H - 8} rx={6} strokeWidth={2} className={`${SHOT_FILL[i]} stroke-navy/20`} />
          ))}
          <g className="fill-sunny">
            <circle cx={FLASH_X} cy={H / 2} r={20} />
            {Array.from({ length: 8 }, (_, i) => (
              <rect key={i} x={FLASH_X - 3} y={H / 2 - 39} width={6} height={12} rx={3} transform={`rotate(${i * 45} ${FLASH_X} ${H / 2})`} />
            ))}
          </g>
          {/* Speed lines with arrowheads: things moving fast. */}
          <g className="stroke-navy/60" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none">
            {[36, 60, 84].map((y, i) => {
              const end = MOTION[1] - 22 - i * 8;
              return <path key={y} d={`M${MOTION[0] + 18 + i * 12} ${y}H${end}m-10 -9l10 9l-10 9`} />;
            })}
          </g>
          <line x1={SURPRISE_X} x2={SURPRISE_X} y1={0} y2={H} strokeDasharray="6 6" strokeWidth={2} className="stroke-navy" />
        </svg>
        <span className={SUMMARY}>
          <span className="flex w-6 justify-center lg:w-16">
            <ColorfulIcon />
          </span>
          <span className="flex w-6 justify-center lg:w-16">
            <BrightIcon />
          </span>
        </span>
      </div>

      <div className={`mt-2 ${ROW}`}>
        <TrackName>Audio</TrackName>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible">
          <path d={LOUDNESS_PATH} className="fill-navy/25" />
          {/* The quiet stretch, a pale band. */}
          <rect x={QUIET[0]} y={0} width={QUIET[1] - QUIET[0]} height={H} className="fill-navy/10" />
          <line x1={0} x2={W} y1={(MEAN_AT / 100) * H} y2={(MEAN_AT / 100) * H} strokeDasharray="12 8" strokeWidth={3} className="stroke-navy" />
          <line x1={SURPRISE_X} x2={SURPRISE_X} y1={0} y2={H} strokeDasharray="6 6" strokeWidth={2} className="stroke-navy" />
        </svg>
        {/* The average loudness: its marker sits at the end of the dashed line. */}
        <span className={`${SUMMARY} relative h-full`}>
          <span className="absolute left-0 flex -translate-y-1/2 items-center gap-1.5 text-xs leading-tight text-navy" style={{ top: `${MEAN_AT}%` }}>
            <Marker n={MARKERS.lufs} />
            <span className="hidden w-28 lg:block">{FEATURE_INFO.lufs.label}</span>
          </span>
        </span>
      </div>

      <div className={ROW}>
        <span className="hidden sm:block" />
        <Annotations events={AUDIO_EVENTS} side="bottom" />
        <span className={SUMMARY} />
      </div>

      {/* The time axis: the 5 minutes we measure. */}
      <div className={`mt-2 ${ROW}`}>
        <span className="hidden sm:block" />
        <span className="flex items-center gap-2 text-xs text-ink">
          0:30
          <span className="h-px flex-1 bg-navy/30" />
          <span>
            5 minutes<span className="hidden sm:inline">, the same for every video</span>
          </span>
          <span className="h-px flex-1 bg-navy/30" />
          5:30
        </span>
        <span className={SUMMARY} />
      </div>
    </div>
  );
}

/** Track name: above its track on phones, so the track gets the full width; beside it from sm. */
function TrackName({ children }: { children: string }) {
  return <span className="col-span-2 mb-1 text-xs font-semibold text-navy sm:col-span-1 sm:mb-0">{children}</span>;
}

/** A row of numbered markers at their events' x. */
function Annotations({ events, side }: { events: [string, number][]; side: "top" | "bottom" }) {
  return (
    <div className="relative h-8 lg:h-16">
      {events.map(([key, x]) => (
        <Annotation
          key={key}
          feature={key}
          side={side}
          className={`absolute w-28 -translate-x-1/2 ${side === "top" ? "bottom-1" : "top-1"}`}
          style={{ left: `${(x / W) * 100}%` }}
        />
      ))}
    </div>
  );
}

/** A numbered marker; from lg its short label sits on the side away from the track. */
function Annotation({
  feature,
  side,
  className,
  style,
}: {
  feature: string;
  side: "top" | "bottom";
  className: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`flex items-center gap-1 text-center text-xs leading-tight text-navy ${side === "top" ? "flex-col-reverse" : "flex-col"} ${className}`}
      style={style}
    >
      <Marker n={MARKERS[feature]} />
      <span className="hidden lg:block">{FEATURE_INFO[feature].label}</span>
    </span>
  );
}

/** Colorfulness: three overlapping color discs. */
function ColorfulIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7">
      <circle cx="9" cy="9" r="6" className="fill-coral/80" />
      <circle cx="15" cy="9" r="6" className="fill-sunny/80" />
      <circle cx="12" cy="15" r="6" className="fill-sky-blue/80" />
    </svg>
  );
}

/** Brightness: a sun with a light and a dark half. */
function BrightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7">
      <circle cx="12" cy="12" r="6" strokeWidth="2" className="fill-white stroke-navy" />
      <path d="M12 6a6 6 0 0 1 0 12z" className="fill-navy" />
      <g strokeWidth="2" strokeLinecap="round" className="stroke-navy">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <path key={a} d="M12 1.5v2" transform={`rotate(${a} 12 12)`} />
        ))}
      </g>
    </svg>
  );
}

/**
 * The 12 by marker number, each with its one-line description. Each item has the anchor other
 * pages link to; `LandAtTitle` makes it land with the section's title at the top.
 */
function MeasurementList() {
  return (
    <ul id="measure-list" className="mt-8 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {BY_MARKER.map((key) => (
        <li
          key={key}
          id={featureSlug(key)}
          className="-mx-2 flex scroll-mt-4 gap-2 rounded-xl px-2 py-1 target:bg-butter data-linked:bg-butter"
        >
          <Marker n={MARKERS[key]} />
          <div>
            <span className="text-sm font-semibold text-navy">{FEATURE_INFO[key].name}</span>
            <p className="text-sm">{FEATURE_INFO[key].description}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
