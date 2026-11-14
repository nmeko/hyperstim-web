import type { ReactNode, Ref } from "react";
import InfoTip from "@/components/InfoTip";
import type { Feature } from "@/lib/api";
import Measurements from "./Measurements";
import ScoreGauge from "./ScoreGauge";

// The score panel of the video and channel pages (see STYLE.md, Score panel).

export const PANEL_CARD = "relative rounded-[2rem] border border-navy/15 bg-white px-4 py-6 sm:px-8";
// Gauge column beside the measurements from lg; wider, with a wider gap, from xl.
const PANEL_GRID = "grid lg:grid-cols-[13rem_1fr] lg:gap-x-8 xl:grid-cols-[17rem_1fr] xl:gap-x-12";
// The gauge fills its column from lg and is vertically centred against the measurements.
const GAUGE = "mx-auto w-full max-w-48 lg:max-w-none lg:self-center";

/**
 * The gauge and the 12 measurements in a section card. `scoreInfo` is the score's popover text;
 * `kid` peeks over the top edge; `className` sets the space above it; `ref` is the card.
 */
export default function ScorePanel({
  score,
  features,
  subject,
  scoreInfo,
  kid,
  className,
  ref,
}: {
  score: number;
  features: Feature[];
  subject: "video" | "channel";
  scoreInfo: ReactNode;
  kid: ReactNode;
  className: string;
  ref?: Ref<HTMLElement>;
}) {
  return (
    <section ref={ref} aria-labelledby="score-heading" className={`${PANEL_CARD} ${className}`}>
      {kid}
      <h2 id="score-heading" className="sr-only">
        Stimulation score
      </h2>
      <div className={PANEL_GRID}>
        <div className={GAUGE}>
          <ScoreGauge score={score}>
            <InfoTip id="score-info" label="About the stimulation score">
              {scoreInfo}
            </InfoTip>
          </ScoreGauge>
        </div>
        <div className="mt-6 border-t border-navy/10 pt-4 lg:mt-0 lg:border-t-0 lg:pt-0">
          <Measurements features={features} subject={subject} />
        </div>
      </div>
    </section>
  );
}

/** The panel's skeleton: dial outline and 12 grey rows. */
export function ScorePanelSkeleton({ className }: { className: string }) {
  const bar = "block animate-pulse rounded bg-gray-200";
  return (
    <div className={`${PANEL_CARD} ${className}`}>
      <div className={PANEL_GRID}>
        <div className={GAUGE}>
          <svg aria-hidden="true" viewBox="0 0 240 132" className="w-full">
            <path d="M 24 118 A 96 96 0 0 1 216 118" fill="none" strokeWidth={26} className="stroke-gray-200" />
          </svg>
          <span className={`${bar} mx-auto mt-6 h-10 w-28`} />
        </div>
        <div className="mt-6 grid gap-x-6 border-t border-navy/10 pt-4 md:grid-cols-2 lg:mt-0 lg:border-t-0 lg:pt-0">
          {[6, 6].map((rows, col) => (
            <div key={col}>
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex h-11 items-center justify-between gap-4 border-b border-navy/10 last:border-0">
                  <span className={`${bar} h-4 w-2/5`} />
                  <span className={`${bar} h-4 w-24`} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
