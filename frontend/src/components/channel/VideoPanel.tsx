"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import ScoreMeter from "@/components/ScoreMeter";
import { VideoGoneNote } from "@/components/VideoGoneNote";
import YouTubePlayer from "@/components/YouTubePlayer";
import { canAnimate, grow } from "@/components/video/grow";
import { PLAYER_WIDTH, ShrinkButton } from "@/components/video/parts";
import { thumbnailUrl, type ChannelVideo } from "@/lib/api";
import { videoHref } from "@/lib/routes";
import { formatDate, measureName, pointOf, type Measure } from "./chart";

const reduceMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const GLIDE_MS = 400;

/**
 * Glides the page by `delta` px, one frame at a time; returns a function that stops it. Not the
 * browser's smooth scroll: that can't be stopped reliably, and a jump made while it runs lands off
 * (Chromium adds the jump on top of it; in WebKit the glide can start after the jump and win). Stops
 * by itself if the visitor scrolls meanwhile, like the browser's.
 */
function glideBy(delta: number): () => void {
  const from = window.scrollY;
  const start = performance.now();
  let frame = 0;
  let last = from;
  const step = (now: number) => {
    if (Math.abs(window.scrollY - last) >= 1) return; // the visitor scrolled
    const t = Math.min(1, (now - start) / GLIDE_MS);
    const eased = t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2;
    window.scrollTo({ top: from + delta * eased, behavior: "instant" });
    last = window.scrollY;
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

/** The parts of the page that move when it scrolls (not the fixed consent banner). */
const pageParts = () =>
  [...document.body.children].filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && el.getBoundingClientRect().height > 0 && getComputedStyle(el).position !== "fixed",
  );

/**
 * The video opened from the over-years chart (see STYLE.md, Video panel): its preview, its title as a
 * link to its page, and its value for the chart's measurement. When it opens, the page scrolls it to
 * the middle of the screen (up too) and it takes focus.
 *
 * Play grows the player out of the preview, under the text; in the same motion the page scrolls the
 * panel to the middle of the screen. The shrink button puts the preview back.
 */
export default function VideoPanel({
  video,
  measure,
  label,
  onClose,
}: {
  video: ChannelVideo;
  measure: Measure;
  /** Above the title, e.g. the compare page's channel badge and name. */
  label?: ReactNode;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [playing, setPlaying] = useState(false);
  // Where things were on screen before a toggle, for the animation; null: no animation.
  const before = useRef<{ box: DOMRect; text: DOMRect; page: Map<HTMLElement, number> } | null>(null);
  const toggled = useRef(false);
  const stopGlide = useRef<() => void>(() => {});

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    // Focus without the browser's instant jump; the scroll below glides there instead.
    el.focus({ preventScroll: true });
    // To the middle of the screen, also upward; the browser stops at the page's ends.
    const r = el.getBoundingClientRect();
    const delta = r.top + r.height / 2 - window.innerHeight / 2;
    if (Math.abs(delta) < 1) return;
    if (reduceMotion()) window.scrollBy({ top: delta, behavior: "auto" });
    else stopGlide.current = glideBy(delta);
    return () => stopGlide.current();
  }, [video.id]);

  const toggle = (next: boolean) => {
    const b = box.current;
    const t = text.current;
    before.current =
      b && t && canAnimate(b)
        ? {
            box: b.getBoundingClientRect(),
            text: t.getBoundingClientRect(),
            page: new Map(pageParts().map((el) => [el, el.getBoundingClientRect().top])),
          }
        : null;
    toggled.current = true;
    setPlaying(next);
  };

  // After a toggle, in one motion: the page jumps to its new scroll position and every part of it
  // slides there from where it was, while the thumbnail flies into the new box and the text slides
  // over. Then focus goes to the player, or to the preview's play button after shrinking.
  useLayoutEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    const b = box.current;
    const t = text.current;
    const p = panel.current;
    if (!b || !t || !p) return;
    // Played while the page still glides to the panel: from where it is now.
    stopGlide.current();
    // The panel to the middle of the screen, never past its title.
    const place = () => {
      const r = p.getBoundingClientRect();
      let delta = r.top + r.height / 2 - window.innerHeight / 2;
      const h = heading.current?.getBoundingClientRect();
      if (h) delta = Math.min(delta, h.top - 16);
      if (Math.abs(delta) >= 1) window.scrollTo({ top: window.scrollY + delta, behavior: "instant" });
    };
    if (playing) place();
    const focus = () => b.querySelector<HTMLElement>(playing ? "iframe" : "button")?.focus({ preventScroll: true });
    const from = before.current;
    before.current = null;
    if (!from) return focus();
    const slides = [...from.page].map(([el, top]) => ({ el, dx: 0, dy: top - el.getBoundingClientRect().top }));
    // The text slides inside main, which slides too.
    const holder = slides.find((s) => s.el.contains(t))?.dy ?? 0;
    const now = t.getBoundingClientRect();
    slides.push({ el: t, dx: from.text.left - now.left, dy: from.text.top - now.top - holder });
    // Placed again once grown: WebKit, when too busy to draw, can put the page back where it was.
    grow(from.box, b, thumbnailUrl(video.id), slides, () => {
      if (playing) place();
      focus();
    });
  }, [playing, video.id]);

  const point = pointOf(video, measure);
  return (
    <div
      ref={panel}
      tabIndex={-1}
      role="region"
      aria-labelledby="video-panel-title"
      className={`relative mt-6 grid gap-4 rounded-2xl bg-sky p-4 sm:p-5 ${
        playing ? "" : "sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-6"
      }`}
    >
      {/* Right of the preview; above the player while playing. Clear of the × on the right. */}
      <div ref={text} className={`min-w-0 pr-10 ${playing ? "" : "sm:col-start-2 sm:row-start-1"}`}>
        {label}
        <h3 ref={heading} id="video-panel-title" className="font-hand text-lg leading-snug font-semibold text-navy">
          <Link
            href={videoHref(video.id)}
            className="line-clamp-2 underline decoration-navy/30 decoration-2 underline-offset-4 hover:decoration-navy"
          >
            {video.title}
          </Link>
        </h3>
        <p className="mt-1 text-sm text-ink">{formatDate(video.publishedAt)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-navy">{measureName(measure)}</span>
          {point.kind === "value" ? (
            <ScoreMeter score={point.value} size="compact" />
          ) : (
            <span className="text-sm text-ink/80">{point.text}</span>
          )}
        </div>
      </div>
      <div className={playing ? `relative ${PLAYER_WIDTH}` : "w-full sm:col-start-1 sm:row-start-1"}>
        {/* The preview plays on click; the embedded player links on to YouTube. */}
        <div ref={box}>
          <YouTubePlayer id={video.id} title={video.title} playing={playing} onStart={() => toggle(true)} cover />
        </div>
        <VideoGoneNote id={video.id} />
        {/* Above the player's top right corner, clear of YouTube's own controls. */}
        {playing && <ShrinkButton onClick={() => toggle(false)} className="absolute right-0 bottom-full -mr-2.5 hover:bg-white" />}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close video panel"
        className="absolute top-1.5 right-1.5 flex size-11 items-center justify-center rounded-full text-navy hover:bg-white"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 fill-none stroke-current stroke-2">
          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
