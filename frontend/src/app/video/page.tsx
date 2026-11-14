import type { Metadata } from "next";
import { Suspense } from "react";
import VideoPage, { Loading } from "@/components/video/VideoPage";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Video details - HyperStim?",
  description: "How stimulating is this video? Its score and what we measured.",
});

export default function Page() {
  // The ID is read on the client; the Suspense boundary is required for the static export.
  return (
    <Suspense fallback={<Loading />}>
      <VideoPage />
    </Suspense>
  );
}
