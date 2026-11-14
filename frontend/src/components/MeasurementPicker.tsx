import type { Measure } from "@/components/channel/chart";
import Chip from "@/components/Chip";
import Select from "@/components/Select";
import { FEATURE_GROUPS, FEATURE_INFO } from "@/lib/features";

/**
 * Picks one of Overall and the 12 measurements (see STYLE.md, Measurement picker): chips in the
 * measurement table's groups when `wide`, a native select otherwise.
 */
export default function MeasurementPicker({
  value,
  onChange,
  wide,
  label = "Show",
  compact = false,
  className = "mt-4",
}: {
  value: Measure;
  onChange: (measure: Measure) => void;
  wide: boolean;
  label?: string;
  /** See `Select`. */
  compact?: boolean;
  className?: string;
}) {
  if (!wide) {
    return (
      <Select label={label} value={value} onChange={onChange} compact={compact} className={className}>
        <option value="overall">Overall</option>
        {FEATURE_GROUPS.map((group) => (
          <optgroup key={group.title} label={group.title}>
            {group.keys.map((key) => (
              <option key={key} value={key}>
                {FEATURE_INFO[key].name}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    );
  }

  const chip = (measure: Measure, name: string) => (
    <Chip key={measure} pressed={measure === value} onClick={() => onChange(measure)}>
      {name}
    </Chip>
  );
  return (
    <div role="group" aria-label={label} className="mt-3">
      <div className="flex flex-wrap gap-x-1.5">{chip("overall", "Overall")}</div>
      {FEATURE_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-wrap items-center gap-x-1.5">
          <span className="mr-1.5 text-sm text-ink">{group.title}</span>
          {group.keys.map((key) => chip(key, FEATURE_INFO[key].name))}
        </div>
      ))}
    </div>
  );
}
