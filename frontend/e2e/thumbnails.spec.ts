import type { Page } from "@playwright/test";
import { channelVideos, topChannels } from "./api";
import { API } from "./backend";
import { expect, expectNoAxeViolations, isPhone, test } from "./fixtures";

// A thumbnail that can't load (e.g. the video is gone from YouTube) is a placeholder in its
// place, never the browser's broken image (plan 009, Thumbnails).

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

const VIDEO_GONE = "This video may have been removed or made private on YouTube.";

/** Our backend answers this for the video's thumbnails: 404 when YouTube no longer has them, 502 when YouTube is down. */
async function answer(page: Page, id: string, status: 404 | 502 = 404) {
  await page.route(
    (url) => url.href.startsWith(`${API}/api/thumbnails/${id}?`),
    (route) => route.fulfill({ status, body: "", headers: { "Access-Control-Allow-Origin": "*" } }),
  );
}
const gone = (page: Page, id: string) => answer(page, id);

async function oldestVideo(request: Parameters<typeof channelVideos>[0]) {
  const [channel] = await topChannels(request);
  const videos = await channelVideos(request, channel.id);
  const video = [...videos].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))[0];
  return { channel, video, title: new RegExp(escape(video.title)) };
}

test.describe("a thumbnail that can't load", () => {
  test("is a placeholder on the channel page, the rest unchanged", async ({ page, request }) => {
    const { channel, video, title } = await oldestVideo(request);
    await gone(page, video.id);
    await page.goto(`/channel/?id=${channel.id}`);
    // From `sm` its thumbnail hangs under the chart; on phones it's the strip's first card.
    const holder = isPhone() ? page.getByRole("link", { name: title }).first() : page.getByRole("button", { name: title }).first();
    await holder.scrollIntoViewIfNeeded();
    const placeholder = holder.locator("[data-thumbnail-missing]");
    await expect(placeholder).toBeVisible();
    await expect(placeholder.locator("svg")).toBeVisible();
    await expect(holder.locator("img")).toHaveCount(0);
    // Another video's thumbnail still loads.
    const loaded = page.locator('img[src*="/api/thumbnails/"]').filter({ visible: true }).first();
    await expect(loaded).toHaveJSProperty("complete", true);
    expect(await loaded.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expectNoAxeViolations(page);
  });

  test("leaves the video page's preview a plain tile that still plays", async ({ page, request, youtubeRequests }) => {
    const { video } = await oldestVideo(request);
    await gone(page, video.id);
    await page.goto(`/video/?id=${video.id}`);
    const play = page.getByRole("button", { name: /^Play video/ });
    await expect(play).toBeVisible();
    const placeholder = page.locator("[data-thumbnail-missing]");
    await expect(placeholder).toBeVisible();
    await expect(placeholder.locator("svg")).toHaveCount(0); // the Play button is in the middle
    await play.click();
    await expect.poll(() => youtubeRequests.length).toBeGreaterThan(0);
  });

  test("says on the video page that the video may be gone", async ({ page, request }) => {
    const { video } = await oldestVideo(request);
    await gone(page, video.id);
    await page.goto(`/video/?id=${video.id}`);
    const note = page.getByText(VIDEO_GONE).filter({ visible: true });
    await expect(note).toHaveCount(1);
    // Under the preview from `sm`; on phones the preview is narrow, so under the title, full width.
    const [noteBox, previewBox, titleBox] = await Promise.all([
      note.boundingBox(),
      page.getByRole("button", { name: /^Play video/ }).locator("..").boundingBox(),
      page.getByRole("heading", { level: 1 }).boundingBox(),
    ]);
    if (isPhone()) {
      expect(noteBox!.x).toBeCloseTo(titleBox!.x, 0);
      expect(noteBox!.y).toBeGreaterThan(previewBox!.y + previewBox!.height);
    } else {
      expect(noteBox!.x).toBeCloseTo(previewBox!.x, 0);
      expect(noteBox!.y).toBeGreaterThan(previewBox!.y + previewBox!.height);
    }
    await expectNoAxeViolations(page);
  });

  test("says nothing about the video while YouTube is down", async ({ page, request }) => {
    const { video } = await oldestVideo(request);
    await answer(page, video.id, 502);
    const asked = page.waitForRequest((r) => r.url().includes(`/api/thumbnails/${video.id}?size=mq`));
    await page.goto(`/video/?id=${video.id}`);
    await expect(page.locator("[data-thumbnail-missing]")).toBeVisible();
    await asked; // the status check
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(VIDEO_GONE)).toHaveCount(0);
  });

  test("says in the chart's popover and the video panel that the video may be gone", async ({ page, request }) => {
    const { channel, video, title } = await oldestVideo(request);
    await gone(page, video.id);
    await page.goto(`/channel/?id=${channel.id}`);
    const popover = page.locator("[data-popover]");
    if (isPhone()) {
      // The strip's card shows the placeholder; its dot, tapped, shows the popover. (Clicked
      // directly: neighbouring dots overlap, so a tap at its spot may hit another video.)
      const card = page.getByRole("link", { name: title }).first();
      await card.scrollIntoViewIfNeeded();
      await expect(card.locator("[data-thumbnail-missing]")).toBeVisible();
      await page.locator(`[data-hit="${video.id}"]`).dispatchEvent("click");
      await expect(popover).toContainText(VIDEO_GONE);
    } else {
      // Focus shows the same popover as hover; the thumbnail may sit under another in its stack.
      const thumb = page.getByRole("button", { name: title }).first();
      await thumb.scrollIntoViewIfNeeded();
      await expect(thumb.locator("[data-thumbnail-missing]")).toBeVisible();
      await thumb.focus();
      await expect(popover).toContainText(VIDEO_GONE);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("region", { name: title }).getByText(VIDEO_GONE)).toBeVisible();
    }
  });

  test("is a placeholder in the compare picker's suggestions", async ({ page, request }) => {
    const { video } = await oldestVideo(request);
    await gone(page, video.id);
    await page.goto("/compare/");
    const picker = page.getByRole("region", { name: "Video A" }).getByRole("combobox", { name: "Video name or video link" });
    await picker.fill(video.title);
    // Only its own suggestion (another video may share the title).
    const list = page.getByRole("listbox", { name: "Suggested videos" });
    await expect(list.getByRole("option").first()).toBeVisible();
    await expect(list.locator("[data-thumbnail-missing] svg")).toHaveCount(1);
    await expect(list.locator("[data-thumbnail-missing] svg")).toBeVisible();
    // Picked, its slot says the video may be gone.
    await list.getByRole("option").filter({ has: page.locator("[data-thumbnail-missing]") }).click();
    await expect(page.getByRole("region", { name: "Video A" }).getByText(VIDEO_GONE)).toBeVisible();
  });
});
