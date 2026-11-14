import type { MetadataRoute } from "next";
import { blogPageHref, getPosts, pageCount, postHref } from "@/lib/blog/posts";
import { fixedPages, siteUrl } from "@/lib/site";

// Written to out/sitemap.xml at build time (static export).
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getPosts();
  // The blog list's later pages (page 1 is a fixed page), then each post with its date (plan 018).
  const listPages = Array.from({ length: pageCount(posts.length) - 1 }, (_, i) => blogPageHref(i + 2));
  return [
    ...fixedPages.map((page) => ({ url: `${siteUrl}${page}` })),
    ...listPages.map((path) => ({ url: `${siteUrl}${path.slice(1)}` })),
    ...posts.map((post) => ({ url: `${siteUrl}${postHref(post.slug).slice(1)}`, lastModified: post.date })),
  ];
}
