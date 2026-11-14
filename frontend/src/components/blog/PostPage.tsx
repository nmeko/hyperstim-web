import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate, postHref, type Post, type PostLink } from "@/lib/blog/posts";
import InlineText from "./InlineText";
import PostBody from "./PostBody";

// One blog post (plan 018; STYLE.md, Blog post): back link, title, date, the TL;DR box, the text
// with its references, then links to the newer and older posts.

const TEXT_LINK = "font-bold text-navy underline decoration-2 underline-offset-4 hover:decoration-sunny";

export default function PostPage({ post, mediaDir }: { post: Post; mediaDir?: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 lg:px-8">
      <article>
        <Link href="/blog/" className={`inline-flex min-h-11 items-center text-sm ${TEXT_LINK}`}>
          <span aria-hidden="true">←</span>&nbsp;All posts
        </Link>
        <h1 className="mt-2 font-hand text-[2rem] leading-tight font-semibold text-navy sm:text-[2.75rem] lg:text-[3.25rem]">
          {post.title}
        </h1>
        <p className="mt-2.5 text-ink">
          <time dateTime={post.date}>{formatDate(post.date)}</time>
        </p>
        <section aria-labelledby="tldr" className="mt-6 rounded-2xl border border-navy/15 px-5 py-4.5">
          <h2 id="tldr" className="font-hand text-lg font-semibold text-navy">
            TL;DR
          </h2>
          <p className="mt-1 text-[1.0625rem] leading-relaxed">
            <InlineText>{post.tldr}</InlineText>
          </p>
        </section>
        <PostBody slug={post.slug} body={post.body} mediaDir={mediaDir} />
        <Neighbors newer={post.newer} older={post.older} />
      </article>
    </div>
  );
}

/** "← Newer post" and "Older post →", side by side from `sm`, stacked below it. */
function Neighbors({ newer, older }: { newer?: PostLink; older?: PostLink }) {
  if (!newer && !older) return null;
  const item = (post: PostLink, label: ReactNode, older: boolean) => (
    <Link
      href={postHref(post.slug)}
      className={`group flex min-h-11 flex-col gap-0.5 py-2.5 max-sm:not-first:mt-0.5 max-sm:not-first:border-t max-sm:not-first:border-navy/10 max-sm:not-first:pt-3 ${
        older ? "sm:col-start-2 sm:items-end sm:text-right" : ""
      }`}
    >
      <span className="text-sm font-semibold text-ink">{label}</span>
      <span className="font-hand text-lg leading-[1.35] font-semibold text-navy decoration-2 underline-offset-4 group-hover:underline">
        {post.title}
      </span>
    </Link>
  );
  return (
    <nav aria-label="More posts" className="mt-10 grid border-t border-navy/10 pt-3 sm:grid-cols-2 sm:gap-4">
      {newer &&
        item(
          newer,
          <>
            <span aria-hidden="true">←</span> Newer post
          </>,
          false,
        )}
      {older &&
        item(
          older,
          <>
            Older post <span aria-hidden="true">→</span>
          </>,
          true,
        )}
    </nav>
  );
}
