import type { Metadata } from "next";
import { Suspense } from "react";
import RankingsPage, { Loading } from "@/components/rankings/RankingsPage";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Stimulation rankings - HyperStim?",
  description:
    "Which kids’ videos and channels are the most stimulating, or overstimulating? Every one in our dataset, ranked by overall score or any of 12 measurements.",
  path: "rankings/",
});

export default function Page() {
  // The state is read from the URL on the client; the Suspense boundary is required for the static export.
  return (
    <Suspense fallback={<Loading />}>
      <RankingsPage />
    </Suspense>
  );
}
