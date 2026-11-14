import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixedPages, siteUrl } from "@/lib/site";

// Pages that are filled in from ?id= and so aren't in the sitemap.
const DETAIL_PAGES = ["channel/", "video/"];

/** The sitemap, with the posts in `dir` (read once per module load). */
async function sitemapWith(dir: string) {
  vi.stubEnv("BLOG_CONTENT_DIR", dir);
  vi.resetModules();
  return (await import("./sitemap")).default();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sitemap", () => {
  it("lists every fixed page as an absolute URL, the blog among them", async () => {
    const urls = (await sitemapWith("no-such-folder")).map((entry) => entry.url);
    expect(urls).toEqual(fixedPages.map((page) => `${siteUrl}${page}`));
    expect(urls).toContain(`${siteUrl}blog/`);
  });

  it("adds the blog list's later pages and each post with its date (plan 018)", async () => {
    const entries = await sitemapWith("src/lib/blog/fixtures");
    expect(entries).toContainEqual({ url: `${siteUrl}blog/page/2/` });
    expect(entries).toContainEqual({ url: `${siteUrl}blog/every-element/`, lastModified: "2026-11-09" });
    expect(entries.filter((entry) => entry.url.startsWith(`${siteUrl}blog/`) && entry.lastModified)).toHaveLength(11);
  });

  it("covers every page in the app", () => {
    const appDir = import.meta.dirname;
    const pages = readdirSync(appDir)
      .filter((name) => statSync(path.join(appDir, name)).isDirectory())
      .map((name) => `${name}/`);
    expect([...fixedPages.filter(Boolean), ...DETAIL_PAGES].sort()).toEqual(pages.sort());
  });
});
