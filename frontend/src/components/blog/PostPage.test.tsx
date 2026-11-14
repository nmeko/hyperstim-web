import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loadPosts, plainText } from "@/lib/blog/posts";
import { expectNoAxeViolations } from "@/test/axe";
import PostPage from "./PostPage";

const FIXTURES = path.resolve("src/lib/blog/fixtures");
const posts = loadPosts(FIXTURES);
const bySlug = (slug: string) => posts.find((post) => post.slug === slug)!;

function renderPost(slug: string) {
  return render(<PostPage post={bySlug(slug)} mediaDir={path.join(FIXTURES, "media")} />);
}

const neighbors = () => screen.queryByRole("navigation", { name: "More posts" });

describe("PostPage", () => {
  it("shows the way back, the title, the date and the TL;DR above the text", () => {
    renderPost("every-element");
    expect(screen.getByRole("link", { name: "All posts" })).toHaveAttribute("href", expect.stringMatching(/^\/blog\/?$/));
    expect(screen.getByRole("heading", { level: 1, name: "An example post with every element" })).toBeInTheDocument();
    expect(screen.getByText("November 9, 2026")).toHaveAttribute("datetime", "2026-11-09");
    const tldr = screen.getByRole("region", { name: "TL;DR" });
    expect(tldr).toHaveTextContent(plainText(bySlug("every-element").tldr));
    expect(within(tldr).getByText("each thing").tagName).toBe("STRONG"); // **bold** in the front matter
    expect(screen.getByRole("heading", { level: 2, name: "Headings" })).toBeInTheDocument();
  });

  it("links only to the older post from the newest", () => {
    renderPost("every-element");
    const links = within(neighbors()!).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(/^Older post\s*Test post 01$/);
    expect(links[0]).toHaveAttribute("href", expect.stringMatching(/^\/blog\/test-post-01\/?$/));
  });

  it("links to the newer and the older post in between, newer first", () => {
    renderPost("test-post-05");
    const links = within(neighbors()!).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["← Newer postTest post 04", "Older post →Test post 06"]);
  });

  it("links only to the newer post from the oldest", () => {
    renderPost("test-post-10");
    const links = within(neighbors()!).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(/^Newer post\s*Test post 09$/);
  });

  it("has no newer or older links for the only post", () => {
    render(<PostPage post={{ ...bySlug("test-post-05"), newer: undefined, older: undefined }} />);
    expect(neighbors()).toBeNull();
  });

  it("has no accessibility violations", async () => {
    renderPost("test-post-05");
    await expectNoAxeViolations();
  });
});
