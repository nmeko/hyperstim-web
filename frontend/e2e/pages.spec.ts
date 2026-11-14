import { topVideos } from "./api";
import { expect, tabTo, test } from "./fixtures";

// The text pages: how it works, privacy and about.

test.describe("how it works", () => {
  test("its check field opens a video's page", async ({ page, request }) => {
    const [video] = await topVideos(request);
    await page.goto("/how-it-works/");
    const field = page.getByRole("textbox", { name: "YouTube link or video ID" });
    await field.fill(video.id);
    await field.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: video.title })).toBeVisible();
  });

  test("a link to a measurement lands with “We measure 12 things” at the top, at any size", async ({ page, request }) => {
    test.slow(); // 12 page loads
    const [video] = await topVideos(request);
    const title = page.getByRole("heading", { name: "We measure 12 things" });
    /** Checks the title is 16 px from the top (±3: WebKit rounds scroll positions on phones). */
    const expectTitleAtTop = async (what: string) => {
      // The linked measurement is highlighted, also after a link followed inside the site.
      const slug = new URL(page.url()).hash;
      await expect(page.locator(slug)).toHaveCSS("background-color", "rgb(254, 248, 212)");
      // Polled until it's there: the page sets where each item lands once its script runs.
      const off = () => title.boundingBox().then((box) => Math.abs(Math.round(box!.y) - 16));
      await expect.poll(off, { message: what }).toBeLessThanOrEqual(3);
    };
    for (const size of [{ width: 1280, height: 800 }, { width: 360, height: 740 }, { width: 375, height: 548 }, { width: 740, height: 340 }]) {
      await page.setViewportSize(size);
      // Opened directly: the first and the last measurement.
      for (const slug of ["rapid-cutting", "surprise-reveals"]) {
        await page.goto(`/how-it-works/#${slug}`);
        await expectTitleAtTop(`${slug} at ${size.width}×${size.height}`);
      }
      // From a video page's info popup.
      await page.goto(`/video/?id=${video.id}`);
      await page.getByRole("button", { name: "About Surprise reveals" }).click();
      await page.getByRole("link", { name: /^More about this.*Surprise reveals/ }).click();
      await expect(page).toHaveURL(/#surprise-reveals$/);
      await expectTitleAtTop(`link at ${size.width}×${size.height}`);
    }
  });

  test("a question opens and closes by keyboard", async ({ page }) => {
    await page.goto("/how-it-works/");
    // A <summary> has no role to find it by.
    const question = page.locator("summary").first();
    await tabTo(page, question, 80);
    await page.keyboard.press("Enter");
    await expect(page.locator("details").first()).toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(page.locator("details").first()).not.toHaveAttribute("open");
  });
});

test.describe("privacy", () => {
  test("its cookie settings button opens the cookie choice", async ({ page }) => {
    await page.goto("/privacy/");
    await page.getByRole("main").getByRole("button", { name: "cookie settings" }).click();
    const banner = page.getByRole("region", { name: "Cookies on HyperStim?" });
    await expect(banner).toBeFocused();
    await expect(banner.getByText("Your current choice: rejected.")).toBeVisible();
  });
});

test.describe("about", () => {
  test("introduces the team", async ({ page }) => {
    await page.goto("/about/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("term").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Get in touch" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^open an issue on GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/AISmithLab/hyperstim/issues/new/choose",
    );
  });
});
