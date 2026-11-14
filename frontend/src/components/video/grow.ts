// A player growing out of its preview and shrinking back: the video page's header and the channel
// page's video panel (see STYLE.md, Video header and Video panel).

/** Length of the grow, the score panel's slide and the kid's duck, in ms. */
export const GROW_MS = 450;
const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

export function canAnimate(el: Element): boolean {
  const reduce =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return !reduce && typeof el.animate === "function";
}

/** An element sliding into its new place from `dx`, `dy` px off. */
export type Slide = { el: HTMLElement; dx: number; dy: number };

/**
 * Flies a copy of the thumbnail from the box `from` to `to`'s box, with `to` hidden until it lands,
 * then calls `done`. Meanwhile each of `slides` (e.g. the score panel) slides into its new place.
 */
export function grow(from: DOMRect, to: HTMLElement, thumbnail: string, slides: Slide[], done: () => void) {
  const end = to.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.setAttribute("aria-hidden", "true");
  ghost.className = "pointer-events-none fixed z-30 overflow-hidden rounded-2xl bg-navy/10";
  const img = document.createElement("img");
  img.src = thumbnail;
  img.alt = "";
  img.className = "size-full object-cover";
  img.onerror = () => img.remove(); // a thumbnail that can't load: the plain tile (plan 009)
  ghost.append(img);
  document.body.append(ghost);
  to.style.visibility = "hidden";

  const box = (r: DOMRect) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  const timing = { duration: GROW_MS, easing: EASE };
  for (const { el, dx, dy } of slides) {
    if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], timing);
  }
  const flight = ghost.animate([box(from), box(end)], { ...timing, fill: "forwards" });
  const finish = () => {
    to.style.visibility = "";
    ghost.remove();
    done();
  };
  flight.onfinish = finish;
  flight.oncancel = finish;
}
