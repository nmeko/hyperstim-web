import { channelVideos, topChannels } from "./api";
import { type Page } from "@playwright/test";
import { expect, expectNoAxeViolations, isPhone, tabTo, test } from "./fixtures";

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

/** Waits until the video panel's middle is at the screen's, unless the page ends first. Polled:
 * on a slow machine the page can still be moving when the player takes focus. */
async function expectPanelCentred(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const r = document.querySelector("[aria-labelledby='video-panel-title']")!.getBoundingClientRect();
        const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
        return atEnd ? 0 : Math.abs(r.top + r.height / 2 - window.innerHeight / 2);
      }),
    )
    .toBeLessThan(2);
}

test.describe("channel", () => {
  test("shows the score and its videos over the years", async ({ page, request }) => {
    const [channel] = await topChannels(request);
    await page.goto(`/channel/?id=${channel.id}`);
    await expect(page.getByRole("heading", { level: 1, name: channel.name })).toBeVisible();
    await expect(page.getByText(`${channel.videoCount} videos in our dataset`, { exact: false })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Stimulation score" }).getByText(`Stimulation score ${Math.round(channel.score)} out of 100`),
    ).toBeVisible();
    const table = page.getByRole("table", { name: `${channel.name}’s videos over the years` });
    // A header row plus one row per video.
    await expect(table.getByRole("row")).toHaveCount(channel.videoCount + 1);
  });

  test("a measurement chip switches the chart and table, by keyboard", async ({ page, request }) => {
    const [channel] = await topChannels(request);
    await page.goto(`/channel/?id=${channel.id}`);
    const years = page.getByRole("region", { name: "How it changed over years?" });
    await expect(years.getByRole("table")).toBeAttached();
    const chip = years.getByRole("button", { name: "Rapid cutting" }).filter({ visible: true });
    // Below `sm` the chips become a select.
    if (await chip.isVisible()) {
      await tabTo(page, chip, 60);
      await page.keyboard.press("Enter");
      await expect(chip).toHaveAttribute("aria-pressed", "true");
    } else {
      await years.getByRole("combobox").selectOption({ label: "Rapid cutting" });
    }
    // The chart's table for screen readers follows.
    await expect(years.getByRole("columnheader", { name: "Rapid cutting" })).toBeAttached();
  });

  test("opens one of its videos", async ({ page, request }) => {
    const [channel] = await topChannels(request);
    const [video] = await channelVideos(request, channel.id);
    await page.goto(`/channel/?id=${channel.id}`);
    const title = new RegExp(escape(video.title));
    if (isPhone()) {
      // Phones list the videos as cards under the chart, each a link to its page.
      await page.getByRole("link", { name: title }).first().click();
    } else {
      // Its thumbnail on the chart (two can share a title), by keyboard: thumbnails overlap,
      // so a click may land on a neighbour. It opens in the panel under the chart, whose title links on.
      await page.getByRole("button", { name: title }).first().focus();
      await page.keyboard.press("Enter");
      await page.getByRole("region", { name: title }).getByRole("link", { name: title }).click();
    }
    await expect(page.getByRole("heading", { level: 1, name: video.title })).toBeVisible();
  });

  test("plays a video large in the panel, centred on screen, and shrinks it back, by keyboard", async ({ page, request }) => {
    test.skip(isPhone(), "Phones have no panel: the strip's cards open the video's page");
    const [channel] = await topChannels(request);
    const [video] = await channelVideos(request, channel.id);
    await page.goto(`/channel/?id=${channel.id}`);
    const title = new RegExp(escape(video.title));
    await page.getByRole("button", { name: title }).first().focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("region", { name: title });
    await expect(panel).toBeFocused();

    const play = panel.getByRole("button", { name: /^Play video/ });
    await tabTo(page, play);
    await page.keyboard.press("Enter");
    const frame = panel.locator("iframe");
    // Focus moves to the player once it has grown.
    await expect(frame).toBeFocused();
    await expectPanelCentred(page);
    // The player is wider than the preview was, and under the title.
    const box = (await frame.boundingBox())!;
    expect(box.width).toBeGreaterThan(400);
    expect(box.y).toBeGreaterThan((await panel.getByRole("heading", { level: 3 }).boundingBox())!.y);
    await expectNoAxeViolations(page);

    await panel.getByRole("button", { name: "Shrink video" }).click();
    await expect(frame).toHaveCount(0);
    await expect(play).toBeFocused();
    await panel.getByRole("button", { name: "Close video panel" }).click();
    await expect(panel).toHaveCount(0);
  });

  test("a video played while the page still glides to its panel ends centred too", async ({ page, request }) => {
    test.skip(isPhone(), "Phones have no panel: the strip's cards open the video's page");
    const [channel] = await topChannels(request);
    const [video] = await channelVideos(request, channel.id);
    await page.goto(`/channel/?id=${channel.id}`);
    const title = new RegExp(escape(video.title));
    await page.getByRole("button", { name: title }).first().focus();
    await page.keyboard.press("Enter");
    // Play at once, by keyboard: a click would wait for the page to stop moving. Focused without
    // scrolling, as Tab would find it in view: WebKit scrolls to a focused element later otherwise.
    const panel = page.getByRole("region", { name: title });
    await panel.getByRole("button", { name: /^Play video/ }).evaluate((el) => el.focus({ preventScroll: true }));
    await page.keyboard.press("Enter");
    await expect(panel.locator("iframe")).toBeFocused();
    await expectPanelCentred(page);
  });

  test("links to compare", async ({ page, request }) => {
    const [channel] = await topChannels(request);
    await page.goto(`/channel/?id=${channel.id}`);
    await page.getByRole("link", { name: "Compare with another channel" }).click();
    await expect(page.getByRole("region", { name: "Channel A" }).getByRole("link", { name: channel.name })).toBeVisible();
  });
});
