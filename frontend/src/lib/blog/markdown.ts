import fs from "node:fs";
import path from "node:path";
import type { Element, ElementContent, Root as HastRoot } from "hast";
import type { Parent as MdastParent, PhrasingContent, Root as MdastRoot, RootContent } from "mdast";
import type { Options as MarkdownOptions } from "react-markdown";
import { CLIP_KINDS, formatClock, parseClock, type ClipKind, type Clips, type ClipsFile, type ClipTab } from "./clips";
import { PostError } from "./posts";

// How a post's markdown becomes HTML (plan 018): remark-gfm (tables, footnotes) and
// remark-directive (the figure, video, youtube and clips blocks), then the two plugins here. They
// fail the build on a broken post and number the captions; PostBody maps the result to the
// site's elements.

/** The blocks a post can hold besides standard markdown, and the attributes each needs. */
const BLOCKS = {
  figure: ["src", "alt"],
  video: ["src", "poster"],
  youtube: ["id"],
} as const;
type Block = keyof typeof BLOCKS;

/** A YouTube video ID. */
const YOUTUBE_ID = /^[\w-]{11}$/;
/** A citation whose footnote is never defined: remark-gfm leaves it as text. */
const UNDEFINED_CITATION = /\[\^([^\]\s]+)\]/;

