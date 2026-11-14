import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PostPage from "@/components/blog/PostPage";
import { getPost, getPosts, postHref, type Post } from "@/lib/blog/posts";
import { pageMetadata, shareImage, siteUrl } from "@/lib/site";

// One page per post, built from content/blog/<slug>.md (plan 018).
export const dynamicParams = false;

/** The stand-in slug while there are no posts; never a post's, as file names start with a letter or digit. */
const NO_POST = "_";

export function generateStaticParams() {
  const slugs = getPosts().map(({ slug }) => ({ slug }));
  // A static export needs at least one page per route. Until there is one, a stand-in at "_"
  // renders the not-found page (marked noindex, linked from nowhere, not in the sitemap).
  return slugs.length ? slugs : [{ slug: NO_POST }];
}

async function postOf(params: PageProps<"/blog/[slug]">["params"]): Promise<Post> {
  const post = getPost((await params).slug);
  if (!post) notFound();
  return post;
}

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const post = await postOf(params);
  return pageMetadata({
    title: `${post.title} - HyperStim?`,
    description: post.description,
    path: postHref(post.slug).slice(1),
    published: post.date,
  });
}

/** Structured data, so search results can show the post's date (plan 011). */
export function postJsonLd(post: Post) {
  const url = `${siteUrl}${postHref(post.slug).slice(1)}`;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    url,
    mainEntityOfPage: url,
    image: new URL(shareImage.url.slice(1), siteUrl).href,
    publisher: { "@type": "Organization", name: "HyperStim?", url: siteUrl },
  };
}

export default async function Page({ params }: PageProps<"/blog/[slug]">) {
  const post = await postOf(params);
  return (
    <>
      <script
        type="application/ld+json"
        // "<" escaped, so a title can't close the script.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(postJsonLd(post)).replace(/</g, "\\u003c") }}
      />
      <PostPage post={post} />
    </>
  );
}
