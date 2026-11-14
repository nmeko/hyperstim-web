// Consent for Google Analytics (plan 009). Nothing from Google loads until the visitor accepts
// ("basic" consent mode). The choice is kept in localStorage for 12 months; Global Privacy
// Control and Do Not Track count as a Reject. Without a GA ID (local dev, CI, forks) there is
// nothing to consent to, so no banner and no analytics.

export type Choice = "accepted" | "rejected";

const KEY = "hyperstim-consent";
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const SCRIPT_ID = "ga-script";
/** Fired to reopen the banner (the "Cookie settings" buttons). */
export const OPEN_EVENT = "hyperstim:consent-open";

// The choice when localStorage is blocked: it holds for this page view only.
let unsaved: Choice | null = null;

// Read where it's used, so Next.js inlines it at build time and tests can stub it.
export function gaId(): string {
  return process.env.NEXT_PUBLIC_GA_ID ?? "";
}

/** True when the browser asks not to be tracked (GPC or DNT). */
export function privacySignal(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

/** Whether a consent banner applies at all: a GA ID is set and no privacy signal is on. */
export function consentNeeded(): boolean {
  return gaId() !== "" && !privacySignal();
}

/** The saved choice, or null if none, it's older than 12 months, or unreadable. */
export function savedChoice(now = Date.now()): Choice | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { choice, at } = JSON.parse(raw) as { choice?: unknown; at?: unknown };
    if ((choice !== "accepted" && choice !== "rejected") || typeof at !== "number") return null;
    return now - at < MAX_AGE_MS ? choice : null;
  } catch {
    return unsaved;
  }
}

export function saveChoice(choice: Choice, now = Date.now()) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ choice, at: now }));
  } catch {
    unsaved = choice;
  }
}

export function analyticsLoaded(): boolean {
  return document.getElementById(SCRIPT_ID) !== null;
}

/** Adds Google's tag once, with Google Signals, ad storage and ad personalisation off. */
export function loadAnalytics(id = gaId()) {
  if (!id || analyticsLoaded()) return;
  const w = window as Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
  w.dataLayer = w.dataLayer ?? [];
  w.gtag = function gtag() {
    // gtag.js expects the `arguments` object itself, not an array.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  w.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  w.gtag("js", new Date());
  w.gtag("config", id, { allow_google_signals: false, allow_ad_personalization_signals: false });

  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

/**
 * Deletes Google Analytics' cookies (`_ga`, `_ga_<ID>`). GA sets them on the highest domain it
 * can, so each parent domain of this host is tried, as well as no domain.
 */
export function deleteAnalyticsCookies() {
  const names = document.cookie
    .split(";")
    .map((c) => c.split("=")[0].trim())
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));
  const parts = location.hostname.split(".");
  const domains = ["", ...parts.map((_, i) => parts.slice(i).join("."))];
  for (const name of names) {
    for (const domain of domains) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? `; domain=${domain}` : ""}`;
    }
  }
}

export function openConsentSettings() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}
