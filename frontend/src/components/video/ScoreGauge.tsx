"use client";

import type { ReactNode } from "react";
import { useCountUp } from "@/lib/motion";

// Dial geometry in SVG units: a half circle open at the bottom.
const CX = 120;
const CY = 118;
const R = 96;
const STROKE = 26;
const BANDS = ["stroke-sky-blue", "stroke-leaf", "stroke-scale-low", "stroke-scale-mid", "stroke-scale-high"];

/** Clockwise rotation of the needle from the low end, in degrees: 0 → 0°, 50 → 90°, 100 → 180°. */
export function needleAngle(score: number): number {
  return (Math.min(100, Math.max(0, score)) / 100) * 180;
}

/** Point on the dial at `score`, at radius `r`. */
function point(score: number, r: number): [number, number] {
  const a = Math.PI - (needleAngle(score) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

/**
 * Half-circle dial with a needle for a 0–100 score (see STYLE.md, Score gauge); fills its
 * container's width. `children` (e.g. an info button) sit to the right of the centred number.
 */
export default function ScoreGauge({ score, children }: { score: number; children?: ReactNode }) {
  const rounded = Math.round(score);
  const shown = useCountUp(rounded);
  return (
    <div className="flex flex-col items-center">
      <svg
        aria-hidden="true"
        viewBox="0 0 240 132"
        className="w-full"
        data-angle={needleAngle(shown)}
      >
        {BANDS.map((band, i) => {
          // A hair of overlap so no seam shows between bands.
          const [x1, y1] = point(i * 20, R);
          const [x2, y2] = point(Math.min(100, (i + 1) * 20 + 0.5), R);
          return (
            <path
              key={band}
              d={`M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`}
              fill="none"
              strokeWidth={STROKE}
              className={band}
            />
          );
        })}
        <g transform={`rotate(${needleAngle(shown)} ${CX} ${CY})`}>
          <path
            d={`M ${CX - R + 6} ${CY} L ${CX} ${CY - 5} L ${CX} ${CY + 5} Z`}
            className="fill-navy"
            strokeLinejoin="round"
          />
        </g>
        <circle cx={CX} cy={CY} r={10} className="fill-navy" />
        <circle cx={CX} cy={CY} r={3.5} className="fill-white" />
      </svg>
      {/* Each label is centred under its end of the dial (10 % and 90 % of the drawing's width). */}
      <div aria-hidden="true" className="relative h-[2.5rem] w-full text-sm/5 text-ink">
        <span className="absolute left-[10%] -translate-x-1/2 text-center whitespace-nowrap">
          less
          <br />
          stimulating
        </span>
        <span className="absolute left-[90%] -translate-x-1/2 text-center whitespace-nowrap">
          more
          <br />
          stimulating
        </span>
      </div>
      {/* The number is centred under the dial; the info button hangs to its right. */}
      <div className="relative mt-1">
        <p className="font-hand font-semibold text-navy">
          <span aria-hidden="true" className="text-5xl tabular-nums">
            {Math.round(shown)}
          </span>
          <span aria-hidden="true" className="text-xl">
            {" "}
            / 100
          </span>
          <span className="sr-only">Stimulation score {rounded} out of 100</span>
        </p>
        {children && <div className="absolute top-1/2 left-full z-10 ml-1 -translate-y-1/2">{children}</div>}
      </div>
    </div>
  );
}
