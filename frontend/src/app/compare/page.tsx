import type { Metadata } from "next";
import { Suspense } from "react";
import ComparePage, { Loading } from "@/components/compare/ComparePage";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Compare - HyperStim?",
  description:
    "Is one kids’ video or channel more overstimulating than another? Put two side by side and see how their scene changes, colors, and sounds differ.",
  path: "compare/",
});

export default function Page() {
  // The state is read from the URL on the client; the Suspense boundary is required for the static export.
  return (
    <Suspense fallback={<Loading />}>
      <ComparePage />
    </Suspense>
  );
}
