import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import YouTubePlayer from "@/components/YouTubePlayer";
import ClipCompare from "@/components/blog/ClipCompare";
import { asset } from "@/lib/asset";
import { rehypeReferences, remarkPost, remarkRehypeOptions } from "@/lib/blog/markdown";
import { blogDirs } from "@/lib/blog/posts";

// A post's text, rendered at build time (plan 018; STYLE.md, Blog post). No JavaScript is
// needed to read it; only the YouTube embeds and the clip comparison run any.

const TEXT_LINK = "font-bold text-navy underline decoration-2 underline-offset-4 hover:decoration-sunny";
const H2 = "mt-[1.8em] mb-[0.5em] font-hand text-2xl leading-snug font-semibold text-navy sm:text-3xl";
const CELL = "border-b border-navy/10 py-2 pr-4 text-left align-top sm:pr-6";

type BlockProps = ComponentProps<"figure"> & {
  "data-block"?: string;
  "data-number"?: number;
  "data-src"?: string;
  "data-alt"?: string;
  "data-poster"?: string;
  "data-id"?: string;
  "data-clips"?: string;
};

/** A figure, video, YouTube embed or clip comparison with its numbered caption ("Figure 1.", "Video 1."). */
function Block({ slug, props }: { slug: string; props: BlockProps }) {
  const { children, "data-block": block, "data-number": number } = props;
  const media = (file?: string) => asset(`/blog-media/${slug}/${file}`);
  const label = block === "figure" ? `Figure ${number}.` : `Video ${number}.`;
  const caption = (
    <figcaption className="mt-2.5 text-[0.9375rem] leading-normal text-ink">
      <b className="text-navy">{label}</b> {children}
    </figcaption>
  );
  let content: ReactNode;
  if (block === "figure") {
    // eslint-disable-next-line @next/next/no-img-element -- static export, no image optimization
    content = <img src={media(props["data-src"])} alt={props["data-alt"]} loading="lazy" className="h-auto w-full rounded-2xl" />;
  } else if (block === "video") {
    content = (
      <video controls preload="none" poster={media(props["data-poster"])} className="aspect-video w-full rounded-2xl bg-navy/10">
        <source src={media(props["data-src"])} type="video/mp4" />
      </video>
    );
  } else if (block === "clips") {
    content = <ClipCompare clips={JSON.parse(props["data-clips"]!)} />;
  } else {
    content = <YouTubePlayer id={props["data-id"]!} title={captionText(children) || label} />;
  }
  return (
    <figure className="my-8">
      {content}
      {caption}
    </figure>
  );
}

/** The caption's plain text, for the YouTube player's name. */
function captionText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(captionText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return captionText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** An element's props without the markdown node that react-markdown adds. */
function dom<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const rest = { ...props };
  delete rest.node;
  return rest;
}

function components(slug: string): Components {
  return {
    h2: ({ className, ...props }) => <h2 {...dom(props)} className={className || H2} />,
    h3: (props) => (
      <h3 {...dom(props)} className="mt-[1.5em] mb-[0.4em] font-hand text-xl leading-snug font-semibold text-navy sm:text-2xl" />
    ),
    p: (props) => <p {...dom(props)} className="mb-[1.1em]" />,
    ul: ({ className, ...props }) => (
      <ul {...dom(props)} className={`mb-[1.1em] list-disc space-y-1 pl-6 ${className ?? ""}`} />
    ),
    ol: ({ className, ...props }) => (
      <ol {...dom(props)} className={className || "mb-[1.1em] list-decimal space-y-1 pl-6"} />
    ),
    blockquote: (props) => (
      <blockquote {...dom(props)} className="mb-[1.1em] border-l-4 border-navy/15 pl-4 italic [&>p:last-child]:mb-0" />
    ),
    // Bold is navy; bold italic (the site's name, ***HyperStim?***) keeps the text's color.
    strong: (props) => <strong {...dom(props)} className="font-bold text-navy in-[em]:text-current" />,
    hr: () => <hr className="my-8 border-navy/10" />,
    code: (props) => <code {...dom(props)} className="rounded bg-navy/5 px-1 font-mono text-[0.9em]" />,
    pre: (props) => (
      <pre {...dom(props)} className="mb-[1.1em] overflow-x-auto rounded-2xl bg-sky p-4 text-base [&>code]:bg-transparent [&>code]:p-0" />
    ),
    // Wide tables scroll inside their own box, so the page doesn't at 320 px.
    table: (props) => (
      <div className="mb-[1.1em] overflow-x-auto">
        <table {...dom(props)} className="w-full border-collapse text-base" />
      </div>
    ),
    th: ({ style, ...props }) => (
      <th {...dom(props)} style={style} className={`${CELL} border-navy/15 font-semibold text-navy`} />
    ),
    td: (props) => <td {...dom(props)} className={CELL} />,
    a: ({ href = "", className, children, ...props }) => {
      // Citations and back links are styled by rehypeReferences.
      if (className) {
        return (
          <a href={href} className={className} {...dom(props)}>
            {children}
          </a>
        );
      }
      if (href.startsWith("/")) {
        return (
          <Link href={href} className={TEXT_LINK}>
            {children}
          </Link>
        );
      }
      if (/^https?:/.test(href)) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
            {children}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        );
      }
      return (
        <a href={href} className={TEXT_LINK}>
          {children}
        </a>
      );
    },
    figure: (props) => <Block slug={slug} props={dom(props) as BlockProps} />,
  };
}

export default function PostBody({
  slug,
  body,
  mediaDir = blogDirs().media,
}: {
  slug: string;
  body: string;
  /** Where the post's media files are checked; the site's own by default. */
  mediaDir?: string;
}) {
  return (
    <div className="mt-8 text-[1.0625rem] leading-[1.75] sm:text-lg">
      <Markdown
        remarkPlugins={[remarkGfm, remarkDirective, [remarkPost, { slug, file: `${slug}.md`, mediaDir }]]}
        rehypePlugins={[rehypeReferences]}
        remarkRehypeOptions={remarkRehypeOptions}
        components={components(slug)}
      >
        {body}
      </Markdown>
    </div>
  );
}
