/**
 * Switches between a few views (see STYLE.md, Segmented control): each option is a 44 px touch
 * target filled by its pill, with the same 4 px gap to the border all round, so the pill's
 * curve follows the border's.
 */
export default function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className = "",
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex w-fit rounded-full border border-navy/15 bg-white ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className="group flex min-h-11 rounded-full p-1 text-sm font-semibold text-navy"
        >
          {/* Its own height: Safari doesn't stretch a button's content to the button (STYLE.md, Browser pitfalls). */}
          <span className="flex min-h-9 items-center rounded-full px-3 group-hover:bg-sky group-aria-pressed:bg-sunny">
            {option.label}
          </span>
        </button>
      ))}
    </div>
  );
}
