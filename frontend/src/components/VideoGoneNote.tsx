"use client";

import { useThumbnailGone } from "@/lib/thumbnails";

/** Said wherever a video's thumbnail is missing because YouTube has none (plan 009, Thumbnails). */
export const VIDEO_GONE = "This video may have been removed or made private on YouTube.";

/** A footnote under a video's preview, shown only if YouTube has no thumbnail for it. */
export function VideoGoneNote({ id, className = "" }: { id: string; className?: string }) {
  if (!useThumbnailGone(id)) return null;
  return <p className={`mt-2 text-sm text-ink/80 ${className}`}>{VIDEO_GONE}</p>;
}
