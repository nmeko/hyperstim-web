import type { Metadata } from "next";
import BlogList from "@/components/blog/BlogList";
import { getPosts, pageCount, postsOnPage } from "@/lib/blog/posts";
import { listMetadata } from "./list";

export const metadata: Metadata = listMetadata(1);

export default function Page() {
  const posts = getPosts();
  return <BlogList posts={postsOnPage(posts, 1)} page={1} pageCount={pageCount(posts.length)} />;
}
