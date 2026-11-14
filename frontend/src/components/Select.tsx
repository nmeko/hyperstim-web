import type { ReactNode } from "react";

/**
 * A native select with its label above it (see STYLE.md, Select). `children` are its options.
 * `compact` narrows its side padding below `sm`, for two selects side by side on phones.
 */
export default function Select({
  label,
  value,
  onChange,
  compact = false,
  className = "",
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const padding = compact ? "pr-9 pl-4 sm:pr-11 sm:pl-5" : "pr-11 pl-5";
  const chevron = compact ? "right-3.5 sm:right-5" : "right-5";
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-semibold text-navy">{label}</span>
      <span className="relative mt-1 block">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`h-12 w-full appearance-none rounded-full border-2 border-navy bg-white ${padding} text-navy focus:shadow-[0_0_0_5px_var(--color-sunny)] focus:outline-none`}
        >
          {children}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={`pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 ${chevron}`}
        >
          <path d="M4.5 7.5 10 13l5.5-5.5" fill="none" strokeWidth="2.5" className="stroke-navy" />
        </svg>
      </span>
    </label>
  );
}
