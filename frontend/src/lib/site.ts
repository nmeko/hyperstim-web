import type { Metadata } from "next";

/** The site's public URL (origin + basePath), with a trailing slash. Localhost when unset. */
export const siteUrl = `${process.env.NEXT_PUBLIC_SITE_ORIGIN || "http://localhost:3000"}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;

/** The fixed pages, relative to siteUrl, as listed in the sitemap (plan 011). */
export const fixedPages = ["", "rankings/", "compare/", "how-it-works/", "blog/", "about/", "privacy/"];

/** The link-preview image in `public/`, composed from `art/Logo.png` and `art/kid_1.png`. */
export const shareImage = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "The HyperStim? logo above a drawing of a smiling child lying on the floor, watching a laptop.",
};

/**
 * A page's title, description and canonical URL, plus the matching Open Graph and Twitter
 * card tags for link previews (plan 011). Next replaces rather than merges a layout's
 * `openGraph` when a page sets its own, so every page builds all of it here. Pages filled in
 * from `?id=` pass no path: one URL for all of them would say they're the same page. A blog post
 * passes its date (YYYY-MM-DD) and is an article in link previews (plan 018).
 */
export function pageMetadata({
  title,
  description,
  path,
  published,
}: {
  title: string;
  description: string;
  path?: string;
  published?: string;
}): Metadata {
  const url = path === undefined ? undefined : `/${path}`;
  return {
    title,
    description,
    alternates: url ? { canonical: url } : undefined,
    openGraph: {
      ...(published ? { type: "article", publishedTime: published } : { type: "website" }),
      siteName: "HyperStim?",
      title,
      description,
      url,
      images: [shareImage],
    },
    twitter: { card: "summary_large_image", title, description, images: [shareImage] },
  };
}
