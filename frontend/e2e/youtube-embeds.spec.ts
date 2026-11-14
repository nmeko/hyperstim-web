import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Every YouTube video the published blog posts embed must still be embeddable (plan 018): an
// uploader can turn embedding off or remove the video at any time. Unlike the rest of E2E, this
// talks to YouTube. Locally it loads the real player in a page on a real host name and waits for
// "playing"; the page's origin is a stand-in host, as YouTube refuses some videos in pages whose
// address is a bare IP but plays them under any host name. Run it before publishing a post:
// `npx playwright test youtube-embeds`. In CI, YouTube asks GitHub's runners to sign in to prove
// they aren't bots, so the player never starts; there it asks YouTube's oEmbed endpoint instead:
// 200 when the video can be embedded, 401 when embedding is off, 404 when it's gone.

const POSTS = path.resolve(__dirname, "../content/blog");
const ORIGIN = "https://hyperstim.example";
const PLAYING = 1;
const CI = !!process.env.CI;

/** The YouTube IDs in the posts' ::youtube and ::::clips blocks. */
function embeddedVideos(): string[] {
  const ids = new Set<string>();
  for (const file of fs.readdirSync(POSTS).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")) {
    const text = fs.readFileSync(path.join(POSTS, file), "utf8");
    for (const [, attributes] of text.matchAll(/^::(?:youtube|::clips)[^{\n]*\{([^}]*)\}/gm)) {
      for (const [, id] of attributes.matchAll(/\b(?:id|a|b)="?([\w-]{11})"?/g)) ids.add(id);
    }
  }
  return [...ids];
}

test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "once is enough: it loads from YouTube");

for (const id of embeddedVideos()) {
  test(`YouTube video ${id} can be embedded`, async ({ request }) => {
    test.skip(!CI, "the playback check below covers it outside CI");
    const watch = `https://www.youtube.com/watch?v=${id}`;
    const response = await request.get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`);
    expect(response.status(), `oEmbed status for ${watch}`).toBe(200);
  });

  test(`YouTube video ${id} plays when embedded`, async ({ page }) => {
    test.skip(CI, "YouTube asks CI runners to sign in");
    await page.route(`${ORIGIN}/`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><iframe id="player" width="640" height="360" allow="autoplay"
          src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&enablejsapi=1&origin=${encodeURIComponent(ORIGIN)}"></iframe>
          <script>
            window.states = [];
            addEventListener("message", (e) => {
              try {
                const m = JSON.parse(e.data);
                const state = m.event === "onStateChange" ? m.info : m.info && m.info.playerState;
                if (m.event === "onError") window.states.push("error " + m.info);
                else if (state !== undefined) window.states.push(state);
              } catch {}
            });
            player.onload = () => setInterval(() => player.contentWindow.postMessage(JSON.stringify({ event: "listening" }), "*"), 500);
          </script>`,
      }),
    );
    await page.goto(`${ORIGIN}/`);
    await expect.poll(() => page.evaluate(() => (window as unknown as { states: unknown[] }).states), { timeout: 20_000 }).toContain(PLAYING);
  });
}
