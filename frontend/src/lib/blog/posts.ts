import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

// The blog's posts (plan 018): one markdown file each in content/blog/, read at build time.
// Checks here fail the build on a broken post; the renderer (markdown.ts) checks the body.

/** Where posts and their media live. The E2E build points both at the test posts. */
export function blogDirs() {
  return {
    content: path.resolve(process.env.BLOG_CONTENT_DIR || "content/blog"),
    media: path.resolve(process.env.BLOG_MEDIA_DIR || "public/blog-media"),
  };
}

export const POSTS_PER_PAGE = 10;

export type PostLink = { slug: string; title: string };

export type Post = {
  slug: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** May hold **bold** and *italic*. */
  tldr: string;
  /** For search results and link previews; the TL;DR (as plain text) when not set. */
  description: string;
  /** The markdown after the front matter. */
  body: string;
  newer?: PostLink;
  older?: PostLink;
};

/** A post's file name: its date, then its slug (the URL), so the folder lists posts in date order. */
const FILE_NAME = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/;
/** A slug is lowercase words joined by hyphens. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Slugs that are taken by the blog's own pages (`/blog/page/2/`). */
const RESERVED = new Set(["page"]);

export class PostError extends Error {
  constructor(file: string, problem: string) {
    super(`Blog post ${file}: ${problem}`);
    this.name = "PostError";
  }
}

/**
 * A real calendar date written as YYYY-MM-DD. YAML reads an unquoted date as a Date, rolling
 * one that doesn't exist (February 30) into the next month, so the date is read as written.
 */
function readDate(value: unknown, frontMatter: string): string | undefined {
  const text = value instanceof Date ? /^date:\s*["']?(.*?)["']?\s*$/m.exec(frontMatter)?.[1] : value;
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text) ? text : undefined;
}

function requiredText(data: Record<string, unknown>, field: string, file: string): string {
  const value = data[field];
  if (typeof value !== "string" || !value.trim()) throw new PostError(file, `"${field}" is missing in the front matter.`);
  return value.trim();
}

/** Text without markdown's emphasis markers: "***HyperStim?***" becomes "HyperStim?". */
export function plainText(text: string): string {
  return text.replace(/(\*\*\*|\*\*|\*)(\S(?:.*?\S)?)\1/g, "$2");
}

function readPost(dir: string, file: string): Omit<Post, "newer" | "older"> {
  const name = FILE_NAME.exec(file);
  const slug = name?.[2] ?? "";
  if (!name || !SLUG.test(slug)) {
    throw new PostError(file, "the file name must be the post's date, then lowercase words joined by hyphens, like 2026-11-09-my-first-post.md.");
  }
  if (RESERVED.has(slug)) throw new PostError(file, `"${slug}" can't be a post's name: the blog uses it for its own pages.`);
  // Options (even none) turn off gray-matter's cache, whose copies lose the raw front matter.
  const { data, content, matter: frontMatter } = matter(fs.readFileSync(path.join(dir, file), "utf8"), {});
  const title = requiredText(data, "title", file);
  const tldr = requiredText(data, "tldr", file);
  if (data.date === undefined) throw new PostError(file, `"date" is missing in the front matter.`);
  const date = readDate(data.date, frontMatter);
  if (!date) throw new PostError(file, `"date" must be a real date written as YYYY-MM-DD.`);
  if (date !== name[1]) throw new PostError(file, `the file name starts with ${name[1]}, but "date" is ${date}; they must match.`);
  const description = data.description === undefined ? plainText(tldr) : requiredText(data, "description", file);
  return { slug, title, date, tldr, description, body: content };
}

/**
 * Every post in `dir`, newest first (same day: by title), each with its newer and older
 * neighbor. The writing guide (README.md) is not a post. Throws a PostError on a broken post.
 */
export function loadPosts(dir = blogDirs().content): Post[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".md") && file.toLowerCase() !== "readme.md")
    .sort();
  const seen = new Map<string, string>();
  const posts: Post[] = files
    .map((file) => {
      const post = readPost(dir, file);
      // The URL is the slug alone, so two dates can't share one.
      const other = seen.get(post.slug);
      if (other) throw new PostError(file, `it has the same name as ${other}, apart from the date; both would be /blog/${post.slug}/.`);
      seen.set(post.slug, file);
      return post;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  return posts.map((post, i) => ({
    ...post,
    newer: i > 0 ? link(posts[i - 1]) : undefined,
    older: i < posts.length - 1 ? link(posts[i + 1]) : undefined,
  }));
}

function link({ slug, title }: Post): PostLink {
  return { slug, title };
}

let cache: Post[] | undefined;

/** The site's posts, read once per build. */
export function getPosts(): Post[] {
  cache ??= loadPosts();
  return cache;
}

export function getPost(slug: string): Post | undefined {
  return getPosts().find((post) => post.slug === slug);
}

export function pageCount(postCount: number): number {
  return Math.max(1, Math.ceil(postCount / POSTS_PER_PAGE));
}

/** The posts on list page `page` (from 1). */
export function postsOnPage(posts: Post[], page: number): Post[] {
  return posts.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE);
}

/** The list page's path: page 1 is /blog/, later ones /blog/page/2/. */
export function blogPageHref(page: number): string {
  return page <= 1 ? "/blog/" : `/blog/page/${page}/`;
}

export function postHref(slug: string): string {
  return `/blog/${slug}/`;
}

/** "November 9, 2026" (the date as written, whatever the time zone). */
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
