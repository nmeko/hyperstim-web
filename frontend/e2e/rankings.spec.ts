import { leastStimulatingVideo, topChannels, topVideos } from "./api";
import type { Page } from "@playwright/test";
import { expect, isPhone, tabTo, test } from "./fixtures";

/** The ranked list: a table on wider screens, a list on phones. */
function results(page: Page, kind: "Videos" | "Channels" = "Videos") {
  const name = new RegExp(`^${kind}, ranked by`);
  return page.getByRole("table", { name }).or(page.getByRole("list", { name }));
}

test.describe("rankings", () => {
  test("lists the most stimulating video first and opens it", async ({ page, request }) => {
    const [video] = await topVideos(request);
    await page.goto("/rankings/");
    const first = results(page).getByRole("link").first();
    await expect(first).toHaveAccessibleName(video.title.replace(/\s+/g, " "));
    await first.click();
    await expect(page.getByRole("heading", { level: 1, name: video.title })).toBeVisible();
  });

  test("least stimulating first puts the least stimulating video at the top", async ({ page, request }) => {
    const video = await leastStimulatingVideo(request);
    await page.goto("/rankings/");
    await page.getByRole("button", { name: /^Order:/ }).click();
    await expect(page).toHaveURL(/order=asc/);
    await expect(results(page).getByRole("link", { name: video.title, exact: true })).toBeVisible();
  });

  test("a category narrows the list and is kept in the link", async ({ page }) => {
    await page.goto("/rankings/");
    const showing = page.getByText(/^Showing 1–\d+ of /);
    await expect(showing).toHaveText(/ of [\d,]+ videos$/);
    const category = page.getByRole("group", { name: "Category" }).filter({ visible: true });
    // Below `sm` the chips become a select.
    if (await category.isVisible()) {
      await category.getByRole("button", { name: "Music" }).click();
      await expect(category.getByRole("button", { name: "Music" })).toHaveAttribute("aria-pressed", "true");
    } else {
      await page.getByRole("combobox", { name: "Category" }).selectOption({ label: "Music" });
    }
    await expect(page).toHaveURL(/music/);
    await expect(showing).toHaveText(/ of [\d,]+ music videos$/);
    await page.reload();
    await expect(showing).toHaveText(/ of [\d,]+ music videos$/);
  });

  test("search finds a video by its title, by keyboard", async ({ page, request }) => {
    const [video] = await topVideos(request);
    await page.goto("/rankings/");
    const search = page.getByRole("searchbox", { name: "Search videos" });
    await tabTo(page, search);
    await page.keyboard.type(video.title);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/q=/);
    await expect(results(page).getByRole("link", { name: video.title, exact: true })).toBeVisible();
  });

  test("a click anywhere in a table row opens its video", async ({ page, request }) => {
    test.skip(isPhone(), "phones get a list of cards");
    const [video] = await topVideos(request);
    await page.goto("/rankings/");
    const row = results(page).getByRole("row").filter({ has: page.getByRole("link", { name: video.title, exact: true }) });
    await row.getByRole("cell").nth(2).click();
    await expect(page.getByRole("heading", { level: 1, name: video.title })).toBeVisible();
  });

  test("the filter highlights stay under their words in a long search", async ({ page }) => {
    await page.goto("/rankings/");
    const search = page.getByRole("searchbox", { name: "Search videos" });
    await search.click();
    await page.keyboard.type("a long search for trucks and diggers in the garden after:2024-01-01");
    // The highlights sit in a layer behind the field that scrolls with its text.
    await expect
      .poll(() =>
        search.evaluate((input: HTMLInputElement) => {
          const layer = input.parentElement!.querySelector<HTMLElement>("[aria-hidden] > div")!;
          // Within a pixel: WebKit rounds the two scroll positions differently.
          return [input.scrollLeft > 0, Math.abs(input.scrollLeft - layer.scrollLeft) <= 1];
        }),
      )
      .toEqual([true, true]);
  });

  test("the channels view lists channels and opens one", async ({ page, request }) => {
    const [channel] = await topChannels(request);
    await page.goto("/rankings/");
    await page.getByRole("group", { name: "Show ranking of" }).getByRole("button", { name: "Channels" }).click();
    await expect(page).toHaveURL(/view=channels/);
    // The most stimulating channel first (the videos stay in view until the channels load).
    const first = results(page, "Channels").getByRole("link").first();
    await expect(first).toHaveAccessibleName(channel.name);
    await first.click();
    await expect(page.getByRole("heading", { level: 1, name: channel.name })).toBeVisible();
  });

  test("a measurement column sorts the list by it", async ({ page }) => {
    test.skip(isPhone(), "Phones pick the measurement elsewhere");
    await page.goto("/rankings/");
    await page.getByRole("columnheader", { name: "Rapid cutting" }).getByRole("button").click();
    await expect(page.getByRole("table", { name: /ranked by Rapid cutting/ })).toBeVisible();
  });

  test("the column names stay in view while scrolling the table", async ({ page }) => {
    test.skip(isPhone(), "phones get a list of cards");
    await page.goto("/rankings/");
    const table = results(page);
    const rows = table.getByRole("row").filter({ has: page.getByRole("link") });
    await rows.last().scrollIntoViewIfNeeded();
    await expect(page.getByRole("columnheader", { name: "Overall" })).toBeInViewport();

    // Each link focused on the way back up shows below the stuck names, not under them.
    const names = page.getByRole("columnheader", { name: "Rapid cutting" });
    await rows.last().getByRole("link").first().focus();
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press("Shift+Tab");
      const [focusTop, namesBottom] = await Promise.all([
        page.evaluate(() => document.activeElement!.getBoundingClientRect().top),
        names.evaluate((th) => th.getBoundingClientRect().bottom),
      ]);
      expect(focusTop, `focused link ${i + 1} below the column names`).toBeGreaterThanOrEqual(namesBottom - 1);
    }

    await names.getByRole("button").click();
    await expect(page.getByRole("table", { name: /ranked by Rapid cutting/ })).toBeVisible();
  });
});
