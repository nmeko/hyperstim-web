import { pageMetadata } from "@/lib/site";
import { blogPageHref } from "@/lib/blog/posts";

/** The list pages' description (plan 011, Page descriptions). */
const DESCRIPTION =
  "Research, insights, and real-world examples exploring how kids’ videos use editing, motion, colors, and sound to create different viewing experiences.";

/** Page 1 is "Blog - HyperStim?", later ones "Blog, page 2 - HyperStim?", each its own canonical URL. */
export function listMetadata(page: number) {
  return pageMetadata({
    title: page <= 1 ? "Blog - HyperStim?" : `Blog, page ${page} - HyperStim?`,
    description: DESCRIPTION,
    path: blogPageHref(page).slice(1),
  });
}
