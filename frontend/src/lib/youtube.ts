export type ParseResult =
  | { ok: true; id: string }
  | { ok: false; reason: "empty" | "invalid" };

const ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

type ChannelLink = { kind: "channel"; id: string } | { kind: "channelPage" };

/** A YouTube channel link: `/channel/UC…` (its ID), or `/@handle`, `/c/…`, `/user/…` (a page to look up). */
function parseChannelLink(text: string): ChannelLink | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!HOSTS.has(host) || host === "youtu.be") return null;
  const [first, second] = url.pathname.split("/").filter(Boolean);
  if (first === "channel") return CHANNEL_ID.test(second ?? "") ? { kind: "channel", id: second } : null;
  if (first === "c" || first === "user") return second ? { kind: "channelPage" } : null;
  return /^@./.test(first ?? "") ? { kind: "channelPage" } : null;
}

/** Text that is meant as a link rather than a name. */
const LOOKS_LIKE_LINK = /(?:^https?:\/\/)|youtu\.?be|youtube\./i;

/** What a search field holds (compare picker, plan 008; rankings search, plan 007). */
export type SearchInput =
  | { kind: "empty" }
  /** Text to search for; `videoId` when it's also a bare video ID. */
  | { kind: "name"; videoId: string | null }
  /** A video link. */
  | { kind: "video"; id: string }
  /** A `/channel/UC…` link. */
  | { kind: "channel"; id: string }
  /** A handle, `/c/` or `/user/` link: a lookup finds its channel. */
  | { kind: "channelPage" }
  /** Looks like a link, but not one we can use. */
  | { kind: "badLink" };

export function readSearchInput(input: string): SearchInput {
  const text = input.trim();
  if (!text) return { kind: "empty" };
  if (ID.test(text)) return { kind: "name", videoId: text };
  if (!LOOKS_LIKE_LINK.test(text)) return { kind: "name", videoId: null };
  const video = parseVideoInput(text);
  if (video.ok) return { kind: "video", id: video.id };
  return parseChannelLink(text) ?? { kind: "badLink" };
}

/** A bare 11-character video ID. */
export function isVideoId(text: string): boolean {
  return ID.test(text);
}

/** A channel ID ("UC" and 22 characters). */
export function isChannelId(text: string): boolean {
  return CHANNEL_ID.test(text);
}
const HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);
const PATH_PREFIXES = ["shorts", "embed", "live", "v"];

/** Extracts the 11-character video ID from a YouTube link or a bare ID. */
export function parseVideoInput(input: string): ParseResult {
  const text = input.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (ID.test(text)) return { ok: true, id: text };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!HOSTS.has(host)) return { ok: false, reason: "invalid" };

  const segments = url.pathname.split("/").filter(Boolean);
  let candidate: string | null | undefined;
  if (host === "youtu.be") {
    candidate = segments[0];
  } else if (segments[0] === "watch") {
    candidate = url.searchParams.get("v");
  } else if (PATH_PREFIXES.includes(segments[0])) {
    candidate = segments[1];
  }
  return candidate && ID.test(candidate)
    ? { ok: true, id: candidate }
    : { ok: false, reason: "invalid" };
}
