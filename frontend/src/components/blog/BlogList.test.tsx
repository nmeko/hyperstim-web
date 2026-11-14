import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loadPosts, pageCount, plainText, postsOnPage } from "@/lib/blog/posts";
import { expectNoAxeViolations } from "@/test/axe";
import BlogList from "./BlogList";

// The test posts: the example post and ten more, so two pages.
const posts = loadPosts(path.resolve("src/lib/blog/fixtures"));

function renderPage(page: number, all = posts) {
  return render(<BlogList posts={postsOnPage(all, page)} page={page} pageCount={pageCount(all.length)} />);
}

/** The posts' rows (the page control has a list too). */
const rows = () => within(within(screen.getByRole("region", { name: "All posts" })).getAllByRole("list")[0]).getAllByRole("listitem");

describe("BlogList", () => {
  it("lists 10 posts, newest first, each with its date, title link and TL;DR", () => {
    renderPage(1);
    expect(screen.getByRole("heading", { level: 1, name: "Blog" })).toBeInTheDocument();
    expect(rows()).toHaveLength(10);
    const first = rows()[0];
    expect(within(first).getByRole("heading", { level: 2 })).toHaveTextContent("An example post with every element");
    expect(within(first).getByRole("link", { name: "An example post with every element" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/blog\/every-element\/?$/),
    );
    expect(first.querySelector("time")).toHaveAttribute("datetime", "2026-11-09");
    expect(first).toHaveTextContent("November 9, 2026");
    expect(first).toHaveTextContent(plainText(posts[0].tldr));
    expect(rows()[1]).toHaveTextContent("Test post 01");
  });

  it("links the page control's steps and numbers to each page's own URL", () => {
    renderPage(1);
    const pages = screen.getByRole("navigation", { name: "Pages" });
    expect(within(pages).getByRole("link", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    expect(within(pages).getByRole("link", { name: "Page 2" })).toHaveAttribute("href", expect.stringMatching(/^\/blog\/page\/2\/?$/));
    expect(within(pages).getByRole("link", { name: "Next page" })).toHaveAttribute("href", expect.stringMatching(/^\/blog\/page\/2\/?$/));
    expect(within(pages).getByRole("link", { name: "Previous page" })).toHaveAttribute("aria-disabled", "true");
    expect(within(pages).getByRole("link", { name: "Previous page" })).not.toHaveAttribute("href");
    expect(within(pages).getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("shows the rest on page 2, linking back to /blog/", () => {
    renderPage(2);
    expect(rows().map((row) => within(row).getByRole("heading").textContent)).toEqual(["Test post 10"]);
    const pages = screen.getByRole("navigation", { name: "Pages" });
    expect(within(pages).getByRole("link", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    expect(within(pages).getByRole("link", { name: "Previous page" })).toHaveAttribute("href", expect.stringMatching(/^\/blog\/?$/));
    expect(within(pages).getByRole("link", { name: "Next page" })).toHaveAttribute("aria-disabled", "true");
  });

  it("has no page control with 10 posts or fewer", () => {
    renderPage(1, posts.slice(0, 10));
    expect(rows()).toHaveLength(10);
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
  });

  it("says so before the first post", () => {
    renderPage(1, []);
    expect(screen.getByText("No posts yet. Check back soon.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "All posts" })).toBeNull();
  });

  it("has no accessibility violations", async () => {
    renderPage(1);
    await expectNoAxeViolations();
  });
});
