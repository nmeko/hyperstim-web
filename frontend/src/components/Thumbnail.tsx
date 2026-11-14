"use client";

import { useEffect, useRef, useState } from "react";
import { thumbnailUrl } from "@/lib/api";
import { checkThumbnail } from "@/lib/thumbnails";

type Props = {
  id: string;
  size?: "hq" | "mq";
  width: number;
  height: number;
  /** The image's classes; the placeholder takes them too, so it keeps the box's size, corners and fill. */
  className: string;
  loading?: "lazy";
  /** The picture icon in the placeholder; off where something else sits in the middle (the Play button). */
  icon?: boolean;
  /** Marks the video preview's cover (`YouTubePlayer`). */
  "data-cover"?: string;
};

/**
 * A video's thumbnail from our backend. One that can't load (gone from YouTube, YouTube down, no
 * network) is a placeholder in its place: the same box with a picture icon (plan 009, Thumbnails).
 * Decorative either way, as the thumbnail's text is always next to it. A failure is reported to
 * `lib/thumbnails`, which finds out whether YouTube has none (for `VideoGoneNote` and the popovers).
 */
export function Thumbnail({ id, size = "hq", width, height, className, loading, icon = true, ...data }: Props) {
  const src = thumbnailUrl(id, size);
  const [failed, setFailed] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);

  const fail = () => {
    setFailed(src);
    checkThumbnail(id);
  };

  // An image that failed before React listened for it (e.g. from the browser's cache).
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth === 0) {
      setFailed(src);
      checkThumbnail(id);
    }
  }, [src, id]);

  if (failed === src) {
    return (
      <span {...data} aria-hidden="true" data-thumbnail-missing="" className={`${className} flex items-center justify-center`}>
        {icon && <PictureIcon />}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export, no image optimization
    <img
      {...data}
      ref={img}
      src={src}
      alt=""
      loading={loading}
      width={width}
      height={height}
      onError={fail}
      className={className}
    />
  );
}

/** A framed picture (a sun over a hill), about a third of the box's height. */
function PictureIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="aspect-square h-[34%] min-h-2.5 text-navy/30"
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m21 16-5-5-9 9" />
    </svg>
  );
}
