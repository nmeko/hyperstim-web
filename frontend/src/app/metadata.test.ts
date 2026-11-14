import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";
import { fixedPages } from "@/lib/site";

// Every page, as its folder in app/ ("" = home); detail pages are filled in from ?id=.
const PAGES = [...fixedPages, "channel/", "video/"];

const modules = import.meta.glob<{ metadata: Metadata }>("./**/page.tsx");

async function metadataOf(page: string): Promise<Metadata> {
  return (await modules[`./${page}page.tsx`]()).metadata;
}

describe("page metadata (plan 011)", () => {
  it.each(PAGES)("gives /%s link preview tags matching its title and description", async (page) => {
    const metadata = await metadataOf(page);
    expect(metadata.openGraph).toMatchObject({
      siteName: "HyperStim?",
      title: metadata.title,
      description: metadata.description,
    });
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: "/og-image.png", width: 1200, height: 630 }),
    ]);
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it.each(PAGES)("gives /%s a description short enough for search results", async (page) => {
    const { description } = await metadataOf(page);
    expect(description?.length).toBeGreaterThan(0);
    expect(description?.length).toBeLessThanOrEqual(155);
  });

  it.each(fixedPages)("gives /%s the same preview URL as its canonical URL", async (page) => {
    const metadata = await metadataOf(page);
    expect(metadata.alternates?.canonical).toBe(`/${page}`);
    expect(metadata.openGraph?.url).toBe(`/${page}`);
  });

  it.each(["channel/", "video/"])("gives /%s no canonical or preview URL", async (page) => {
    const metadata = await metadataOf(page);
    expect(metadata.alternates?.canonical).toBeUndefined();
    expect(metadata.openGraph?.url).toBeUndefined();
  });
});

// Blog posts and the list's later pages, built from the test posts (plan 018).
describe("blog metadata (plan 018)", () => {
  beforeAll(() => {
    vi.stubEnv("BLOG_CONTENT_DIR", "src/lib/blog/fixtures");
    vi.stubEnv("BLOG_MEDIA_DIR", "src/lib/blog/fixtures/media");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  async function postModule() {
    vi.resetModules(); // getPosts() reads the posts once per module load
    return import("./blog/[slug]/page");
  }

  it("gives each post its own title, description, canonical URL and article preview", async () => {
    const { generateMetadata, generateStaticParams } = await postModule();
    const params = generateStaticParams();
    expect(params).toContainEqual({ slug: "every-element" });
    for (const { slug } of params) {
      const metadata = await generateMetadata({ params: Promise.resolve({ slug }) } as never);
      expect(metadata.title).toMatch(/ - HyperStim\?$/);
      expect(metadata.description?.length).toBeGreaterThan(0);
      expect(metadata.description?.length).toBeLessThanOrEqual(155);
      expect(metadata.alternates?.canonical).toBe(`/blog/${slug}/`);
      expect(metadata.openGraph).toMatchObject({ type: "article", url: `/blog/${slug}/`, title: metadata.title });
      expect(metadata.openGraph?.images).toEqual([expect.objectContaining({ url: "/og-image.png" })]);
    }
  });

  it("uses a post's description, or else its TL;DR, and its date", async () => {
    const { generateMetadata } = await postModule();
    const example = await generateMetadata({ params: Promise.resolve({ slug: "every-element" }) } as never);
    expect(example).toMatchObject({
      title: "An example post with every element - HyperStim?",
      description: expect.stringMatching(/^An example post that shows headings/),
      openGraph: { publishedTime: "2026-11-09" },
    });
    const plain = await generateMetadata({ params: Promise.resolve({ slug: "test-post-01" }) } as never);
    expect(plain.description).toMatch(/^A short test post/);
  });

  it("describes each post as a BlogPosting for search results", async () => {
    const { postJsonLd } = await postModule();
    const { loadPosts } = await import("@/lib/blog/posts");
    const post = loadPosts().find((p) => p.slug === "every-element")!;
    expect(postJsonLd(post)).toMatchObject({
      "@type": "BlogPosting",
      headline: "An example post with every element",
      datePublished: "2026-11-09",
      description: post.description,
      url: expect.stringMatching(/\/blog\/every-element\/$/),
    });
  });

  it("titles the list's later pages with their number and gives each its own canonical URL", async () => {
    vi.resetModules();
    const { generateMetadata, generateStaticParams } = await import("./blog/page/[page]/page");
    expect(generateStaticParams()).toEqual([{ page: "2" }]);
    const metadata = await generateMetadata({ params: Promise.resolve({ page: "2" }) } as never);
    expect(metadata).toMatchObject({
      title: "Blog, page 2 - HyperStim?",
      alternates: { canonical: "/blog/page/2/" },
      openGraph: { url: "/blog/page/2/" },
    });
    expect(metadata.description).toBe((await metadataOf("blog/")).description);
  });
});

describe("published blog posts (plan 018)", () => {
  it("each have a description short enough for search results (set one when the TL;DR is longer)", async () => {
    const { loadPosts } = await import("@/lib/blog/posts");
    for (const post of loadPosts(path.resolve("content/blog"))) {
      expect(post.description.length, `${post.slug}.md`).toBeLessThanOrEqual(155);
    }
  });
});
