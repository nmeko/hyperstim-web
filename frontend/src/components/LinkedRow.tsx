"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

/**
 * A linked table row (STYLE.md, Tables): the name's link covers its own cell, and a click
 * anywhere else in the row opens the same page. Not on the row's own links and buttons, after
 * selecting text, or with a modifier key (the name's link opens a new tab). Keyboards and screen
 * readers use the link. The link can't cover the row itself: Safari ignores `relative` on a `tr`.
 */
export default function LinkedRow({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if ((e.target as Element).closest("a, button")) return;
    if (window.getSelection()?.toString()) return;
    router.push(href);
  };
  return (
    <tr onClick={onClick} className={`cursor-pointer ${className}`}>
      {children}
    </tr>
  );
}
