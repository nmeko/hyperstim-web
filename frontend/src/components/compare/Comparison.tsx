import ScoreCell from "@/components/ScoreCell";
import { FeatureTip } from "@/components/video/Measurements";
import type { Feature } from "@/lib/api";
import { FEATURE_GROUPS, FEATURE_INFO, featureDisplay, formatValue } from "@/lib/features";
import { differences, formatPair, headlines, MORE, summarize } from "./compare";
import { itemFeatures, itemName, itemScore, type Item } from "./items";
import { Badge } from "./parts";
import type { Side } from "./state";

/**
 * What the two items' numbers say (see STYLE.md, Comparison): the overall summary and the one
 * or two biggest differences in words, then every measurement side by side in a table.
 */
export default function Comparison({ a, b }: { a: Item; b: Item }) {
  const channels = a.kind === "channel";
  const items = { a, b };
  const badge = (side: Side) => <Badge side={side} sr={itemName(items[side])} />;
  const summary = summarize(itemScore(a), itemScore(b));
  const whose = channels ? "’s videos" : "";
  const top = headlines(differences(itemFeatures(a), itemFeatures(b)));

  return (
    <div className="mx-auto max-w-5xl">
      <h2 className="sr-only">How they compare</h2>
      <p className="font-hand text-xl font-semibold text-navy sm:text-2xl">
        {summary.kind === "more" ? (
          <>
            {badge(summary.side)}
            {whose} {channels ? "are" : "is"} more stimulating {channels ? "on average" : "overall"}: {summary.a} vs {summary.b}.
          </>
        ) : (
          <>
            {badge("a")} and {badge("b")}
            {whose} are about as stimulating as each other: {summary.a} vs {summary.b}.
          </>
        )}
      </p>
      {top.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-lg" data-headlines="">
          {top.map((h) => (
            <li key={h.key}>
              {badge(h.side)}
              {whose} {MORE[h.key][channels ? "many" : "one"]}: {formatPair(h.a, h.b)}.
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-lg">Their 12 measurements are all within 20 points of each other.</p>
      )}

      <MeasurementTables a={a} b={b} highlight={top.map((h) => h.key)} />
    </div>
  );
}

/**
 * Overall and the 12 measurements in their groups, one column per side (see STYLE.md, Compare
 * table): Overall and Pacing in one table, the other two groups in another, side by side from
 * `lg` like the video page's measurements. The headline measurements' rows are highlighted.
 */
function MeasurementTables({ a, b, highlight }: { a: Item; b: Item; highlight: string[] }) {
  const [pacing, ...rest] = FEATURE_GROUPS;
  return (
    <div className="mt-8 grid max-w-xl gap-y-6 lg:max-w-none lg:grid-cols-2 lg:gap-x-12">
      <MeasurementTable a={a} b={b} groups={[pacing]} overall highlight={highlight} />
      <MeasurementTable a={a} b={b} groups={rest} highlight={highlight} />
    </div>
  );
}

function MeasurementTable({
  a,
  b,
  groups,
  overall = false,
  highlight,
}: {
  a: Item;
  b: Item;
  groups: typeof FEATURE_GROUPS;
  overall?: boolean;
  highlight: string[];
}) {
  const channels = a.kind === "channel";
  const features = { a: itemFeatures(a), b: itemFeatures(b) };
  const cell = (feature: Feature | undefined) => {
    if (!feature) return <span className="text-sm leading-tight text-ink/80">Not measured</span>;
    const display = featureDisplay(feature);
    // As on the video page: the reason in place of the number.
    return display.kind === "percentile" ? (
      <ScoreCell score={display.percentile} />
    ) : (
      <span className="text-sm leading-tight text-ink/80">{display.text}</span>
    );
  };
  const raw = (side: Side, key: string) => {
    const feature = features[side].find((f) => f.key === key);
    const value = feature && featureDisplay(feature).kind === "percentile" ? formatValue(key, feature.value) : null;
    return value && (channels ? `${value} on average` : value);
  };

  return (
    <table className="w-full table-fixed self-start text-left">
      <caption className="sr-only">
        {groups.map((g) => g.title).join(" and ")}: {itemName(a)} (A) and {itemName(b)} (B), 0–100
      </caption>
      <thead>
        <tr className="border-b border-navy/15">
          <th scope="col" className="pb-2">
            <span className="sr-only">Measurement</span>
          </th>
          {(["a", "b"] as const).map((side) => (
            <th key={side} scope="col" className="w-14 pb-2 text-center sm:w-20">
              <Badge side={side} sr={side.toUpperCase()} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {overall && (
          <tr className="border-b border-navy/10">
            <th scope="row" className="h-12 pl-3 font-bold text-navy">
              Overall
            </th>
            <td className="text-center">
              <ScoreCell score={itemScore(a)} />
            </td>
            <td className="text-center">
              <ScoreCell score={itemScore(b)} />
            </td>
          </tr>
        )}
        {groups.map((group) => [
          <tr key={group.title}>
            <th scope="colgroup" colSpan={3} className="pt-4 pb-1 pl-3 text-xs font-semibold text-ink">
              {group.title}
            </th>
          </tr>,
          ...group.keys.map((key) => {
            const values = (["a", "b"] as const).flatMap((side) => {
              const value = raw(side, key);
              return value ? [{ side, value }] : [];
            });
            const marked = highlight.includes(key);
            return (
              <tr
                key={key}
                className={`border-b border-navy/10 last:border-0 ${marked ? "bg-butter" : ""}`}
                data-row={key}
                data-highlight={marked ? "" : undefined}
              >
                {/* The cell, not the row, anchors the info popover: Safari ignores `relative` on a row. */}
                <th scope="row" className={`relative h-12 py-1 pl-3 font-normal ${marked ? "rounded-l-xl" : ""}`}>
                  <span className="flex min-w-0 items-center">
                    <span className="leading-tight font-semibold text-navy">{FEATURE_INFO[key].name}</span>
                    {marked && <span className="sr-only"> (a headline difference)</span>}
                    <FeatureTip featureKey={key} idPrefix="compare" className="-my-2 shrink-0">
                      {values.map(({ side, value }) => (
                        <p key={side} className="mt-2">
                          <span className="font-semibold text-navy">{side.toUpperCase()}:</span> {value}
                        </p>
                      ))}
                    </FeatureTip>
                  </span>
                </th>
                <td className="text-center">{cell(features.a.find((f) => f.key === key))}</td>
                <td className={`text-center ${marked ? "rounded-r-xl" : ""}`}>
                  {cell(features.b.find((f) => f.key === key))}
                </td>
              </tr>
            );
          }),
        ])}
      </tbody>
    </table>
  );
}
