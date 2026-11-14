import Link from "next/link";
import type { ReactNode } from "react";

const STEP =
  "flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border-2 border-navy px-3 font-semibold text-navy hover:bg-sky disabled:border-navy/20 disabled:text-navy/30 disabled:hover:bg-transparent aria-disabled:border-navy/20 aria-disabled:text-navy/30 aria-disabled:hover:bg-transparent sm:px-4";
const NUMBER =
  "flex h-11 min-w-11 items-center justify-center rounded-full px-2 text-sm font-semibold text-navy tabular-nums hover:bg-sky aria-[current=page]:bg-sunny";

/**
 * The page buttons to show: all of them up to 9 pages, else the first, the last and the current
 * one with two either side, with gaps; always 9 slots, so the control keeps its width.
 */
export function pageWindow(page: number, count: number): (number | "gap")[] {
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  if (count <= 9) return range(1, count);
  if (page <= 5) return [...range(1, 7), "gap", count];
  if (page >= count - 4) return [1, "gap", ...range(count - 6, count)];
  return [1, "gap", ...range(page - 2, page + 2), "gap", count];
}

type Mode =
  /** Buttons that change the page in place (rankings). */
  | { onChange: (page: number) => void; href?: never }
  /** Links to each page's own URL (blog list, built as static pages). */
  | { href: (page: number) => string; onChange?: never };

/**
 * Page control (see STYLE.md, Page control): Previous, the page window and Next from `sm`;
 * ‹ Page 3 of 655 › below it. With `onChange` its parts are buttons; with `href` they're links,
 * and a step that leads nowhere is an `aria-disabled` span.
 */
export default function Pagination({
  page,
  pageCount,
  className = "mt-6",
  ...mode
}: { page: number; pageCount: number; className?: string } & Mode) {
  if (pageCount <= 1) return null;

  const control = (target: number, label: string, content: ReactNode, classes: string, current = false) => {
    const disabled = target < 1 || target > pageCount;
    const currentProp = current ? ("page" as const) : undefined;
    if (mode.href) {
      return disabled ? (
        <span aria-label={label} aria-disabled="true" role="link" className={classes}>
          {content}
        </span>
      ) : (
        <Link href={mode.href(target)} aria-label={label} aria-current={currentProp} className={classes}>
          {content}
        </Link>
      );
    }
    return (
      <button
        type="button"
        aria-label={label}
        aria-current={currentProp}
        disabled={disabled}
        onClick={() => mode.onChange(target)}
        className={classes}
      >
        {content}
      </button>
    );
  };

  return (
    <nav aria-label="Pages" className={`flex items-center justify-center gap-2 sm:gap-3 ${className}`}>
      {control(
        page - 1,
        "Previous page",
        <>
          <span aria-hidden="true">‹</span>
          <span className="hidden sm:inline">Previous</span>
        </>,
        STEP,
      )}
      <p className="px-2 text-sm text-ink sm:hidden">
        Page {page.toLocaleString("en-US")} of {pageCount.toLocaleString("en-US")}
      </p>
      <ul className="hidden items-center gap-1 sm:flex">
        {pageWindow(page, pageCount).map((item, i) =>
          item === "gap" ? (
            <li key={`gap${i}`} aria-hidden="true" className="w-6 text-center text-ink">
              …
            </li>
          ) : (
            <li key={item}>{control(item, `Page ${item}`, item.toLocaleString("en-US"), NUMBER, item === page)}</li>
          ),
        )}
      </ul>
      {control(
        page + 1,
        "Next page",
        <>
          <span className="hidden sm:inline">Next</span>
          <span aria-hidden="true">›</span>
        </>,
        STEP,
      )}
    </nav>
  );
}
