import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { SITE_PORT } from "../backend";
import { servers } from "../servers";

// The Safari check (plan 017): a few end-to-end checks in WebKit 26, the engine of the newest
// shipping Safari, which still has bugs the main suite's newer WebKit has fixed (table rows that
// can't hold an overlay, WebKit bug 240961). Its own Playwright version, pinned in this folder's
// package.json; same servers as the main suite.
const CI = !!process.env.CI;

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${SITE_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "safari-desktop", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 } } },
    { name: "safari-phone", use: { ...devices["iPhone 13"], viewport: { width: 360, height: 740 } } },
  ],
  webServer: servers(path.join(__dirname, "../.."), CI),
});
