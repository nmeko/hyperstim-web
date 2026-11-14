import { expect, test, type Page } from "@playwright/test";
import type { RankedChannel, RankedVideo } from "../../src/lib/api";
import { API } from "../backend";

// Safari-only bugs (plan 017). Each check would have caught a bug that reached visitors.

/**
 * The `n` most stimulating videos or channels, from the real API. With plain `fetch`: this folder's
 * Playwright is another version than the main suite's, whose helpers (`../api`) take its types.
 */
async function top<T>(kind: "videos" | "channels", n: number): Promise<T[]> {
  const res = await fetch(`${API}/api/${kind}?limit=${n}`);
  if (!res.ok) throw new Error(`${kind}: ${res.status}`);
  return ((await res.json()) as { items: T[] }).items;
}
const topVideos = (n: number) => top<RankedVideo>("videos", n);
const topChannels = (n: number) => top<RankedChannel>("channels", n);

// The cookie choice made, so the banner doesn't sit over the page (the main suite's default).
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (location.origin.startsWith("http://localhost")) {
      localStorage.setItem("hyperstim-consent", JSON.stringify({ choice: "rejected", at: Date.now() }));
    }
  });
});

/**
 * The page's buttons, links and fields whose center doesn't hit them (each line's, for a link
 * that wraps): something else covers them there, so a tap goes elsewhere. Each is scrolled to the middle of the screen first.
 * Thumbnails in the over-years charts overlap like a fanned deck on purpose, so they're left out.
 */
async function coveredControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const covered: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type="hidden"]), select, textarea, summary',
    );
    for (const el of controls) {
      if (el.id.startsWith("thumb-") || el.closest("[hidden]")) continue;
      // Inside a closed <details> (not its summary): not shown, though WebKit still gives it a size.
      const details = el.closest("details");
      if (details && !details.open && !el.closest("summary")) continue;
      const box = el.getBoundingClientRect();
      // Not shown, or visually hidden (sr-only).
      if (box.width < 2 || box.height < 2 || getComputedStyle(el).visibility === "hidden") continue;
      el.scrollIntoView({ block: "center", inline: "center" });
      // A link that wraps has a box per line; the middle of its outer box can fall between them.
      const hits = Array.from(el.getClientRects(), (r) => document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      const hit = hits.find((h) => h && !el.contains(h));
      if (hit) {
        const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40);
        const by = (hit.closest("a, button")?.textContent ?? hit.tagName).trim().slice(0, 40);
        covered.push(`${el.tagName.toLowerCase()} “${name}” is covered by “${by}”`);
      }
    }
    return covered;
  });
}

test.describe("every tap reaches the control under it", () => {
  test("home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("table").getByRole("link").first()).toBeVisible();
    expect(await coveredControls(page)).toEqual([]);
  });

  test("rankings, videos and channels", async ({ page }) => {
    for (const path of ["/rankings/", "/rankings/?view=channels"]) {
      await page.goto(path);
      await expect(page.getByText(/^Showing 1–/)).toBeVisible();
      expect(await coveredControls(page), path).toEqual([]);
    }
  });

  test("compare, videos and channels", async ({ page }) => {
    const [v1, v2] = await topVideos(2);
    const [c1, c2] = await topChannels(2);
    for (const path of [`/compare/?a=${v1.id}&b=${v2.id}`, `/compare/?view=channels&a=${c1.id}&b=${c2.id}`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 2, name: "How they compare" })).toBeVisible();
      expect(await coveredControls(page), path).toEqual([]);
    }
  });

  test("video and channel pages", async ({ page }) => {
    const [video] = await topVideos(1);
    const [channel] = await topChannels(1);
    for (const path of [`/video/?id=${video.id}`, `/channel/?id=${channel.id}`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("region", { name: "Stimulation score" })).toBeVisible();
      expect(await coveredControls(page), path).toEqual([]);
    }
  });

  test("text pages", async ({ page }) => {
    for (const path of ["/how-it-works/", "/about/", "/privacy/"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await coveredControls(page), path).toEqual([]);
    }
  });
});

test("compare: each measurement's info popup opens next to its button", async ({ page }) => {
  const [v1, v2] = await topVideos(2);
  await page.goto(`/compare/?a=${v1.id}&b=${v2.id}`);
  const buttons = page.getByRole("table").getByRole("button", { name: /^About / });
  await expect(buttons.first()).toBeVisible();
  for (const button of await buttons.all()) {
    await button.click();
    const popup = page.locator(`#${await button.getAttribute("aria-controls")}`);
    await expect(popup).toBeVisible();
    const b = (await button.boundingBox())!;
    const p = (await popup.boundingBox())!;
    // Right under the button, or right above it when there's no room below.
    const gap = Math.min(Math.abs(p.y - (b.y + b.height)), Math.abs(p.y + p.height - b.y));
    expect(gap, `${await button.getAttribute("aria-label")}: ${Math.round(gap)} px from its button`).toBeLessThan(24);
    await page.keyboard.press("Escape");
  }
});

test("blog: the post's video keeps its 16:9 box, and newer / older sit side by side from sm", async ({ page }) => {
  for (const path of ["/blog/", "/blog/every-element/", "/blog/test-post-05/"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await coveredControls(page), path).toEqual([]);
  }
  await page.goto("/blog/every-element/");
  const video = (await page.locator("video").boundingBox())!;
  expect(Math.abs(video.width / video.height - 16 / 9)).toBeLessThan(0.05);
  await page.goto("/blog/test-post-05/");
  const more = page.getByRole("navigation", { name: "More posts" });
  const newer = (await more.getByRole("link", { name: /Newer post/ }).boundingBox())!;
  const older = (await more.getByRole("link", { name: /Older post/ }).boundingBox())!;
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    expect(Math.abs(older.y - newer.y), "side by side").toBeLessThan(2);
    expect(older.x + older.width).toBeGreaterThan(newer.x + newer.width);
  } else {
    expect(older.y, "stacked").toBeGreaterThan(newer.y);
  }
});

test("blog: a clip comparison's videos keep 16:9, each lane under its video on phones, both under the videos from 30rem", async ({ page }) => {
  await page.goto("/blog/every-element/");
  const block = page.getByRole("figure").filter({ hasText: "Two videos of the same nursery rhyme." });
  await block.scrollIntoViewIfNeeded();
  const play = (side: string) => block.getByRole("button", { name: new RegExp(`^Play video\\W+${side}: `) });
  const box = async (side: string) => (await play(side).locator("xpath=../..").boundingBox())!;
  const [a, b] = [await box("A"), await box("B")];
  expect(Math.abs(a.width / a.height - 16 / 9)).toBeLessThan(0.05);
  const laneA = (await block.getByRole("slider", { name: /^Video A: / }).boundingBox())!;
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    expect(Math.abs(a.y - b.y), "videos side by side").toBeLessThan(2);
    expect(laneA.y, "lanes under both videos").toBeGreaterThan(b.y + b.height);
  } else {
    expect(laneA.y, "lane A under video A").toBeGreaterThan(a.y + a.height);
    expect(b.y, "video B under lane A").toBeGreaterThan(laneA.y + laneA.height);
  }
  expect(await coveredControls(page)).toEqual([]);
});
