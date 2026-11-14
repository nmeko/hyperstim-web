import type { ReactNode } from "react";
import CookieSettings from "@/components/CookieSettings";
import { asset } from "@/lib/asset";

// The privacy policy (plan 009). Every statement must stay true: a change to what the site or the
// backend stores, logs, or loads from other companies is agreed first, then updates this page in the
// same change (AGENTS.md).

export const LAST_UPDATED = "October 26, 2026";
export const CONTACT_URL = "https://forms.gle/oLbWLgE8sT6zHhLR9";
const GITHUB_PRIVACY = "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement";
const GOOGLE_PRIVACY = "https://policies.google.com/privacy";

const TEXT_LINK = "font-bold text-navy underline decoration-2 underline-offset-4 hover:decoration-sunny";
const H2 = "scroll-mt-4 font-hand text-2xl font-semibold text-navy sm:text-3xl";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 md:pt-12 lg:px-8">
      <Hero />
      <div className="rounded-[2rem] border border-navy/15 bg-white px-4 py-8 sm:px-8">
        <div className="divide-y divide-navy/10">
          <Section id="browsing" title="When you browse the site">
            <p>
              Our pages are hosted by GitHub Pages. Like any web host, GitHub receives your IP address and browser
              details, and logs which pages are requested. See <External href={GITHUB_PRIVACY}>GitHub’s privacy statement</External>.
            </p>
            <p>
              Our server keeps technical logs to keep the site running and safe, and counts how the site is used
              to improve it. Neither is used to identify you.
            </p>
            <p>
              If you accept when the site asks, we also use Google Analytics to count visits and see which pages are
              used. Google then receives your IP address, your browser and device, the pages you view, and the site
              that sent you here, and keeps this for 2 months. Google works for us as a service provider and may
              process the data in the US. We don’t use it for ads, and we’ve turned off sharing it with Google for
              other purposes. See <External href={GOOGLE_PRIVACY}>Google’s privacy policy</External>.
            </p>
          </Section>
          <Section id="checking" title="When you check a video">
            <p>
              When you check a video that isn’t in our dataset, we download it from YouTube, measure it, and delete
              the download as soon as it’s done.
            </p>
            <p>
              We save the results, with the video’s ID, title and channel, so they’re ready for the next person who
              checks the same video. They aren’t linked to you.
            </p>
            <p>
              When you play a video, YouTube may set cookies in your browser. See{" "}
              <External href={GOOGLE_PRIVACY}>Google’s privacy policy</External>.
            </p>
          </Section>
          <Section id="cookies" title="Cookies">
            <p>
              We set cookies only if you accept Google Analytics. It uses them to tell visits apart. They are kept for 2
              years, or until you change your choice.
            </p>
            <p>
              Your choice is saved in your browser for a year, so we don’t ask on every page. It never leaves your
              browser.
            </p>
            <p>
              If your browser sends Global Privacy Control or Do Not Track, we treat it as a no to Google Analytics and
              don’t ask.
            </p>
          </Section>
          <Section id="your-choices" title="Your choices">
            <p>
              To ask what we hold about you, or to have it deleted, please fill out the <ContactLink /> form.
            </p>
            <CookieSettings
              className={TEXT_LINK}
              label="cookie settings"
              as="p"
              before="You can change your mind about cookies at any time in "
              after="."
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

/**
 * The H1 and the date, with the kid sitting on the policy card's top edge. The kid's head is as
 * large as on the other pages (STYLE.md), so it's taller than the text and rises above it into the
 * page's top padding instead of pushing the H1 down; the hero's minimum height keeps it clear of
 * the header.
 */
function Hero() {
  return (
    <div className="relative md:min-h-36 md:pr-62 lg:min-h-40 lg:pr-73 xl:min-h-48 xl:pr-84">
      <div className="pb-6">
        <h1 className="font-hand text-[2rem] leading-tight font-semibold text-navy sm:text-[2.75rem] lg:text-[3.25rem]">
          Privacy policy
        </h1>
        <p className="mt-2 text-ink">Last updated: {LAST_UPDATED}</p>
      </div>
      {/* Sitting on the card's edge: the art's bottom 1 % is empty. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, images pre-converted */}
      <img
        src={asset("/images/kid_quiet.webp")}
        alt=""
        aria-hidden="true"
        width={544}
        height={453}
        data-kid=""
        className="pointer-events-none absolute right-0 bottom-0 z-10 hidden h-auto w-52 translate-y-[1%] md:mr-8 md:block lg:mr-12 lg:w-58 xl:w-68"
      />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 py-6 first:pt-0 last:pb-0">
      <h2 id={id} className={H2}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ContactLink() {
  return <External href={CONTACT_URL}>contact us</External>;
}

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
