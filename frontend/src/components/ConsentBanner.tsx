"use client";

import { useEffect, useRef, useState } from "react";
import {
  analyticsLoaded,
  consentNeeded,
  deleteAnalyticsCookies,
  loadAnalytics,
  OPEN_EVENT,
  saveChoice,
  savedChoice,
  type Choice,
} from "@/lib/consent";

const BUTTON = "h-12 flex-1 rounded-full bg-primary px-6 font-bold text-white hover:bg-navy sm:flex-none";

/**
 * The cookie choice for Google Analytics (plan 009; STYLE.md, Consent banner). Shown on the first
 * visit and when "Cookie settings" is pressed; not modal, so the site works while it's open. It
 * comes first in the page's reading order but takes focus only when reopened on request.
 */
export default function ConsentBanner() {
  const [open, setOpen] = useState(false);
  // The current choice, shown when the banner is reopened.
  const [current, setCurrent] = useState<Choice | null>(null);
  const region = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!consentNeeded()) return;
    const choice = savedChoice();
    if (choice === "accepted") loadAnalytics();
    // Read in the browser only, so the static HTML has no banner to flash.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else if (choice === null) setOpen(true);

    const reopen = () => {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setCurrent(savedChoice());
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, reopen);
    return () => window.removeEventListener(OPEN_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (open && returnFocus.current) region.current?.focus();
  }, [open]);

  function choose(choice: Choice) {
    const withdrawing = choice === "rejected" && analyticsLoaded();
    saveChoice(choice);
    if (choice === "accepted") loadAnalytics();
    if (withdrawing) {
      // Google's tag can't be unloaded: delete its cookies and start the page afresh without it.
      deleteAnalyticsCookies();
      location.reload();
      return;
    }
    setOpen(false);
    setCurrent(null);
    returnFocus.current?.focus();
    returnFocus.current = null;
  }

  if (!open) return null;
  return (
    <section
      ref={region}
      tabIndex={-1}
      aria-labelledby="consent-title"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 focus:outline-none"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="pointer-events-auto ml-auto max-w-lg rounded-2xl border border-navy/15 bg-white p-4 shadow-[0_4px_16px_rgb(15_46_138/0.08)] sm:p-5">
          <p id="consent-title" className="font-semibold text-navy">
            Cookies on HyperStim?
          </p>
          <p className="mt-1 text-sm text-ink">
            We’d like to use analytics cookies from Google Analytics to understand how people use the site and improve
            it. We set them only if you accept.
          </p>
          {current && (
            <p className="mt-2 text-sm font-semibold text-navy">
              Your current choice: {current === "accepted" ? "accepted" : "rejected"}.
            </p>
          )}
          <div className="mt-4 flex gap-2 sm:justify-center">
            <button type="button" className={BUTTON} onClick={() => choose("accepted")}>
              Accept
            </button>
            <button type="button" className={BUTTON} onClick={() => choose("rejected")}>
              Reject
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
