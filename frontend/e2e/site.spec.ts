import { topChannels, topVideos } from "./api";
import { ANALYZED } from "./backend";
import { expect, expectNoAxeViolations, expectNoSidewaysScroll, isPhone, tabTo, test } from "./fixtures";

// Every page, loaded: no accessibility violations and no sideways scroll at 320 px.
test.describe("every page", () => {
  const pages: { name: string; path: (ids: { video: string; video2: string; channel: string; channel2: string }) => string }[] = [
    { name: "home", path: () => "/" },
    { name: "rankings", path: () => "/rankings/" },
    { name: "rankings, channels", path: () => "/rankings/?view=channels" },
    { name: "video", path: ({ video }) => `/video/?id=${video}` },
    { name: "video, live check", path: () => `/video/?id=${ANALYZED.id}` },
    { name: "channel", path: ({ channel }) => `/channel/?id=${channel}` },
    { name: "compare, empty", path: () => "/compare/" },
    { name: "compare, two videos", path: ({ video, video2 }) => `/compare/?a=${video}&b=${video2}` },
    { name: "compare, two channels", path: ({ channel, channel2 }) => `/compare/?a=${channel}&b=${channel2}` },
    { name: "how it works", path: () => "/how-it-works/" },
    { name: "privacy", path: () => "/privacy/" },
    { name: "about", path: () => "/about/" },
  ];

  for (const { name, path } of pages) {
    test(name, async ({ page, request }) => {
      const [v1, v2] = await topVideos(request, 2);
      const [c1, c2] = await topChannels(request, 2);
      await page.goto(path({ video: v1.id, video2: v2.id, channel: c1.id, channel2: c2.id }));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Check the page with its data, not its loading placeholders.
      await page.waitForLoadState("networkidle");
      await expectNoAxeViolations(page);
      await expectNoSidewaysScroll(page);
    });
  }
});

test("the skip link moves focus to the main content", async ({ page }) => {
  await page.goto("/rankings/");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await tabTo(page, skip, 1);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await page.keyboard.press("Tab");
  // The next stop is inside the main content, not the header.
  expect(await page.evaluate(() => document.activeElement?.closest("main") !== null)).toBe(true);
});

test.describe("header", () => {
  test("links to every page and marks the current one", async ({ page }) => {
    const phone = isPhone();
    const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
    // On phones the links are in the menu, which closes after each navigation.
    const openNav = async () => {
      if (phone) await page.getByRole("button", { name: "Menu" }).click();
    };
    await page.goto("/");
    for (const [name, url] of [
      ["Rankings", "/rankings/"],
      ["Compare", "/compare/"],
      ["How it works", "/how-it-works/"],
      ["About", "/about/"],
      ["Home", "/"],
    ]) {
      await openNav();
      await nav.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
      await openNav();
      await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
      if (phone) await page.getByRole("button", { name: "Close menu" }).click();
    }
  });

  test("phone menu opens, closes on Escape and gives focus back", async ({ page }) => {
    test.skip(!isPhone(), "The menu exists only below the desktop width");
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Menu" });
    await tabTo(page, menu);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Close menu" })).toBeFocused();
    const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
    await expect(nav.getByRole("link", { name: "Rankings" })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press("Escape");
    await expect(nav).toBeHidden();
    await expect(menu).toBeFocused();
  });
});

test.describe("footer", () => {
  test("links to the privacy policy", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("link", { name: "Privacy policy" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
  });
});

test.describe("cookie consent", () => {
  test.use({ consent: null });

  test("nothing from Google loads before Accept, and a Reject is remembered", async ({ page, googleRequests }) => {
    await page.goto("/");
    const banner = page.getByRole("region", { name: "Cookies on HyperStim?" });
    await expect(banner).toBeVisible();
    await expectNoAxeViolations(page);
    await banner.getByRole("button", { name: "Reject" }).click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(banner).toBeHidden();
    expect(googleRequests).toEqual([]);
  });

  test("Accept loads Google's tag; Cookie settings reopens the choice", async ({ page, googleRequests }) => {
    await page.goto("/");
    const banner = page.getByRole("region", { name: "Cookies on HyperStim?" });
    expect(googleRequests).toEqual([]);
    await banner.getByRole("button", { name: "Accept" }).click();
    await expect.poll(() => googleRequests.length).toBe(1);

    const settings = page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" });
    await settings.click();
    await expect(banner).toBeFocused();
    await expect(banner.getByText("Your current choice: accepted.")).toBeVisible();
  });
});

test.describe("YouTube", () => {
  test("nothing loads from YouTube until Play", async ({ page, request, youtubeRequests }) => {
    const [video] = await topVideos(request);
    await page.goto(`/video/?id=${video.id}`);
    await expect(page.getByRole("heading", { level: 1, name: video.title })).toBeVisible();
    await expect(page.getByRole("region", { name: "Stimulation score" })).toBeVisible();
    expect(youtubeRequests).toEqual([]);
    await page.getByRole("button", { name: /^Play video/ }).click();
    await expect.poll(() => youtubeRequests.length).toBeGreaterThan(0);
    expect(youtubeRequests.every((url) => url.startsWith("https://www.youtube-nocookie.com/"))).toBe(true);
  });
});
