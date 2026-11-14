import { defineConfig, devices } from "@playwright/test";
import { SITE_PORT } from "./e2e/backend";
import { servers } from "./e2e/servers";

// End-to-end tests (plan 012): the built static site against the real backend with the
// committed reference set. Both servers are started here; `npm run test:e2e` builds the site.
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  // The Safari check has its own Playwright and config (e2e/safari, plan 017).
  testIgnore: "safari/**",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // In CI, also each failure as an annotation on the commit, readable without the job's log.
  reporter: CI ? [["list"], ["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${SITE_PORT}`,
    trace: "retain-on-failure",
  },
  // Both engines at both widths: people use Safari on desktops and Chrome on phones too.
  // Phones at the width STYLE.md checks; tests tell them apart by the name's ending.
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 } } },
    { name: "chromium-phone", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 740 } } },
    { name: "webkit-phone", use: { ...devices["iPhone 13"], viewport: { width: 360, height: 740 } } },
  ],
  webServer: servers(__dirname, CI),
});
