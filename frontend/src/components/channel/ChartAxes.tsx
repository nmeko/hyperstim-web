import { LEFT, RIGHT, type TimeScale } from "./chart";

const GRID = [0, 20, 40, 60, 80, 100];
const Y_LABELS = [0, 50, 100];

/** Gridlines and y labels (see STYLE.md, Over-years chart); drawn first, under everything. */
export function ChartGrid({ scale }: { scale: TimeScale }) {
  const { width, y } = scale;
  return (
    <>
      {GRID.map((v) => (
        <line key={v} x1={LEFT} x2={width - RIGHT} y1={y(v)} y2={y(v)} className="stroke-navy/10" />
      ))}
      {Y_LABELS.map((v) => (
        <text key={v} x={LEFT - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink/80 text-xs">
          {v}
        </text>
      ))}
    </>
  );
}

/** The time axis: a tick at each Jan 1 and the year labels under it. */
export function TimeAxis({ scale }: { scale: TimeScale }) {
  const { width, plotW, axisY, years, step } = scale;
  const at = (i: number) => LEFT + (i / (years.length - 1)) * plotW;
  return (
    <>
      <line x1={LEFT} x2={width - RIGHT} y1={axisY} y2={axisY} className="stroke-navy/30" />
      {years.map((year, i) => (
        <g key={year}>
          <line x1={at(i)} x2={at(i)} y1={axisY} y2={axisY + 5} className="stroke-navy/30" />
          {/* The last tick closes the final year; it has no label of its own. */}
          {i % step === 0 && i < years.length - 1 && (
            <text
              x={at(i)}
              y={axisY + 19}
              textAnchor="middle"
              // A white halo keeps the label readable over lines passing under it.
              className="fill-ink stroke-white text-xs [paint-order:stroke] [stroke-width:4px]"
            >
              {year}
            </text>
          )}
        </g>
      ))}
    </>
  );
}
