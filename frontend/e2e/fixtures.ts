import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { API, SITE_PORT } from "./backend";

export { expect };

// A 1×1 PNG for thumbnails, which the backend would otherwise fetch from YouTube.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const SITE = `http://localhost:${SITE_PORT}`;
const YOUTUBE = /^https:\/\/(www\.)?youtube(-nocookie)?\.com\//;
const GOOGLE_TAG = /^https:\/\/www\.googletagmanager\.com\//;

type Options = {
  /** The cookie choice saved before the page opens; null = first visit (the banner shows). */
  consent: "accepted" | "rejected" | null;
};
type Fixtures = {
  /** Requests to hosts other than our two servers, YouTube embeds and Google's tag. */
  outsideRequests: string[];
  /** Requests to YouTube embeds (answered with an empty page). */
  youtubeRequests: string[];
  /** Requests for Google's tag (answered with an empty script). */
  googleRequests: string[];
};

/**
 * The E2E `test`: no request leaves our two servers. YouTube embeds and Google's tag get empty
 * answers and are counted, so tests can check when they load (plan 009); thumbnails get a
 * local image; anything else fails the test.
 */
export const test = base.extend<Options & Fixtures>({
  consent: ["rejected", { option: true }],
  outsideRequests: async ({}, provide) => provide([]),
  youtubeRequests: async ({}, provide) => provide([]),
  googleRequests: async ({}, provide) => provide([]),
  context: async ({ context, consent, outsideRequests, youtubeRequests, googleRequests }, provide) => {
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(`${API}/api/thumbnails/`)) {
        return route.fulfill({ contentType: "image/png", body: PIXEL });
      }
      // blob: is the page's own (WebKit plays a <video> through one).
      if (url.startsWith(SITE) || url.startsWith(API) || url.startsWith("data:") || url.startsWith("blob:")) {
        return route.continue();
      }
      if (YOUTUBE.test(url)) {
        youtubeRequests.push(url);
        return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Player</title>" });
      }
      if (GOOGLE_TAG.test(url)) {
        googleRequests.push(url);
        return route.fulfill({ contentType: "text/javascript", body: "" });
      }
      outsideRequests.push(url);
      return route.abort();
    });
    if (consent) {
      await context.addInitScript((choice) => {
        // Also runs in the (empty) YouTube frames, which may not use localStorage.
        if (location.origin.startsWith("http://localhost")) {
          localStorage.setItem("hyperstim-consent", JSON.stringify({ choice, at: Date.now() }));
        }
      }, consent);
    }
    await provide(context);
    expect(outsideRequests, "requests to other hosts").toEqual([]);
  },
});

/** Fails on any axe-core violation on the page as it is now (contrast included). */
/** Whether this run is one of the phone-width projects (their layouts differ from desktop). */
export function isPhone() {
  return base.info().project.name.endsWith("-phone");
}

export async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const report = violations.map(
    (v) => `${v.id}: ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(" ")}`).join("\n")}`,
  );
  expect(report, "axe-core violations").toEqual([]);
}

/** Fails if the page scrolls sideways at 320 px, the narrowest phone width we support. */
export async function expectNoSidewaysScroll(page: Page) {
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: size.height });
  // Polled: charts measure their box in JS and catch up with a resize a frame or so later.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), {
      message: "sideways scroll at 320 px (px)",
    })
    .toBeLessThanOrEqual(0);
  await page.setViewportSize(size);
}

/**
 * Presses Tab until `target` has focus (failing after `max` presses), then checks that the
 * focus shows: an outline or a ring (STYLE.md, Focus).
 */
export async function tabTo(page: Page, target: Locator, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) {
      await expectFocusShows(target);
      return;
    }
  }
  throw new Error(`Not reached with ${max} Tab presses: ${target}`);
}

export async function expectFocusShows(target: Locator) {
  const shows = await target.evaluate((el) => {
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
    return outline || style.boxShadow !== "none";
  });
  expect(shows, `visible focus on ${target}`).toBe(true);
}
