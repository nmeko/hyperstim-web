"use client";

import { useLayoutEffect } from "react";

/** Space above the title once a link has landed. */
const GAP = 16;

/**
 * Makes a link to any item of a list land with the section's title at the top of the screen
 * (plan 006): each item's `scroll-margin-top` is its distance below the title, kept up to date as
 * the section's size changes. The browser scrolls to the anchor before this runs on a first load,
 * so it scrolls there once more, and keeps it there while the page settles. It also marks the linked item (`data-linked`), as `:target` misses
 * links followed inside the site, which change the address without loading the page. Renders
 * nothing; without JavaScript the items' own margin and `:target` apply.
 */
export default function LandAtTitle({ titleId, listId }: { titleId: string; listId: string }) {
  useLayoutEffect(() => {
    const title = document.getElementById(titleId);
    const list = document.getElementById(listId);
    if (!title || !list) return;
    const items = Array.from(list.children) as HTMLElement[];
    const setMargins = () => {
      const top = title.getBoundingClientRect().top;
      for (const item of items) item.style.scrollMarginTop = `${item.getBoundingClientRect().top - top + GAP}px`;
    };
    // The item landed on stays at the title's place while the page settles (late layout, a
    // resize), until the visitor scrolls, taps or types: Safari doesn't keep the scroll position
    // when content above changes.
    let pinned: HTMLElement | undefined;
    const unpin = () => {
      pinned = undefined;
    };
    // Marks the item in the address and goes to it; again when only the address's #part changes.
    const land = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      setMargins();
      for (const item of items) {
        if (item.id === hash) item.dataset.linked = "";
        else delete item.dataset.linked;
      }
      pinned = items.find((item) => item.id === hash);
      pinned?.scrollIntoView();
    };
    const settle = () => {
      setMargins();
      pinned?.scrollIntoView();
    };
    land();
    const INPUT = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const type of INPUT) window.addEventListener(type, unpin, { passive: true });
    window.addEventListener("hashchange", land);
    window.addEventListener("popstate", land);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(settle);
    observer?.observe(list.closest("section") ?? list);
    observer?.observe(document.body);
    return () => {
      for (const type of INPUT) window.removeEventListener(type, unpin);
      window.removeEventListener("hashchange", land);
      window.removeEventListener("popstate", land);
      observer?.disconnect();
    };
  }, [titleId, listId]);
  return null;
}
