import type { Page } from "@playwright/test";
import { fixedPages } from "../src/lib/site";
import { topChannels, topVideos } from "./api";
import { expect, test } from "./fixtures";

// What link previews, crawlers and AI tools read: each page as built, without running our
// JavaScript (plan 011, Readers other than people). It must make sense on its own.
test.use({ javaScriptEnabled: false });

/** Placeholder digits that only look right as a skeleton bar ("00,000", "000"), not part of a real number. */
const PLACEHOLDER = /(^|[^\d,])00+(,000)*(?![\d,])/;
/** Status lines with nothing more to say than that something loads. */
const LOADING = /\bLoading[^.…]*…/g;

async function mainText(page: Page) {
  return (await page.getByRole("main").textContent())!.replace(/\s+/g, " ").trim();
}

for (const path of fixedPages) {
  test(`/${path} reads sensibly without JavaScript`, async ({ page }) => {
    await page.goto(`/${path}`);
    await expect(page).toHaveTitle(/\S/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\S/);
    const h1 = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
    expect(h1).not.toBe("");
    const text = await mainText(page);
    expect(text).not.toMatch(PLACEHOLDER);
    // More than the heading and a loading line: something that says what the page is.
    expect(text.replace(LOADING, "").replace(h1, "").trim().length).toBeGreaterThan(40);
  });
}

// Video and channel pages are one page for every ID, filled in by the browser; without
// JavaScript they say only what they are (plan 011, Future improvements).
test("video and channel pages have a title and heading without JavaScript", async ({ page, request }) => {
  const [[video], [channel]] = await Promise.all([topVideos(request), topChannels(request)]);
  for (const path of [`/video/?id=${video.id}`, `/channel/?id=${channel.id}`]) {
    await page.goto(path);
    await expect(page).toHaveTitle(/\S/);
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
    expect(await mainText(page)).not.toMatch(PLACEHOLDER);
  }
});

// A blog post is all in the built page: the text, its figures and references (plan 018).
test("a blog post reads in full without JavaScript", async ({ page }) => {
  await page.goto("/blog/every-element/");
  await expect(page).toHaveTitle("An example post with every element - HyperStim?");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\S/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("An example post with every element");
  await expect(page.getByRole("region", { name: "TL;DR" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "References" })).toBeVisible();
  await expect(page.getByText("Figure 1.")).toBeVisible();
  const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(jsonLd).toMatchObject({ "@type": "BlogPosting", datePublished: "2026-11-09" });
  const text = await mainText(page);
  expect(text).not.toMatch(PLACEHOLDER);
  expect(text).toContain("That's everything.");
});
