import type { Metadata } from "next";
import PrivacyPage from "@/components/privacy/PrivacyPage";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Privacy policy - HyperStim?",
  description: "What the HyperStim? website keeps about you, why, and for how long.",
  path: "privacy/",
});

export default function Page() {
  return <PrivacyPage />;
}