type Directive = MdastParent & {
  type: "textDirective" | "leafDirective" | "containerDirective";
  name: string;
  attributes?: Record<string, string | null | undefined> | null;
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

/** What the checks need to know about the post. */
export type PostContext = { slug: string; file: string; mediaDir: string };

function children(node: unknown): RootContent[] | undefined {
  return (node as Partial<MdastParent>).children;
}

/**
 * Checks the body and prepares the blocks: each `::figure`, `::video` and `::youtube` becomes
 * a `figure` element with its number (figures and videos counted apart; YouTube embeds are
 * videos) and the caption as its children.
 */
export function remarkPost(context: PostContext) {
  const fail = (problem: string): never => {
    throw new PostError(context.file, problem);
  };
  return (tree: MdastRoot) => {
    const counts = { figure: 0, video: 0 };
    let clipBlocks = 0;
    let clipsFile: ClipsFile | undefined;
    const cited = new Set<string>();
    const defined = new Set<string>();

    const visit = (parent: MdastParent) => {
      parent.children.forEach((node, i) => {
        switch (node.type) {
          case "heading":
            if (node.depth === 1 || node.depth > 3) {
              fail(`use ## and ### for headings ("${"#".repeat(node.depth)}" found); the title is the page's only top heading.`);
            }
            break;
          case "image":
          case "imageReference":
            fail("put images in a ::figure block, with alt text and a caption.");
            break;
          case "footnoteReference":
            cited.add(node.identifier);
            break;
          case "footnoteDefinition":
            defined.add(node.identifier);
            break;
          case "text": {
            const undefinedCitation = UNDEFINED_CITATION.exec(node.value);
            if (undefinedCitation) fail(`the reference [^${undefinedCitation[1]}] is cited but never defined.`);
            break;
          }
          case "textDirective": {
            // Not a block: text like "Note:this" that only looks like one. Put it back.
            const restored: PhrasingContent[] = [{ type: "text", value: `:${(node as Directive).name}` }];
            const label = children(node) as PhrasingContent[] | undefined;
            if (label?.length) restored.push({ type: "text", value: "[" }, ...label, { type: "text", value: "]" });
            parent.children.splice(i, 1, ...(restored as RootContent[]));
            break;
          }
          case "leafDirective":
          case "containerDirective":
            if (node.type === "containerDirective" && (node as Directive).name === "clips") prepareClips(node as Directive);
            else prepareBlock(node as Directive);
            break;
        }
        const inner = children(node);
        if (inner) visit(node as MdastParent);
      });
    };

    const prepareBlock = (node: Directive) => {
      const usage =
        "::figure[Caption]{src=… alt=…}, ::video[Caption]{src=… poster=…}, ::youtube[Caption]{id=…} or ::::clips[Caption]{a=… b=…}";
      if (node.type === "containerDirective" || !(node.name in BLOCKS)) {
        fail(`unknown block "${node.type === "containerDirective" ? ":::" : "::"}${node.name}"; blocks are ${usage}.`);
      }
      const name = node.name as Block;
      const attributes = node.attributes ?? {};
      for (const attribute of BLOCKS[name]) {
        if (!attributes[attribute]?.trim()) fail(`::${name} needs ${attribute}="…".`);
      }
      for (const attribute of ["src", "poster"] as const) {
        const file = attributes[attribute];
        if (!file || !(BLOCKS[name] as readonly string[]).includes(attribute)) continue;
        if (file !== path.basename(file)) fail(`write media by file name only ("${file}").`);
        if (!fs.existsSync(path.join(context.mediaDir, context.slug, file))) {
          fail(`the file "${file}" is missing from public/blog-media/${context.slug}/.`);
        }
      }
      if (name === "youtube" && !YOUTUBE_ID.test(attributes.id!)) fail(`"${attributes.id}" is not a YouTube video ID.`);
      const kind = name === "figure" ? "figure" : "video";
      counts[kind] += 1;
      node.data = {
        hName: "figure",
        hProperties: {
          dataBlock: name,
          dataNumber: counts[kind],
          dataSrc: attributes.src ?? undefined,
          dataAlt: attributes.alt ?? undefined,
          dataPoster: attributes.poster ?? undefined,
          dataId: attributes.id ?? undefined,
        },
      };
    };

    /**
     * A clip comparison: `::::clips[Caption]{a=<id> b=<id>}` holding `::cuts[Label]{a=0:14.5-0:30.5 b=…}`
     * and `::motion[…]{…}` tabs. Its measurements come from the post's clips.json, which must
     * match the block; the figure element carries them to ClipCompare, and the caption as children.
     */
    const prepareClips = (node: Directive) => {
      clipBlocks += 1;
      const where = `the ${ordinal(clipBlocks)} ::::clips block`;
      const rerun = `run \`uv run python scripts/clip_data.py ${context.slug}\` in backend/`;
      const attributes = node.attributes ?? {};
      const ids = { a: attributes.a?.trim() ?? "", b: attributes.b?.trim() ?? "" };
      for (const side of ["a", "b"] as const) {
        if (!YOUTUBE_ID.test(ids[side])) fail(`${where} needs ${side}="…", a YouTube video ID ("${ids[side]}" found).`);
      }
      let caption: PhrasingContent[] = [];
      const tabs: { kind: ClipKind; label: string; a: [number, number]; b: [number, number] }[] = [];
      for (const child of node.children) {
        if (child.type === "paragraph" && (child.data as { directiveLabel?: boolean } | undefined)?.directiveLabel) {
          caption = child.children;
          continue;
        }
        const tab = child as unknown as Directive;
        if (tab.type !== "leafDirective" || !CLIP_KINDS.includes(tab.name as ClipKind)) {
          fail(`${where} can hold only ::cuts[Label]{a=… b=…} and ::motion[Label]{a=… b=…} tabs.`);
        }
        const label = (children(tab) as PhrasingContent[] | undefined)?.map(plainText).join("").trim();
        if (!label) fail(`a ::${tab.name} tab in ${where} needs a label, like ::${tab.name}[First verse]{…}.`);
        const range = (side: "a" | "b") => {
          const value = tab.attributes?.[side] ?? "";
          const [start, end] = value.split("-").map(parseClock);
          if (start === undefined || end === undefined || end <= start) {
            fail(`the "${label}" tab in ${where} needs ${side}="start-end", like ${side}=0:14.5-0:30.5 ("${value}" found).`);
          }
          return [start, end] as [number, number];
        };
        tabs.push({ kind: tab.name as ClipKind, label: label!, a: range("a"), b: range("b") });
      }
      if (!caption.length) fail(`${where} needs a caption, like ::::clips[Two videos of the same song]{a=… b=…}.`);
      if (!tabs.length) fail(`${where} needs at least one ::cuts or ::motion tab.`);

      if (!clipsFile) {
        const file = path.join(context.mediaDir, context.slug, "clips.json");
        if (!fs.existsSync(file)) fail(`public/blog-media/${context.slug}/clips.json is missing; ${rerun}.`);
        clipsFile = JSON.parse(fs.readFileSync(file, "utf8")) as ClipsFile;
      }
      const data = clipsFile.blocks?.[clipBlocks - 1];
      const stale = (what: string): never => fail(`${where} doesn't match clips.json (${what}); ${rerun}.`);
      if (!data) stale("it has no entry for this block");
      if (data!.videos.a.id !== ids.a || data!.videos.b.id !== ids.b) stale("other videos");
      if (data!.tabs.length !== tabs.length) stale("a different number of tabs");
      const clips: Clips = {
        videos: data!.videos,
        tabs: tabs.map((tab, i): ClipTab => {
          const measured = data!.tabs[i];
          if (measured.kind !== tab.kind) stale(`tab ${i + 1} is ${measured.kind} there`);
          for (const side of ["a", "b"] as const) {
            const [start, end] = tab[side];
            const part = measured[side];
            if (Math.abs(part.start - start) > 0.01 || Math.abs(part.end - end) > 0.01) {
              stale(`"${tab.label}" for ${side.toUpperCase()} is ${formatClock(part.start)}-${formatClock(part.end)} there`);
            }
          }
          return { ...measured, label: tab.label };
        }),
      };
      counts.video += 1;
      node.children = caption as unknown as RootContent[];
      node.data = {
        hName: "figure",
        hProperties: { dataBlock: "clips", dataNumber: counts.video, dataClips: JSON.stringify(clips) },
      };
    };

    visit(tree);
    for (const key of defined) if (!cited.has(key)) fail(`the reference [^${key}] is defined but never cited.`);
  };
}

function plainText(node: PhrasingContent): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  return "children" in node ? node.children.map(plainText).join("") : "";
}

function ordinal(n: number): string {
  return ["first", "second", "third"][n - 1] ?? `${n}th`;
}

