import { Lead, Section } from "./parts";

// Step 4, "You get a score": percentiles as lining videos up (diagram C), in the score's 5 colors.

/** The score scale's 5 colors, least to most stimulating, as in `ScoreMeter`. */
const FILL = ["bg-sky-blue", "bg-leaf", "bg-scale-low", "bg-scale-mid", "bg-scale-high"];
const RING = ["border-sky-blue", "border-leaf", "border-scale-low", "border-scale-mid", "border-scale-high"];

export default function Score() {
  return (
    <Section id="score" title="You get a score" step={4}>
      <Lead>A score of 74 means a video is more stimulating than 74 of every 100 videos we compare with.</Lead>
      <LineUp />
    </Section>
  );
}

/** Diagram C: a row of dots, least to most stimulating, with "your video" 74 % of the way along. */
function LineUp() {
  return (
    <div aria-hidden="true" className="mt-6 rounded-2xl bg-sky px-4 py-5 sm:px-6">
      <Dots before={14} after={5} className="md:hidden" />
      <Dots before={29} after={10} className="hidden md:block" />
    </div>
  );
}

function Dots({ before, after, className }: { before: number; after: number; className: string }) {
  const at = `${(before / (before + after)) * 100}%`;
  /** Color band of the dot at index i of the whole row (the diamond is index `before`). */
  const band = (i: number) => Math.min(4, Math.floor((i / (before + after)) * 5));
  return (
    <div className={className}>
      <div className="flex items-end justify-between text-xs text-ink">
        <span>less stimulating</span>
        <span>more stimulating</span>
      </div>
      <div className="relative mt-8 mb-10">
        <span
          className="absolute bottom-full mb-1.5 -translate-x-1/2 text-xs font-semibold whitespace-nowrap text-navy"
          style={{ left: at }}
        >
          your video ▾
        </span>
        <div className="flex items-center justify-between">
          {Array.from({ length: before }, (_, i) => (
            <span key={`b${i}`} className={`size-2 rounded-full md:size-2.5 ${FILL[band(i)]}`} />
          ))}
          <span className="size-3.5 rotate-45 rounded-[2px] bg-navy" />
          {Array.from({ length: after }, (_, i) => (
            <span key={`a${i}`} className={`size-2 rounded-full border-2 md:size-2.5 ${RING[band(before + 1 + i)]}`} />
          ))}
        </div>
        {/* A bracket under the less stimulating videos. */}
        <div className="absolute top-full left-0 mt-2 h-2 border-x-2 border-b-2 border-navy/30" style={{ width: at }} />
        <span
          className="absolute top-full mt-5 text-center text-xs font-semibold text-navy"
          style={{ left: 0, width: at }}
        >
          74 of every 100 videos are less stimulating
        </span>
      </div>
    </div>
  );
}
