import { useSyncExternalStore } from "react";
import { thumbnailUrl } from "@/lib/api";

// Which videos YouTube has no thumbnail for, as far as this page load knows (plan 009, Thumbnails).
// A failed image doesn't say why it failed, so `Thumbnail` reports the failure here and we ask our
// backend once for the status: 404 means YouTube has none (the video is likely gone); a 502 or a
// network error means YouTube or the network is down, which says nothing about the video.

const asked = new Set<string>();
const gone = new Set<string>();
const listeners = new Set<() => void>();

/** A video's thumbnail failed to load: find out once whether YouTube has none. */
export function checkThumbnail(id: string): void {
  if (asked.has(id)) return;
  asked.add(id);
  fetch(thumbnailUrl(id, "mq"))
    .then((res) => {
      if (res.status !== 404) return;
      gone.add(id);
      listeners.forEach((listener) => listener());
    })
    .catch(() => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True once our backend has said YouTube has no thumbnail for this video. */
export function useThumbnailGone(id: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => id !== null && gone.has(id),
    () => false,
  );
}
