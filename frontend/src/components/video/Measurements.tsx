import Link from "next/link";
import type { ReactNode } from "react";
import InfoTip from "@/components/InfoTip";
import ScoreMeter from "@/components/ScoreMeter";
import type { Feature } from "@/lib/api";
import { FEATURE_GROUPS, FEATURE_INFO, featureDisplay, featureSlug, formatValue } from "@/lib/features";

type Subject = "video" | "channel";

/**
 * The 12 measurements in their three groups (see STYLE.md, Measurement table). `subject` says
 * whose raw values the popovers show: one video's, or a channel's averages.
 */
export default function Measurements({
  features,
  subject = "video",
}: {
  features: Feature[];
  subject?: Subject;
}) {
  const byKey = new Map(features.map((f) => [f.key, f]));
  const [pacing, ...rest] = FEATURE_GROUPS;
  const group = ({ title, keys }: (typeof FEATURE_GROUPS)[number]) => (
    <Group key={title} title={title} subject={subject} features={keys.flatMap((k) => byKey.get(k) ?? [])} />
  );
  // Pacing on the left; the two shorter groups stacked on the right.
  return (
    <div className="grid gap-6 md:grid-cols-2 md:gap-x-6">
      {group(pacing)}
      <div className="grid content-start gap-6">{rest.map(group)}</div>
    </div>
  );
}

function Group({ title, subject, features }: { title: string; subject: Subject; features: Feature[] }) {
  const id = `group-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="font-hand text-lg font-semibold text-navy">
        {title}
      </h3>
      <ul className="mt-1">
        {features.map((f) => (
          <Row key={f.key} feature={f} subject={subject} />
        ))}
      </ul>
    </section>
  );
}

function Row({ feature, subject }: { feature: Feature; subject: Subject }) {
  const info = FEATURE_INFO[feature.key];
  const display = featureDisplay(feature);
  const value = display.kind === "percentile" ? formatValue(feature.key, feature.value) : null;
  return (
    <li className="relative flex min-h-11 items-center justify-between gap-2 border-b border-navy/10 last:border-0">
      <span className="flex min-w-0 items-center">
        <span className="font-semibold text-navy">{info.name}</span>
        <FeatureTip featureKey={feature.key} className="-my-1 shrink-0">
          {value && (
            <p className="mt-2">
              <span className="font-semibold text-navy">
                {subject === "video" ? "This video:" : "This channel:"}
              </span>{" "}
              {subject === "video" ? value : `${value} on average`}
            </p>
          )}
        </FeatureTip>
      </span>
      <span className="w-28 shrink-0 text-right">
        {display.kind === "percentile" ? (
          <ScoreMeter
            score={display.percentile}
            size="compact"
            srLabel={`Higher than ${Math.round(display.percentile)}% of videos in our dataset`}
          />
        ) : (
          <span className="text-sm text-ink/80">{display.text}</span>
        )}
      </span>
    </li>
  );
}

/**
 * A measurement's info button: its description, then `children` (e.g. this video's raw value),
 * then a link to where How it works explains it. Opens from the row's left edge, so the row
 * must be `relative` (in a table, its first cell: Safari ignores `relative` on a `tr`).
 */
export function FeatureTip({
  featureKey,
  idPrefix = "feature",
  className,
  children,
}: {
  featureKey: string;
  /** Keeps IDs unique when the same measurement shows twice on a page. */
  idPrefix?: string;
  className?: string;
  children?: ReactNode;
}) {
  const info = FEATURE_INFO[featureKey];
  return (
    <InfoTip id={`${idPrefix}-${featureKey}`} label={`About ${info.name}`} align="row" className={className}>
      <p>{info.description}</p>
      {children}
      <p className="mt-2">
        <Link
          href={`/how-it-works#${featureSlug(featureKey)}`}
          className="font-bold text-navy underline decoration-2 underline-offset-4 hover:decoration-sunny"
        >
          More about this<span className="sr-only">: {info.name}</span> <span aria-hidden="true">→</span>
        </Link>
      </p>
    </InfoTip>
  );
}
