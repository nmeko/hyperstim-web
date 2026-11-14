import { expect, expectNoAxeViolations, expectNoSidewaysScroll, isPhone, tabTo, test } from "./fixtures";

// The blog (plan 018). The E2E build reads the test posts in src/lib/blog/fixtures/ (e2e/servers.ts):
// the example post with every element, then "Test post 01" to "Test post 10", a week apart, so the
// list has two pages.

const EXAMPLE = "An example post with every element";

test("from the list to a post, to its older and newer posts, and back to all posts", async ({ page }) => {
  await page.goto("/");
  if (isPhone()) await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Blog" }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Blog" })).toBeVisible();
  const list = page.getByRole("region", { name: "All posts" });
  await expect(list.getByRole("heading", { level: 2 }).first()).toHaveText(EXAMPLE);

  // The whole row is the link.
  const row = list.getByRole("listitem").filter({ hasText: "Test post 03" });
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  await page.mouse.click(box.x + box.width - 20, box.y + box.height - 10);
  await expect(page).toHaveURL(/\/blog\/test-post-03\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Test post 03" })).toBeVisible();
  await expect(page.getByRole("region", { name: "TL;DR" })).toBeVisible();

  const more = page.getByRole("navigation", { name: "More posts" });
  await more.getByRole("link", { name: /Older post\s*Test post 04/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Test post 04" })).toBeVisible();
  await more.getByRole("link", { name: /Newer post\s*Test post 03/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Test post 03" })).toBeVisible();

  await page.getByRole("link", { name: "All posts" }).click();
  await expect(page).toHaveURL(/\/blog\/$/);
});

test("marks Blog as the current page on posts", async ({ page }) => {
  test.skip(isPhone(), "the phone menu is closed");
  await page.goto("/blog/test-post-01/");
  await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Blog" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("pages through the list: Next to page 2 and Previous back", async ({ page }) => {
  await page.goto("/blog/");
  const list = page.getByRole("region", { name: "All posts" });
  await expect(list.getByRole("list").first().getByRole("listitem")).toHaveCount(10);
  const pages = page.getByRole("navigation", { name: "Pages" });
  if (isPhone()) await expect(pages.getByText("Page 1 of 2", { exact: true })).toBeVisible();

  await pages.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(/\/blog\/page\/2\/$/);
  await expect(page).toHaveTitle("Blog, page 2 - HyperStim?");
  await expect(page.getByRole("heading", { level: 1, name: "Blog" })).toBeVisible();
  await expect(list.getByRole("list").first().getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("heading", { level: 2 })).toHaveText(["Test post 10"]);
  await expect(pages.getByRole("link", { name: "Next page" })).toHaveAttribute("aria-disabled", "true");

  await pages.getByRole("link", { name: "Previous page" }).click();
  await expect(page).toHaveURL(/\/blog\/$/);
  await expect(list.getByRole("heading", { level: 2 }).first()).toHaveText(EXAMPLE);
});

test("the post's YouTube embed loads only after Play", async ({ page, youtubeRequests }) => {
  await page.goto("/blog/every-element/");
  await expect(page.getByText("Video 2.")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(youtubeRequests).toEqual([]);
  await page.getByRole("button", { name: /^Play video.*A kids' video from our dataset/ }).click();
  await expect(page.locator('iframe[src*="youtube-nocookie.com/embed/--87Tdi3b-I"]')).toBeVisible();
  expect(youtubeRequests.length).toBeGreaterThan(0);
});

test("the post's own video and figure load from the site", async ({ page }) => {
  await page.goto("/blog/every-element/");
  const image = page.getByRole("img", { name: /^A drawing of a child sitting cross-legged/ });
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const poster = await page.locator("video").getAttribute("poster");
  expect((await page.request.get(poster!)).ok()).toBe(true);
  const source = await page.locator("video source").getAttribute("src");
  expect((await page.request.get(source!)).headers()["content-type"]).toContain("video/mp4");
});

test("a citation jumps to its reference, and the reference's ↩ back to the citation", async ({ page }) => {
  await page.goto("/blog/every-element/");
  const citation = page.getByRole("link", { name: "Reference 2" });
  await citation.click();
  const reference = page.getByRole("region", { name: "References" }).getByRole("listitem").nth(1);
  await expect(reference).toBeInViewport();
  await expect(reference).toHaveCSS("background-color", "rgb(254, 248, 212)"); // butter while targeted
  await reference.getByRole("link", { name: /^Back to citation 2 in the text/ }).click();
  await expect(citation).toBeInViewport();
});

test.describe("accessibility", () => {
  for (const [name, path] of [
    ["list", "/blog/"],
    ["list, page 2", "/blog/page/2/"],
    ["post", "/blog/every-element/"],
  ]) {
    test(`${name}: no violations and no sideways scroll at 320 px`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectNoAxeViolations(page);
      await expectNoSidewaysScroll(page);
    });
  }

  test("the keyboard reaches a post from the list, and its links", async ({ page }) => {
    await page.goto("/blog/");
    const first = page.getByRole("link", { name: EXAMPLE });
    await tabTo(page, first);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: EXAMPLE })).toBeVisible();
    await tabTo(page, page.getByRole("link", { name: "All posts" }));
    await tabTo(page, page.getByRole("link", { name: "Reference 1" }).first(), 60);
    await tabTo(page, page.getByRole("button", { name: /^Play video.*A kids' video from our dataset/ }), 60);
    await tabTo(page, page.getByRole("button", { name: "Motion" }), 60);
    await tabTo(page, page.getByRole("link", { name: /Older post/ }), 60);
  });

  test("the list's page control works by keyboard", async ({ page }) => {
    await page.goto("/blog/");
    await tabTo(page, page.getByRole("link", { name: "Next page" }), 60);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/blog\/page\/2\/$/);
  });
});

test("posts side by side from sm, stacked on phones", async ({ page }) => {
  await page.goto("/blog/test-post-05/");
  const more = page.getByRole("navigation", { name: "More posts" });
  const newer = (await more.getByRole("link", { name: /Newer post/ }).boundingBox())!;
  const older = (await more.getByRole("link", { name: /Older post/ }).boundingBox())!;
  if (isPhone()) {
    expect(older.y).toBeGreaterThan(newer.y + newer.height - 1);
    expect(Math.abs(older.x - newer.x)).toBeLessThan(2);
  } else {
    expect(Math.abs(older.y - newer.y)).toBeLessThan(2);
    expect(older.x).toBeGreaterThan(newer.x + newer.width - 1);
  }
});

/**
 * A stand-in for YouTube's player: once the page says it's listening, it reports a time that runs
 * ten times as fast from the embed's start, as YouTube's message API would, and obeys pauseVideo
 * and seekTo.
 */
const FAKE_PLAYER = `<!doctype html><title>Player</title><script>
  const start = Number(new URLSearchParams(location.search).get("start") || 0);
  let time = start, state = -1, parent_ = null;
  const send = () => parent_ && parent.postMessage(JSON.stringify({ event: "infoDelivery", info: { playerState: state, currentTime: time } }), "*");
  addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.event === "listening") { parent_ = e.source; state = 1; send(); }
    if (m.func === "pauseVideo") { state = 2; send(); }
    if (m.func === "seekTo") { time = m.args[0]; send(); }
  });
  setInterval(() => { if (state === 1) { time += 1; send(); } }, 100);
</script>`;

test("a clip comparison shows the result, then draws each video's cuts as it plays, one video at a time", async ({ page }) => {
  await page.route(/^https:\/\/www\.youtube-nocookie\.com\/embed\//, (route) =>
    route.fulfill({ contentType: "text/html", body: FAKE_PLAYER }),
  );
  await page.goto("/blog/every-element/");
  const block = page.getByRole("figure").filter({ hasText: "Two videos of the same nursery rhyme." });
  await block.scrollIntoViewIfNeeded();
  // The whole result before anyone presses Play.
  await expect(block.locator("[data-cut]")).toHaveCount(9);
  await expect(block.getByText(/^9\s*cuts in 16 s$/)).toBeVisible();

  await block.getByRole("button", { name: /^Play video\W+A: .*Scene/ }).click();
  await expect(block.locator("[data-cut]")).not.toHaveCount(9); // started over
  await expect(block.locator("[data-cut]")).toHaveCount(9, { timeout: 10_000 });
  await expect(block.getByText(/^9\s*cuts in 16 s$/)).toBeVisible();

  await block.getByRole("button", { name: /^Play video\W+B: .*Scene/ }).click();
  await expect(block.locator("[data-playhead]")).toHaveCount(1); // only the playing video's lane
  await expect(block.getByText(/^0\s*cuts in 19 s$/)).toBeVisible({ timeout: 10_000 });

  // Another tab and back: the first tab's players are still there, paused.
  await block.getByRole("button", { name: "Motion" }).click();
  await expect(block.getByTitle(/^A: .*Scene/)).toBeHidden();
  await block.getByRole("button", { name: "Scene changes" }).click();
  await expect(block.getByTitle(/^A: .*Scene/)).toBeVisible();
  await expect(block.locator("[data-cut]")).toHaveCount(9);
});

test("a clip comparison puts each video's lane under it on phones, and both lanes under the videos from 30rem", async ({ page }) => {
  await page.goto("/blog/every-element/");
  const block = page.getByRole("figure").filter({ hasText: "Two videos of the same nursery rhyme." });
  await block.scrollIntoViewIfNeeded();
  const play = (side: string) => block.getByRole("button", { name: new RegExp(`^Play video\\W+${side}: `) });
  const a = (await play("A").boundingBox())!;
  const b = (await play("B").boundingBox())!;
  const laneA = (await block.getByRole("slider", { name: /^Video A: / }).boundingBox())!;
  if (isPhone()) {
    expect(laneA.y).toBeGreaterThan(a.y + a.height);
    expect(b.y).toBeGreaterThan(laneA.y + laneA.height);
  } else {
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(laneA.y).toBeGreaterThan(b.y + b.height);
  }
  // As wide as the text around it.
  const figure = (await block.boundingBox())!;
  const text = (await page.getByText(/^A clip comparison plays two YouTube videos/).boundingBox())!;
  expect(Math.abs(figure.x - text.x)).toBeLessThan(2);
  expect(Math.abs(figure.width - text.width)).toBeLessThan(2);
});

test("a clip comparison's video title leads to that video's page", async ({ page }) => {
  await page.goto("/blog/every-element/");
  const block = page.getByRole("figure").filter({ hasText: "Two videos of the same nursery rhyme." });
  await block.getByRole("link", { name: "Five Little Ducks Songs For Kids Kindergarten" }).click();
  await expect(page).toHaveURL(/\/video\/?\?id=enq9Ge90o1w$/);
});

test("clicking a lane pauses the playing video and plays that lane's video from the clicked moment", async ({ page }) => {
  await page.route(/^https:\/\/www\.youtube-nocookie\.com\/embed\//, (route) =>
    route.fulfill({ contentType: "text/html", body: FAKE_PLAYER }),
  );
  await page.goto("/blog/every-element/");
  const block = page.getByRole("figure").filter({ hasText: "Two videos of the same nursery rhyme." });
  await block.scrollIntoViewIfNeeded();
  await block.getByRole("button", { name: /^Play video\W+A: .*Scene/ }).click();
  await expect(block.getByTitle(/^A: .*Scene/)).toBeVisible();

  // B's stretch is 18.6 s, the whole axis: click near its middle.
  const lane = block.getByRole("slider", { name: /^Video B: / });
  const box = (await lane.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height / 2);
  await expect(block.getByTitle(/^B: .*Scene/)).toBeVisible();
  // B's playhead once its player has loaded and reports playing; until then A's paused one shows.
  await expect(lane.locator("[data-playhead]")).toHaveCount(1, { timeout: 10_000 });
  await expect(block.locator("[data-playhead]")).toHaveCount(1);
  const value = Number(await lane.getAttribute("aria-valuenow"));
  expect(value).toBeGreaterThanOrEqual(7);
  expect(value).toBeLessThanOrEqual(18);

  // By keyboard: End plays from the end of A's stretch.
  await block.getByRole("slider", { name: /^Video A: / }).focus();
  await page.keyboard.press("End");
  await expect(block.getByRole("slider", { name: /^Video A: / })).toHaveAttribute("aria-valuetext", /^16 of 16 seconds, 9 cuts so far$/);
});