/** The references' heading and back links (remark-rehype writes the footnotes section). */
export const remarkRehypeOptions: NonNullable<MarkdownOptions["remarkRehypeOptions"]> = {
  footnoteLabel: "References",
  footnoteLabelTagName: "h2",
  // Visible, as a post's H2; the default is a screen-reader-only label.
  footnoteLabelProperties: { className: [] },
  // "↩" for each citation of a source, without the default's number after the second: its
  // label says which one, and a visible number that the label lacks fails axe.
  footnoteBackContent: "↩",
  footnoteBackLabel: (referenceIndex, rereferenceIndex) =>
    `Back to citation ${referenceIndex + 1} in the text${rereferenceIndex > 1 ? ` (${rereferenceIndex})` : ""}`,
};

/** Class lists, as hast holds them. */
const classes = (list: string) => list.split(" ");
const REFERENCES = classes("mt-10 border-t border-navy/10 pt-2");
const REFERENCES_HEADING = classes("mt-[0.8em] mb-[0.5em] font-hand text-2xl leading-snug font-semibold text-navy sm:text-3xl");
const REFERENCE_LIST = classes("text-[0.9375rem] leading-relaxed");
const REFERENCE_ITEM = classes("grid scroll-mt-4 grid-cols-[2.25rem_1fr] rounded-xl py-1.5 target:bg-butter");
const REFERENCE_NUMBER = classes("pr-2 text-right text-ink");
const REFERENCE_TEXT = classes("min-w-0 [&>p]:m-0");
// Raised without `vertical-align`, which would open up the line it sits in.
const CITATIONS = classes("relative -top-[0.5em] ml-px align-baseline text-[0.75em] leading-none font-bold text-navy");
const CITATION = classes("rounded-sm px-px text-navy no-underline hover:underline hover:decoration-2 hover:underline-offset-2");
const BACK_LINK = classes("ml-1.5 font-bold text-navy no-underline hover:underline");

function text(node: ElementContent): string {
  if (node.type === "text") return node.value;
  return node.type === "element" ? node.children.map(text).join("") : "";
}

/** The citation link inside a footnote reference's `sup`, if `node` is one. */
function citationLink(node: HastRoot["children"][number]): Element | undefined {
  if (node.type !== "element" || node.tagName !== "sup") return undefined;
  const link = node.children.find((c) => c.type === "element" && c.properties.dataFootnoteRef);
  return link?.type === "element" ? link : undefined;
}

/** Brackets and commas between citation numbers, which screen readers skip. */
function punctuation(value: string): Element {
  return { type: "element", tagName: "span", properties: { ariaHidden: "true" }, children: [{ type: "text", value }] };
}

/**
 * Shows citations raised, with citations side by side joined into one "[2, 3]" (each number its
 * own link), and the references as a list numbered "[1]", each with its ↩ link back to the text.
 */
export function rehypeReferences() {
  return (tree: HastRoot) => {
    const visit = (parent: HastRoot | Element) => {
      for (let i = 0; i < parent.children.length; i++) {
        const links: Element[] = [];
        for (let j = i; j < parent.children.length; j++) {
          const link = citationLink(parent.children[j]);
          if (!link) break;
          links.push(link);
        }
        if (!links.length) continue;
        const group: ElementContent[] = [punctuation("[")];
        links.forEach((link, k) => {
          const number = text(link);
          link.children = [{ type: "text", value: number }];
          link.properties.className = CITATION;
          link.properties.ariaLabel = `Reference ${number}`;
          delete link.properties.ariaDescribedBy;
          if (k) group.push(punctuation(", "));
          group.push(link);
        });
        group.push(punctuation("]"));
        const sup: Element = { type: "element", tagName: "sup", properties: { className: CITATIONS }, children: group };
        parent.children.splice(i, links.length, sup);
      }
      parent.children.forEach((node) => {
        if (node.type !== "element") return;
        if (node.tagName === "section" && node.properties.dataFootnotes !== undefined) {
          node.properties.className = REFERENCES;
          node.properties.ariaLabelledBy = ["footnote-label"];
          for (const child of node.children) {
            if (child.type === "element" && child.tagName === "ol") numberReferences(child);
          }
        }
        if (node.tagName === "h2" && node.properties.id === "footnote-label") {
          node.properties.className = REFERENCES_HEADING;
        }
        if (node.tagName === "a" && node.properties.dataFootnoteBackref !== undefined) {
          node.properties.className = BACK_LINK;
        }
        visit(node);
      });
    };
    visit(tree);
  };
}

function numberReferences(list: Element) {
  list.properties.className = REFERENCE_LIST;
  let n = 0;
  for (const item of list.children) {
    if (item.type !== "element" || item.tagName !== "li") continue;
    n += 1;
    item.properties.className = REFERENCE_ITEM;
    item.children = [
      { type: "element", tagName: "span", properties: { className: REFERENCE_NUMBER }, children: [{ type: "text", value: `[${n}]` }] },
      { type: "element", tagName: "div", properties: { className: REFERENCE_TEXT }, children: item.children },
    ];
  }
}
