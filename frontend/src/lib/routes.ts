/** Link to a channel's page. */
export function channelHref(channelId: string): string {
  return `/channel?id=${encodeURIComponent(channelId)}`;
}

/** Link to a video's page. */
export function videoHref(videoId: string): string {
  return `/video?id=${encodeURIComponent(videoId)}`;
}

/** Link to the compare page; `view` "videos" and empty slots are left out. */
export function compareHref({ view = "videos", a = "", b = "" }: { view?: "videos" | "channels"; a?: string; b?: string }): string {
  const params = new URLSearchParams();
  if (view !== "videos") params.set("view", view);
  if (a) params.set("a", a);
  if (b) params.set("b", b);
  const query = params.toString();
  return query ? `/compare?${query}` : "/compare";
}
