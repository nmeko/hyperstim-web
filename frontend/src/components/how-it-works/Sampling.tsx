import type { ReactNode } from "react";
import LatestScan from "./LatestScan";
import { Section, StepArrow } from "./parts";

// Step 3, "We compare it with our dataset": how its videos were picked (diagram E). It describes
// the approach only, with no sampling counts, which may change (plan 006). Its steps have no
// numbers, so they don't clash with the page's steps.

type Cell = "upload" | "picked" | "failed";
type Row = [year: string, cells: Cell[]];

const u: Cell = "upload";
const p: Cell = "picked";
const x: Cell = "failed";

/** One made-up channel's uploads per year, few early and many recent. */
const UPLOADS: Row[] = [
  ["2015", [u, u]],
  ["2016", [u, u, u, u]],
  ["2017", [u, u, u, u, u, u]],
  ["2026", [u, u, u, u, u, u, u, u, u, u, u]],
];
/** The same uploads with the random picks: the same number every year; a failed pick is replaced. */
const PICKS: Row[] = [
  ["2015", [p, p]],
  ["2016", [u, p, u, p]],
  ["2017", [u, x, p, u, p, u]],
  ["2026", [u, p, u, u, x, p, u, u, u, u, u]],
];
const DATASET: Row[] = PICKS.map(([year]) => [year, [p, p]]);

const CELL: Record<Cell, string> = {
  upload: "bg-navy/15",
  picked: "bg-navy",
  failed: "bg-coral/30 text-coral",
};

function Years({ rows }: { rows: Row[] }) {
  return (
    <div className="grid gap-1.5 text-xs text-ink">
      {rows.map(([year, cells], i) => (
        <div key={year}>
          {i === rows.length - 1 && <div className="mb-1.5 pl-1 leading-none">⋮</div>}
          <div className="flex items-center gap-2">
            <span className="w-8 tabular-nums">{year}</span>
            <span className="flex gap-1">
              {cells.map((cell, j) => (
                <span key={j} className={`flex h-4 w-2.5 items-center justify-center rounded-sm text-[10px] leading-none font-bold ${CELL[cell]}`}>
                  {cell === "failed" && "×"}
                </span>
              ))}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A step's picture box. Its drawing is decorative; its ✓ list is read out. */
function Picture({ drawing, checks, note }: { drawing: ReactNode; checks?: string[]; note?: ReactNode }) {
  return (
    <div className="mt-3 flex min-h-36 flex-1 flex-col justify-center gap-2 rounded-2xl bg-sky px-4 py-3">
      <div aria-hidden="true">{drawing}</div>
      {checks && (
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-navy">
          {checks.map((check) => (
            <li key={check}>✓ {check}</li>
          ))}
        </ul>
      )}
      {note && <p className="text-xs text-ink">{note}</p>}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 40 40" className="size-10">
      <circle cx="17" cy="17" r="11" fill="none" strokeWidth="4" className="stroke-navy" />
      <path d="M25 25l9 9" strokeWidth="5" strokeLinecap="round" className="stroke-navy" />
    </svg>
  );
}

const STEPS: { title: string; picture: ReactNode }[] = [
  {
    title: "Find channels",
    picture: (
      <Picture
        drawing={<SearchIcon />}
        checks={["10K+ subscribers", "100+ videos"]}
        note={<LatestScan />}
      />
    ),
  },
  {
    title: "Line up every upload by year",
    picture: <Picture drawing={<Years rows={UPLOADS} />} />,
  },
  {
    title: "Pick a few at random, every year",
    picture: (
      <Picture
        drawing={<Years rows={PICKS} />}
        checks={["made for kids", "not a Short", "2–60 minutes", "still online"]}
      />
    ),
  },
  {
    title: "Our dataset",
    picture: <Picture drawing={<Years rows={DATASET} />} note="We keep adding videos." />,
  },
];

export default function Sampling() {
  return (
    <Section id="sampling" title="We compare it with our dataset" step={3}>
      <ol className="mt-6 grid gap-3 md:grid-cols-2 md:gap-6 lg:grid-cols-4 lg:gap-0">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex flex-col gap-3 lg:flex-row lg:gap-2">
            <div className="flex flex-1 flex-col">
              <h3 className="font-semibold text-navy lg:min-h-12">{step.title}</h3>
              {step.picture}
            </div>
            {/* From lg the arrows point between the pictures, below the two-line titles. */}
            {i < STEPS.length - 1 && <StepArrow className="lg:mt-[6.75rem] lg:self-start" />}
          </li>
        ))}
      </ol>

    </Section>
  );
}
