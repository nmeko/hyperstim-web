import { topChannels, topVideos } from "./api";
import { expect, isPhone, test } from "./fixtures";

test.describe("compare", () => {
  test("two videos picked by search, by keyboard, give a shareable comparison", async ({ page, request }) => {
    const [v1, v2] = await topVideos(request, 2);
    await page.goto("/compare/");
    for (const [slot, video] of [
      ["Video A", v1],
      ["Video B", v2],
    ] as const) {
      const region = page.getByRole("region", { name: slot });
      const picker = region.getByRole("combobox", { name: "Video name or video link" });
      await picker.fill(video.title);
      await expect(region.getByRole("option").first()).toBeVisible();
      await picker.press("ArrowDown");
      await picker.press("Enter");
      await expect(region.getByRole("link", { name: video.title, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("heading", { level: 2, name: "How they compare" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`a=${v1.id}.*b=${v2.id}`));

    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "How they compare" })).toBeVisible();
  });

  test("a pasted video link fills the slot", async ({ page, request }) => {
    const [video] = await topVideos(request);
    await page.goto("/compare/");
    const region = page.getByRole("region", { name: "Video A" });
    await region.getByRole("combobox").fill(`https://youtu.be/${video.id}`);
    await region.getByRole("combobox").press("Enter");
    await expect(region.getByRole("link", { name: video.title, exact: true })).toBeVisible();
  });

  test("removing a video puts focus back in its picker", async ({ page, request }) => {
    const [v1, v2] = await topVideos(request, 2);
    await page.goto(`/compare/?a=${v1.id}&b=${v2.id}`);
    const region = page.getByRole("region", { name: "Video A" });
    await region.getByRole("button", { name: "Remove video A" }).click();
    await expect(region.getByRole("combobox", { name: "Video name or video link" })).toBeFocused();
    await expect(page.getByRole("heading", { level: 2, name: "How they compare" })).toHaveCount(0);
  });

  test("two channels", async ({ page, request }) => {
    const [c1, c2] = await topChannels(request, 2);
    await page.goto("/compare/");
    await page.getByRole("group", { name: "Compare" }).getByRole("button", { name: "Channels" }).click();
    for (const [slot, channel] of [
      ["Channel A", c1],
      ["Channel B", c2],
    ] as const) {
      const region = page.getByRole("region", { name: slot });
      await region.getByRole("combobox").fill(channel.name);
      await region.getByRole("option", { name: new RegExp(`^${channel.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first().click();
      await expect(region.getByRole("link", { name: channel.name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("heading", { level: 2, name: "How they compare" })).toBeVisible();
  });

  test("a video on the two-channel chart opens under the chart, without leaving the page", async ({ page, request }) => {
    const [c1, c2] = await topChannels(request, 2);
    await page.goto(`/compare/?view=channels&a=${c1.id}&b=${c2.id}`);
    await expect(page.getByRole("heading", { level: 2, name: "Over the years" })).toBeVisible();
    if (isPhone()) {
      // A tap shows the card under the chart, and no popup under the finger.
      const hit = page.locator("[data-hit]").first();
      await hit.scrollIntoViewIfNeeded();
      const box = (await hit.boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.getByRole("region", { name: "Picked video" })).toBeVisible();
      await expect(page.locator("[data-popover]")).toHaveCount(0);
    } else {
      // The thumbnails under the chart open the video panel, also by keyboard.
      const thumb = page.getByRole("button", { name: /^B: / }).first();
      await thumb.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Close video panel" })).toBeVisible();
      await expect(thumb).toHaveAttribute("aria-current", "true");
    }
    await expect(page).toHaveURL(/\/compare\//);
  });

  test("a finger held on the chart spreads the dots, and lifting opens the one under it", async ({ page, request }) => {
    // A held, sliding touch needs Chromium's DevTools input; Playwright's touchscreen only taps.
    test.skip(test.info().project.name !== "chromium-phone", "held touches are sent through Chromium's DevTools");
    const [c1, c2] = await topChannels(request, 2);
    await page.goto(`/compare/?view=channels&a=${c1.id}&b=${c2.id}`);
    const hit = page.locator("[data-hit]").first();
    await hit.scrollIntoViewIfNeeded();
    const box = (await hit.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const send = (type: "touchStart" | "touchMove" | "touchEnd", px: number, py: number) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: px, y: py }] });
    await send("touchStart", x, y);
    await page.waitForTimeout(500);
    await send("touchMove", x + 1, y);
    await expect(page.locator("[data-popover]")).toBeVisible();
    await expect(page.locator("[data-dot].opacity-30").first()).toBeAttached();
    await send("touchEnd", x + 1, y);
    await expect(page.getByRole("region", { name: "Picked video" })).toBeVisible();
    await expect(page.locator("[data-popover]")).toHaveCount(0);
    await expect(page).toHaveURL(/\/compare\//);
  });

  test("the suggestions fit above an on-screen keyboard, with the field in view", async ({ page }) => {
    test.skip(!isPhone(), "phones have the on-screen keyboard");
    // The keyboard takes the bottom 291 px, as on an iPhone: the visual viewport shrinks.
    await page.addInitScript(() => {
      const view = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, scale: 1 });
      Object.defineProperties(view, { height: { get: () => innerHeight - 291 }, width: { get: () => innerWidth } });
      Object.defineProperty(window, "visualViewport", { value: view });
    });
    await page.goto("/compare/");
    const field = page.getByRole("region", { name: "Video A" }).getByRole("combobox");
    await field.tap();
    await page.keyboard.type("a");
    const list = page.getByRole("listbox").first();
    await expect(list.getByRole("option").first()).toBeVisible();
    const visible = page.viewportSize()!.height - 291;
    await expect.poll(async () => (await list.boundingBox())!.y + (await list.boundingBox())!.height).toBeLessThanOrEqual(visible);
    const box = (await field.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(visible);
  });
});
