"use client";

import Link from "next/link";
import RollingNumber, { countUpMs } from "@/components/RollingNumber";
import { asset } from "@/lib/asset";
import { useGrowth } from "@/lib/use-growth";

export default function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center md:gap-x-8 md:gap-y-6 lg:grid-cols-[55fr_45fr] lg:gap-x-10"
    >
      <h1
        id="hero-heading"
        className="font-hand text-[2rem] leading-tight font-semibold text-balance text-navy sm:text-[2.75rem] md:col-start-1 md:row-start-1 md:self-end lg:text-[3.25rem]"
      >
        How stimulating are the videos <span className="marker">your child watches?</span>
      </h1>

      <div
        aria-hidden="true"
        className="hidden md:col-start-2 md:row-span-2 md:row-start-1 md:mx-auto md:block md:w-[21.5rem] lg:w-[24.5rem] xl:w-[29rem]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, images pre-converted */}
        <img
          src={asset("/images/kid_1.webp")}
          alt=""
          width={928}
          height={464}
          className="h-auto w-full"
        />
      </div>

      <div className="max-w-prose text-lg md:col-start-1 md:row-start-2 md:self-start">
        <p>
          From rapid scene changes to bright colors and loud sounds, children’s videos vary in how
          stimulating they are.
        </p>
        <DatasetLine />
      </div>
    </section>
  );
}

/**
 * The dataset's size and what it gained in the past week, growing while the page is open (plan 013;
 * see STYLE.md, Growing counts and Growth badge). The sentence, the badges and their key are there
 * from the first paint, with skeleton bars for the numbers, which then count up; only if the counts
 * can't be had does the sentence say "thousands of" instead.
 */
function DatasetLine() {
  const growth = useGrowth();
  if (growth === "failed") {
    return <p className="mt-4">Explore and compare thousands of videos to better understand what your child is watching.</p>;
  }
  if (growth === "loading") {
    return (
      <>
        <p className="mt-4" aria-busy="true">
          Explore and compare{" "}
          {/* Until the numbers come, words for those who read text, not bars (plan 011). */}
          <b className="font-bold text-navy">
            <span className="sr-only">thousands of</span>
            <Room digits="00,000" />
          </b>
          {"\u00a0"}
          <span className={BADGE}>
            <Arrow className="mr-[0.14em]" />
            <Room digits="000" />
          </span>{" "}
          videos from{" "}
          <b className="font-bold text-navy">
            <span className="sr-only">hundreds of</span>
            <Room digits="000" />
          </b>
          {"\u00a0"}
          <span className={BADGE}>
            <Arrow className="mr-[0.14em]" />
            <Room digits="00" />
          </span>{" "}
          channels to better understand what your child is watching.
        </p>
        <Key />
      </>
    );
  }
  // All four count up at one speed: the longest rise takes the full count-up (plan 013).
  const rises = [
    growth.videos - growth.from.videos,
    growth.channels - growth.from.channels,
    growth.pastWeek.videos,
    growth.pastWeek.channels,
  ];
  const longest = Math.max(...rises);
  const query = new URLSearchParams({ q: growth.pastWeekQuery });
  return (
    <>
      <p className="mt-4">
        Explore and compare{" "}
        <b className="font-bold text-navy">
          <RollingNumber value={growth.videos} from={growth.from.videos} duration={countUpMs(rises[0], longest)} />
        </b>
        <Gain
          value={growth.pastWeek.videos}
          duration={countUpMs(rises[2], longest)}
          noun="videos"
          href={`/rankings?${query}`}
        />{" "}
        videos from{" "}
        <b className="font-bold text-navy">
          <RollingNumber value={growth.channels} from={growth.from.channels} duration={countUpMs(rises[1], longest)} />
        </b>
        <Gain
          value={growth.pastWeek.channels}
          duration={countUpMs(rises[3], longest)}
          noun="channels"
          href={`/rankings?view=channels&${query}`}
        />{" "}
        channels to better understand what your child is watching.
      </p>
      {(growth.pastWeek.videos > 0 || growth.pastWeek.channels > 0) && <Key />}
    </>
  );
}

/** A raised badge after a total: what it gained in the past week, linking to the rankings that list them. */
function Gain({ value, duration, noun, href }: { value: number; duration: number; noun: string; href: string }) {
  if (value <= 0) return null;
  // A no-break space, not a margin, so copied text reads "16,402 1,043" and the badge stays with its total.
  return (
    <>
      {"\u00a0"}
      <Link
        href={href}
        aria-label={`${value.toLocaleString("en-US")} ${noun} added in the past week`}
        className={`${BADGE} transition-colors hover:bg-sky-blue/25`}
      >
        <Arrow className="mr-[0.14em]" />
        <RollingNumber value={value} from={0} duration={duration} />
      </Link>
    </>
  );
}

/** What the badges mean. Screen readers hear it in each badge's link instead. */
function Key() {
  return (
    <p className="mt-3 text-sm text-ink" aria-hidden="true">
      <span className={`${BADGE_LOOK} mr-1`}>
        <Arrow />
      </span>
      added in the past week
    </p>
  );
}

/** A small solid "up" triangle, drawn: the body font has no arrow, and a borrowed one looks
 * different on every device. */
function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 10 12"
      className={`inline-block h-[0.66em] w-auto overflow-visible align-baseline ${className}`}
    >
      <path d="M5 3.2 9 10H1Z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

const BADGE_LOOK = "inline-block rounded-full bg-sky px-[7px] text-sm leading-5 font-bold whitespace-nowrap text-navy";
/** Raised a little, so it reads as a note on the total's digits. */
const BADGE = `${BADGE_LOOK} align-[0.4em]`;

/**
 * A skeleton bar where a number will be, as wide as `digits`, so nothing moves when it comes. The
 * digits are drawn by CSS, not text, so readers of the page as built (crawlers, link previews) never
 * see "00,000" (plan 011, Readers other than people).
 */
function Room({ digits }: { digits: string }) {
  return (
    <span
      aria-hidden="true"
      data-digits={digits}
      className="animate-pulse rounded bg-gray-200 text-transparent tabular-nums before:content-[attr(data-digits)]"
    />
  );
}
