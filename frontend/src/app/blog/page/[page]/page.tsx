import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BlogList from "@/components/blog/BlogList";
import { getPosts, pageCount, postsOnPage } from "@/lib/blog/posts";
import { listMetadata } from "../../list";

// The list's later pages, /blog/page/2/ and on; page 1 is /blog/ (plan 018).
export const dynamicParams = false;

export function generateStaticParams() {
  const count = pageCount(getPosts().length);
  const pages = Array.from({ length: count - 1 }, (_, i) => ({ page: String(i + 2) }));
  // A static export needs at least one page per route. Until there is one, a stand-in at "_"
  // renders the not-found page (marked noindex, linked from nowhere, not in the sitemap).
  return pages.length ? pages : [{ page: "_" }];
}

async function pageNumber(params: PageProps<"/blog/page/[page]">["params"]) {
  const page = Number((await params).page);
  if (!Number.isInteger(page) || page < 2 || page > pageCount(getPosts().length)) notFound();
  return page;
}

export async function generateMetadata({ params }: PageProps<"/blog/page/[page]">): Promise<Metadata> {
  return listMetadata(await pageNumber(params));
}

export default async function Page({ params }: PageProps<"/blog/page/[page]">) {
  const page = await pageNumber(params);
  const posts = getPosts();
  return <BlogList posts={postsOnPage(posts, page)} page={page} pageCount={pageCount(posts.length)} />;
}
