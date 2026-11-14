import type { Metadata } from "next";
import AboutPage from "@/components/about/AboutPage";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "About - HyperStim?",
  description: "Who built HyperStim? And why we built it.",
  path: "about/",
});

export default function Page() {
  return <AboutPage />;
}
