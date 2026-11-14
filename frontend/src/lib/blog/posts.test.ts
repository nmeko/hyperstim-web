import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { blogPageHref, formatDate, loadPosts, pageCount, plainText, postsOnPage, POSTS_PER_PAGE } from "./posts";

const dirs: string[] = [];

/** A folder of posts: file name → its front matter lines (or the whole file, given a string). */
function postsDir(files: Record<string, Record<string, string> | string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blog-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const text =
      typeof content === "string"
        ? content
        : `---\n${Object.entries(content)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")}\n---\n\nThe text.\n`;
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const post = (date: string, title = `Post of ${date}`) => ({ title, date, tldr: "In short." });

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("loadPosts", () => {
  it("reads each post's front matter and text, using the TL;DR as description unless one is set", () => {
    const dir = postsDir({
      "2026-11-01-first-post.md": { title: "First post", date: "2026-11-01", tldr: "It begins." },
      "2026-11-08-second-post.md": { title: '"Second: the sequel"', date: "2026-11-08", tldr: "More.", description: "Searchable." },
    });
    const [second, first] = loadPosts(dir);
    expect(first).toMatchObject({
      slug: "first-post",
      title: "First post",
      date: "2026-11-01",
      tldr: "It begins.",
      description: "It begins.",
      body: "\nThe text.\n",
    });
    expect(second).toMatchObject({ title: "Second: the sequel", description: "Searchable." });
  });

  it("sorts newest first, by title within a day, and links each post to its neighbors", () => {
    const dir = postsDir({
      "2026-10-01-a.md": post("2026-10-01"),
      "2026-11-01-b.md": post("2026-11-01", "Banana"),
      "2026-11-01-c.md": post("2026-11-01", "Apple"),
      "2026-09-15-d.md": post("2026-09-15"),
    });
    const posts = loadPosts(dir);
    expect(posts.map((p) => p.slug)).toEqual(["c", "b", "a", "d"]);
    expect(posts[0].newer).toBeUndefined();
    expect(posts[0].older).toEqual({ slug: "b", title: "Banana" });
    expect(posts[1].newer).toEqual({ slug: "c", title: "Apple" });
    expect(posts[3].newer).toEqual({ slug: "a", title: "Post of 2026-10-01" });
    expect(posts[3].older).toBeUndefined();
  });

  it("has no neighbors for a single post", () => {
    const [only] = loadPosts(postsDir({ "2026-11-01-only.md": post("2026-11-01") }));
    expect(only.newer).toBeUndefined();
    expect(only.older).toBeUndefined();
  });

  it("skips the writing guide and other files", () => {
    const dir = postsDir({ "README.md": "# Writing guide\n", "notes.txt": "x", "2026-11-01-real.md": post("2026-11-01") });
    expect(loadPosts(dir).map((p) => p.slug)).toEqual(["real"]);
  });

  it("is empty without a posts folder", () => {
    expect(loadPosts(path.join(os.tmpdir(), "no-such-blog-folder"))).toEqual([]);
  });

  it("reads the test posts, the example among them", () => {
    const posts = loadPosts(path.resolve("src/lib/blog/fixtures"));
    expect(posts.length).toBeGreaterThan(POSTS_PER_PAGE);
    expect(posts[0].slug).toBe("every-element");
  });

  describe("fails on a broken post", () => {
    it.each([
      ["a missing title", { date: "2026-11-01", tldr: "x" }, /2026-11-01-my-post\.md: "title" is missing/],
      ["an empty title", { title: '""', date: "2026-11-01", tldr: "x" }, /"title" is missing/],
      ["a missing date", { title: "T", tldr: "x" }, /"date" is missing/],
      ["a missing TL;DR", { title: "T", date: "2026-11-01" }, /"tldr" is missing/],
      ["an empty description", { title: "T", date: "2026-11-01", tldr: "x", description: '""' }, /"description" is missing/],
      ["a date that doesn't exist", { title: "T", date: "2026-02-30", tldr: "x" }, /"date" must be a real date/],
      ["a date in another format", { title: "T", date: "11/01/2026", tldr: "x" }, /"date" must be a real date/],
      ["a date with a time", { title: "T", date: '"2026-11-01 10:00"', tldr: "x" }, /"date" must be a real date/],
    ])("%s", (_, frontMatter, message) => {
      expect(() => loadPosts(postsDir({ "2026-11-01-my-post.md": frontMatter }))).toThrow(message);
    });

    it("a file whose date isn't the post's", () => {
      expect(() => loadPosts(postsDir({ "2026-11-02-my-post.md": post("2026-11-01") }))).toThrow(
        /2026-11-02-my-post\.md: the file name starts with 2026-11-02, but "date" is 2026-11-01/,
      );
    });

    it("two posts with the same slug on different dates", () => {
      const dir = postsDir({ "2026-11-01-my-post.md": post("2026-11-01"), "2026-11-02-my-post.md": post("2026-11-02") });
      expect(() => loadPosts(dir)).toThrow(/same name as 2026-11-01-my-post\.md, apart from the date; both would be \/blog\/my-post\//);
    });

    it.each([
      ["my-post.md", /the post's date, then lowercase words joined by hyphens/],
      ["2026-11-01-My-Post.md", /the post's date, then lowercase words joined by hyphens/],
      ["2026-11-01-my post.md", /the post's date, then lowercase words joined by hyphens/],
      ["2026-11-01-page.md", /"page" can't be a post's name/],
    ])("a file named %s", (name, message) => {
      expect(() => loadPosts(postsDir({ [name]: post("2026-11-01") }))).toThrow(message);
    });
  });
});

describe("paging", () => {
  const posts = loadPosts(path.resolve("src/lib/blog/fixtures"));

  it("puts 10 posts on a page", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(10)).toBe(1);
    expect(pageCount(11)).toBe(2);
    expect(postsOnPage(posts, 1)).toHaveLength(10);
    expect(postsOnPage(posts, 2)).toEqual(posts.slice(10, 20));
  });

  it("links page 1 to /blog/ and later pages to /blog/page/N/", () => {
    expect(blogPageHref(1)).toBe("/blog/");
    expect(blogPageHref(2)).toBe("/blog/page/2/");
  });
});

describe("formatDate", () => {
  it("writes the date out in American English, whatever the time zone", () => {
    expect(formatDate("2026-11-09")).toBe("November 9, 2026");
    expect(formatDate("2026-01-01")).toBe("January 1, 2026");
  });
});

describe("plainText", () => {
  it("drops markdown's emphasis markers, for descriptions taken from the TL;DR", () => {
    expect(plainText("Meet **HyperStim?**, a *new* way_to_see it.")).toBe("Meet HyperStim?, a new way_to_see it.");
    expect(plainText("2 * 3 * 4")).toBe("2 * 3 * 4");
    expect(plainText("Meet ***HyperStim?***.")).toBe("Meet HyperStim?.");
  });
});
