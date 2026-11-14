import { topVideos } from "./api";
import { expect, tabTo, test } from "./fixtures";

test.describe("video", () => {
  test("shows the score and every measurement", async ({ page, request }) => {
    const [video] = await topVideos(request);
    await page.goto(`/video/?id=${video.id}`);
    await expect(page.getByRole("heading", { level: 1, name: video.title })).toBeVisible();
    const panel = page.getByRole("region", { name: "Stimulation score" });
    await expect(panel.getByText(`Stimulation score ${Math.round(video.score)} out of 100`)).toBeVisible();
    await expect(panel.getByRole("listitem")).toHaveCount(video.features.length);
  });

  test("a measurement's ⓘ explains it and closes on Escape", async ({ page, request }) => {
    const [video] = await topVideos(request);
    await page.goto(`/video/?id=${video.id}`);
    const info = page.getByRole("button", { name: "About Rapid cutting" });
    await tabTo(page, info);
    await page.keyboard.press("Enter");
    await expect(info).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(info).toHaveAttribute("aria-expanded", "false");
  });

  test("the score's ⓘ opens on top of the measurements and inside a 320 px screen", async ({ page, request }) => {
    const [video] = await topVideos(request);
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(`/video/?id=${video.id}`);
    const info = page.getByRole("button", { name: "About the stimulation score" });
    await info.click();
    const popover = page.locator("#score-info");
    await expect(popover).toBeVisible();
    const box = (await popover.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(320 - 16);
    // Nothing later in the page (the measurement rows below it) draws over it.
    const onTop = await popover.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.bottom - 12));
    });
    expect(onTop).toBe(true);
  });

  test("Play shows the video large; Shrink video puts the preview back and focus on it", async ({ page, request }) => {
    const [video] = await topVideos(request);
    await page.goto(`/video/?id=${video.id}`);
    const play = page.getByRole("button", { name: /^Play video/ });
    await tabTo(page, play);
    await page.keyboard.press("Enter");
    await expect(page.locator("iframe")).toBeVisible();
    await page.getByRole("button", { name: "Shrink video" }).click();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(play).toBeFocused();
  });

  test("links to its channel and to compare", async ({ page, request }) => {
    const [video] = await topVideos(request);
    await page.goto(`/video/?id=${video.id}`);
    await page.getByRole("link", { name: video.channel, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: video.channel })).toBeVisible();

    await page.goBack();
    await page.getByRole("link", { name: "Compare with another video" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Compare" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Video A" }).getByRole("link", { name: video.title })).toBeVisible();
  });

  test("an ID that isn't a video's says so", async ({ page }) => {
    await page.goto("/video/?id=not-an-id");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Stimulation score" })).toHaveCount(0);
  });
});
