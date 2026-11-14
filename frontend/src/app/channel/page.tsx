import type { Metadata } from "next";
import { Suspense } from "react";
import ChannelPage, { Loading } from "@/components/channel/ChannelPage";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Channel details - HyperStim?",
  description:
    "How stimulating are this channel’s videos, and how has that changed over the years?",
});

export default function Page() {
  // The ID is read on the client; the Suspense boundary is required for the static export.
  return (
    <Suspense fallback={<Loading />}>
      <ChannelPage />
    </Suspense>
  );
}
