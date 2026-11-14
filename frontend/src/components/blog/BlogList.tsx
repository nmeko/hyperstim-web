import Link from "next/link";
import Pagination from "@/components/Pagination";
import { asset } from "@/lib/asset";
import { blogPageHref, formatDate, postHref, type Post } from "@/lib/blog/posts";
import InlineText from "./InlineText";

// The blog's post list (plan 018; STYLE.md, Blog list page): page 1 at /blog/, later pages at
// /blog/page/2/ and on, each built as its own static page.

export default function BlogList({ posts, page, pageCount }: { posts: Post[]; page: number; pageCount: number }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 md:pt-12 lg:px-8">
      <Hero />
      {posts.length === 0 ? (
        <p className="rounded-2xl bg-sky p-6 text-center">No posts yet. Check back soon.</p>
      ) : (
        <section aria-label="All posts" className="rounded-[2rem] border border-navy/15 bg-white px-4 py-2 sm:px-8">
          <ol>
            {posts.map((post) => (
              <li
                key={post.slug}
                // The line between posts stops short of the row's rounded hover fill.
                className="group relative -mx-3 rounded-2xl px-3 py-6 not-first:before:absolute not-first:before:inset-x-3 not-first:before:top-0 not-first:before:border-t not-first:before:border-navy/10 hover:bg-sky/70"
              >
                <p className="text-sm text-ink">
                  <time dateTime={post.date}>{formatDate(post.date)}</time>
                </p>
                <h2 className="mt-1 font-hand text-[1.375rem] leading-[1.3] font-semibold text-navy sm:text-[1.625rem]">
                  <Link
                    href={postHref(post.slug)}
                    className="decoration-2 underline-offset-[5px] after:absolute after:inset-0 after:rounded-2xl group-hover:underline"
                  >
                    {post.title}
                  </Link>
                </h2>
                <p className="mt-2">
                  <InlineText>{post.tldr}</InlineText>
                </p>
              </li>
            ))}
          </ol>
          <Pagination
            page={page}
            pageCount={pageCount}
            href={blogPageHref}
            className="border-t border-navy/10 pt-5 pb-5"
          />
        </section>
      )}
    </div>
  );
}

/**
 * The H1, with the kid lying on the list card's top edge at the right. The kid's head is as large
 * as on the other pages (STYLE.md), so it rises above the H1 into the page's top padding; the
 * hero's minimum height keeps it clear of the header.
 */
function Hero() {
  return (
    <div className="relative md:min-h-36 md:pr-72 lg:min-h-44 lg:pr-80 xl:min-h-52 xl:pr-92">
      <h1 className="pb-6 font-hand text-[2rem] leading-tight font-semibold text-navy sm:text-[2.75rem] lg:text-[3.25rem]">
        Blog
      </h1>
      {/* Resting on the card's edge: the art's bottom 4 % is the notebook's shadow. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, images pre-converted */}
      <img
        src={asset("/images/kid_notebook.webp")}
        alt=""
        aria-hidden="true"
        width={544}
        height={419}
        data-kid=""
        className="pointer-events-none absolute right-0 bottom-0 z-10 hidden h-auto translate-y-[4%] md:mr-4 md:block md:w-[12.625rem] lg:w-[14.375rem] xl:w-[17rem]"
      />
    </div>
  );
}
