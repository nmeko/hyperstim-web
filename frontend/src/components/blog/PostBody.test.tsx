import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { loadPosts } from "@/lib/blog/posts";
import { expectNoAxeViolations } from "@/test/axe";
import PostBody from "./PostBody";

const FIXTURES = path.resolve("src/lib/blog/fixtures");
const MEDIA = path.join(FIXTURES, "media");
const example = loadPosts(FIXTURES).find((post) => post.slug === "every-element")!;

function renderExample() {
  return render(<PostBody slug={example.slug} body={example.body} mediaDir={MEDIA} />);
}

/** Renders a made-up post's body, as the build would. */
function renderBody(body: string, slug = "every-element") {
  return render(<PostBody slug={slug} body={body} mediaDir={MEDIA} />);
}

/** A clips block like the example post's, with its opening line or tabs replaced. */
function clips(
  open = "::::clips[Two videos.]{a=enq9Ge90o1w b=jyaUWUFH3BA}",
  tabs = "::cuts[S]{a=0:14.5-0:30.5 b=0:03-0:21.6}\n::motion[M]{a=0:36-0:51.5 b=0:21.6-0:39.6}",
) {
  return `${open}\n${tabs}\n::::`;
}

describe("PostBody", () => {
  it("renders the example post's headings, lists, quote and table", () => {
    renderExample();
    expect(screen.getByRole("heading", { level: 2, name: "Headings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "A smaller heading" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getAllByRole("list").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Measurement" })).toBeInTheDocument();
    expect(screen.getByText("A quote stands apart from the text around it.").closest("blockquote")).not.toBeNull();
  });

  it("numbers figures and videos apart, with YouTube embeds and clip comparisons counted as videos", () => {
    renderExample();
    const captions = [...document.querySelectorAll("figcaption")].map((c) => c.textContent);
    expect(captions).toEqual([
      "Figure 1. The kid holding a coral card and a blue card, as on the Compare page.",
      "Video 1. A short animation of the kid waving.",
      "Video 2. A kids' video from our dataset.",
      "Video 3. Two videos of the same nursery rhyme.",
    ]);
  });

  it("shows a figure's image from the post's media folder, with its alt text", () => {
    renderExample();
    const image = screen.getByRole("img", { name: /^A drawing of a child sitting cross-legged/ });
    expect(image).toHaveAttribute("src", "/blog-media/every-element/kid-with-cards.webp");
  });

  it("plays a video from the site only on request, with its poster first", () => {
    renderExample();
    const video = document.querySelector("video")!;
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveAttribute("poster", "/blog-media/every-element/kid-waving-poster.webp");
    expect(video.querySelector("source")).toHaveAttribute("src", "/blog-media/every-element/kid-waving.mp4");
  });

  it("loads nothing from YouTube before Play", async () => {
    const user = userEvent.setup();
    const { container } = renderExample();
    expect(container.innerHTML).not.toContain("youtube-nocookie.com");
    await user.click(screen.getByRole("button", { name: "Play video: A kids' video from our dataset." }));
    expect(screen.getByTitle("A kids' video from our dataset.")).toHaveAttribute(
      "src",
      expect.stringContaining("youtube-nocookie.com/embed/--87Tdi3b-I"),
    );
  });

  it("shows a clip comparison with its tabs, both videos and the measurements from clips.json", () => {
    renderExample();
    const figure = screen.getByText("Two videos of the same nursery rhyme.").closest("figure")!;
    const tabs = within(figure).getByRole("group", { name: "What the chart shows" });
    expect(within(tabs).getAllByRole("button").map((b) => b.textContent)).toEqual(["Scene changes", "Motion"]);
    expect(within(figure).getAllByRole("button", { name: /^Play video: [AB]: / })).toHaveLength(2);
    expect(within(figure).getByText(/^Scene changes: video A has 9 cuts in 16 seconds; video B has no cuts in 19 seconds\.$/)).toBeInTheDocument();
  });

  it("links raised citations [1] to the references, numbered by first use, each with a link back", () => {
    renderExample();
    const citations = screen.getAllByRole("link", { name: /^Reference \d$/ });
    expect(citations.map((c) => c.textContent)).toEqual(["1", "2", "1"]);
    expect(citations.map((c) => c.closest("sup")?.textContent)).toEqual(["[1]", "[2]", "[1]"]);
    const references = screen.getByRole("region", { name: "References" });
    expect(within(references).getByRole("heading", { level: 2, name: "References" })).toBeVisible();
    const items = within(references).getAllByRole("listitem");
    expect(items.map((item) => item.textContent?.slice(0, 3))).toEqual(["[1]", "[2]"]);
    // Each citation's link leads to its reference, and the reference's ↩ back to that citation.
    const first = items[0];
    expect(citations[0]).toHaveAttribute("href", `#${first.id}`);
    const back = within(first).getAllByRole("link", { name: /^Back to citation 1 in the text/ });
    expect(back).toHaveLength(2); // cited twice
    expect(back[0]).toHaveAttribute("href", `#${citations[0].id}`);
    expect(back[0]).toHaveTextContent("↩");
  });

  it("shows bold in navy, and bold italic (the site's name) in the text's color", () => {
    renderBody("Plain **bold** and ***HyperStim?***.");
    expect(screen.getByText("bold")).toHaveClass("text-navy");
    expect(screen.getByText("HyperStim?")).toHaveClass("in-[em]:text-current");
    expect(screen.getByText("HyperStim?").closest("em")).not.toBeNull();
  });

  it("joins citations side by side into one [2, 3], each number its own link", () => {
    renderBody("One.[^a] Two.[^b][^c]\n\n[^a]: A.\n[^b]: B.\n[^c]: C.");
    const sups = [...document.querySelectorAll("p sup")];
    expect(sups.map((sup) => sup.textContent)).toEqual(["[1]", "[2, 3]"]);
    expect(within(sups[1] as HTMLElement).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Reference 2",
      "Reference 3",
    ]);
  });

  it("links to the site's own pages in place and to other sites in a new tab", () => {
    renderExample();
    // Next adds the base path (and the trailing slash in the build).
    expect(screen.getByRole("link", { name: "rankings" })).toHaveAttribute("href", expect.stringMatching(/^\/rankings\/?$/));
    const external = screen.getByRole("link", { name: /^Next\.js docs ?\(opens in a new tab\)$/ });
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("keeps text that only looks like a block", () => {
    renderBody("Remember:this is text.");
    expect(screen.getByText("Remember:this is text.")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    renderExample();
    await expectNoAxeViolations();
  });

  describe("fails the build on a broken post", () => {
    it.each([
      ["a figure without alt text", '::figure[A caption]{src="kid-with-cards.webp"}', /needs alt=/],
      ["a figure with empty alt text", '::figure[A caption]{src="kid-with-cards.webp" alt=""}', /needs alt=/],
      ["a missing image", '::figure[A caption]{src="nope.webp" alt="Nothing"}', /"nope\.webp" is missing from public\/blog-media\/every-element\//],
      ["a missing video", '::video[A caption]{src="nope.mp4" poster="kid-waving-poster.webp"}', /"nope\.mp4" is missing/],
      ["a missing poster", '::video[A caption]{src="kid-waving.mp4" poster="nope.webp"}', /"nope\.webp" is missing/],
      ["a video without a poster", '::video[A caption]{src="kid-waving.mp4"}', /needs poster=/],
      ["media outside the post's folder", '::figure[A caption]{src="../x/kid.webp" alt="A kid"}', /by file name only/],
      ["a YouTube embed without an ID", "::youtube[A caption]", /needs id=/],
      ["a YouTube embed with a link for an ID", '::youtube[A caption]{id="https://youtu.be/x"}', /not a YouTube video ID/],
      ["an unknown block", "::chart[A caption]", /unknown block "::chart"/],
      ["a container block", ":::figure\ntext\n:::", /unknown block ":::figure"/],
      ["a citation that's never defined", "Text.[^nope]", /\[\^nope\] is cited but never defined/],
      ["a reference that's never cited", "Text.\n\n[^lonely]: A source.", /\[\^lonely\] is defined but never cited/],
      ["a top heading", "# Title again", /use ## and ###/],
      ["a fourth-level heading", "#### Too deep", /use ## and ###/],
      ["a markdown image", "![A kid](kid-with-cards.webp)", /put images in a ::figure block/],
      ["clips without a caption", clips("::::clips{a=enq9Ge90o1w b=jyaUWUFH3BA}"), /needs a caption/],
      ["clips with a link for an ID", clips("::::clips[C]{a=https://youtu.be/x b=jyaUWUFH3BA}"), /needs a="…", a YouTube video ID/],
      ["clips without tabs", "::::clips[C]{a=enq9Ge90o1w b=jyaUWUFH3BA}\n::::", /needs at least one ::cuts or ::motion tab/],
      ["clips with another block inside", "::::clips[C]{a=enq9Ge90o1w b=jyaUWUFH3BA}\n::youtube[X]{id=enq9Ge90o1w}\n::::", /can hold only ::cuts/],
      ["a tab without a label", clips(undefined, "::cuts{a=0:14.5-0:30.5 b=0:03-0:21.6}"), /needs a label/],
      ["a tab with a backwards stretch", clips(undefined, "::cuts[S]{a=0:30.5-0:14.5 b=0:03-0:21.6}"), /needs a="start-end"/],
      ["a tab with seconds only", clips(undefined, "::cuts[S]{a=14.5-30.5 b=0:03-0:21.6}"), /needs a="start-end"/],
      ["clips for other videos than clips.json", clips("::::clips[C]{a=dQw4w9WgXcQ b=jyaUWUFH3BA}"), /doesn't match clips\.json \(other videos\); run `uv run python scripts\/clip_data\.py every-element`/],
      ["clips with another stretch than clips.json", clips(undefined, "::cuts[S]{a=0:14-0:30.5 b=0:03-0:21.6}\n::motion[M]{a=0:36-0:51.5 b=0:21.6-0:39.6}"), /"S" for A is 0:14\.5-0:30\.5 there/],
      ["clips with tabs in another order", clips(undefined, "::motion[M]{a=0:36-0:51.5 b=0:21.6-0:39.6}\n::cuts[S]{a=0:14.5-0:30.5 b=0:03-0:21.6}"), /tab 1 is cuts there/],
      ["clips with fewer tabs than clips.json", clips(undefined, "::cuts[S]{a=0:14.5-0:30.5 b=0:03-0:21.6}"), /a different number of tabs/],
      ["a second clips block clips.json lacks", `${clips()}\n\n${clips()}`, /the second ::::clips block doesn't match clips\.json \(it has no entry/],
    ])("%s", (_, body, message) => {
      expect(() => renderBody(body)).toThrow(message);
    });

    it("asks for clips.json when a post with clips has none", () => {
      expect(() => renderBody(clips(), "my-post")).toThrow(/public\/blog-media\/my-post\/clips\.json is missing; run `uv run python scripts\/clip_data\.py my-post` in backend\//);
    });

    it("names the post's file", () => {
      expect(() => renderBody("# Title again", "my-post")).toThrow(/^Blog post my-post\.md: /);
    });
  });
});
