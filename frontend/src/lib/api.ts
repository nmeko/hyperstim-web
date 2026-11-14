// Typed client for the backend API. The contract lives in backend/; change both together.

export type Meta = {
  videoCount: number;
  channelCount: number;
  /** ISO date */
  updatedAt: string;
  /** Videos added in the last 7 × 24 hours (plan 013). */
  addedLast7Days: number;
  /** Channels in the dataset 7 × 24 hours ago. */
  channelCount7DaysAgo: number;
  /** When the last video was added (UTC, ISO 8601); null before any. */
  lastAddedAt: string | null;
  /** The videos every score is compared with (the reference set, plan 013). */
  referenceCount: number;
  /** When the collector last ran all of its channel searches (ISO date); null before it has. */
  channelsCheckedAt: string | null;
};

export type VideoSummary = {
  id: string;
  title: string;
  channelId: string;
  channel: string;
  /** Stimulation score 0–100, one decimal. */
  score: number;
};

/** One of the 12 measurements, in taxonomy order. */
export type Feature = {
  key: string;
  /** Raw value; null when it couldn't be measured. */
  value: number | null;
  /** Percentile 0–100 in the dataset, one decimal; null when `value` is. */
  percentile: number | null;
};

export type VideoDetail = VideoSummary & {
  /** False for a video checked live from a channel we don't have: no channel page to link to. */
  channelInDataset: boolean;
  features: Feature[];
};

export type ChannelSummary = {
  id: string;
  name: string;
  /** Mean stimulation score of the channel's videos, 0–100, one decimal. */
  score: number;
  videoCount: number;
};

/** One of a channel's videos, with its scores (as in `VideoDetail`). */
export type ChannelVideo = {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  publishedAt: string;
  /** Stimulation score 0–100, one decimal. */
  score: number;
  features: Feature[];
};

export type ChannelDetail = {
  id: string;
  name: string;
  videoCount: number;
  /** Mean stimulation score of the channel's videos, 0–100, one decimal. */
  score: number;
  /**
   * The 12 measurements: `value` is the mean raw value and `percentile` the mean of the videos'
   * percentiles, over the videos that have one; null if none has.
   */
  features: Feature[];
  /** Oldest first. */
  videos: ChannelVideo[];
};

/** A video in a ranking: its place and its 12 measurements. */
export type RankedVideo = VideoSummary & {
  /** Category key (see `CATEGORIES`). */
  category: string;
  /** Place by the ranking's criterion within its category, 1 = first in the order asked for (the
   * most stimulating, or with `asc` the least stimulating); null = no value. */
  rank: number | null;
  features: Feature[];
};

/** A channel in a ranking; `features` as in `ChannelDetail`. */
export type RankedChannel = ChannelSummary & {
  rank: number | null;
  features: Feature[];
};

export type ListResponse<T> = {
  items: T[];
  /** Items matching the category and search. */
  total: number;
  /**
   * The dataset's version the list is from (UTC, ISO 8601). Sent back as `asOf`, later pages,
   * sorts and searches show the dataset as it was then, so rows don't shift while a visitor
   * browses (plan 013).
   */
  asOf: string;
};

/** What a ranking is sorted by: the overall score or one of the 12 feature keys. */
export type SortKey = string;

export type Order = "desc" | "asc";

/** How a list is ranked, filtered and paged. Empty `category` or `q` = all. */
export type ListParams = {
  sort: SortKey;
  order: Order;
  category?: string;
  q?: string;
  offset?: number;
  limit: number;
  /** A list's `asOf`: answer as the dataset was then. */
  asOf?: string;
  /** Only rows added from this UTC time (inclusive) and before this one (plan 007, search filters). */
  addedFrom?: string;
  addedBefore?: string;
};

/** The channel behind a YouTube channel or video link (compare page). */
export type ChannelLookup = {
  channelId: string;
  /** Null when we don't have the channel and didn't need to ask YouTube for its name. */
  name: string | null;
  inDataset: boolean;
  /** Its videos in the dataset; 0 when it isn't in it. */
  videoCount: number;
};

/** Where a live analysis is: waiting, one of its three steps, or finished. */
export type AnalysisStatus = "queued" | "lookup" | "download" | "measure" | "done" | "failed";

/** Why a live analysis failed. */
export type AnalysisErrorCode = "unavailable" | "not_for_kids" | "too_short" | "live" | "failed";

/** A live analysis of a video that isn't in the dataset. */
export type Analysis = {
  status: AnalysisStatus;
  /** Videos ahead of this one, while queued. */
  queuePosition: number | null;
  /** Estimated progress 0–1; 1 only when done. */
  progress: number;
  /** Estimated seconds left; null while queued, done or failed. */
  remainingS: number | null;
  /** The current step is taking much longer than usual. */
  error: AnalysisErrorCode | null;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export type Params = Record<string, string | number>;

export type Method = "GET" | "POST";

async function request<T>(method: Method, path: string, params: Params = {}): Promise<T> {
  if (process.env.NEXT_PUBLIC_API_MOCK === "1") {
    const { mockRequest } = await import("./mock");
    return mockRequest(method, path, params) as Promise<T>;
  }
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const url = `${API_BASE}${path}${query ? `?${query}` : ""}`;
  // No body and no custom headers, so a POST needs no CORS preflight.
  const res = await fetch(url, { method, headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new ApiError(res.status, `${method} ${path} failed with ${res.status}`);
  }
  return (await res.json()) as T;
}

function get<T>(path: string, params: Params = {}): Promise<T> {
  return request("GET", path, params);
}

export function getMeta(): Promise<Meta> {
  return get<Meta>("/api/meta");
}

/** Drops unset and empty parameters, so the defaults apply. */
function listParams(params: Record<string, string | number | undefined>): Params {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== ""),
  );
}

export function getVideos(params: ListParams): Promise<ListResponse<RankedVideo>> {
  return get("/api/videos", listParams(params));
}

/** Channels with at least `minVideos` videos (default 1: every channel, plan 013). */
export function getChannels(params: ListParams & { minVideos?: number }): Promise<ListResponse<RankedChannel>> {
  return get("/api/channels", listParams(params));
}

/**
 * One video in the dataset, or one analyzed live. Any other video rejects with an `ApiError`
 * with status 404.
 */
/**
 * A video's YouTube thumbnail, served by our backend so the browser doesn't contact YouTube
 * (plan 009): `hq` is 480×360 (4:3, letterboxed), `mq` 320×180 (16:9). 404 for a video the
 * backend doesn't know; the image's grey box shows then.
 */
export function thumbnailUrl(id: string, size: "hq" | "mq" = "hq"): string {
  return `${API_BASE}/api/thumbnails/${encodeURIComponent(id)}?size=${size}`;
}

export function getVideo(id: string): Promise<VideoDetail> {
  return get(`/api/videos/${encodeURIComponent(id)}`);
}

/** One channel in the dataset. Any other rejects with an `ApiError` with status 404. */
export function getChannel(id: string): Promise<ChannelDetail> {
  return get(`/api/channels/${encodeURIComponent(id)}`);
}

/**
 * Starts the live analysis of a video, or joins it if it is running or done. Rejects with an
 * `ApiError` with status 429 (too many new analyses from this visitor) or 503 (queue full).
 */
export function startAnalysis(id: string): Promise<Analysis> {
  return request("POST", `/api/analyses/${encodeURIComponent(id)}`);
}

/**
 * The channel behind a YouTube channel or video link. Rejects with an `ApiError` with status
 * 404 (no channel found), 422 (not such a link) or 429 (over this visitor's limit, shared with
 * live analyses).
 */
export function lookupChannel(url: string): Promise<ChannelLookup> {
  return get("/api/channel-lookup", { url });
}

/** A live analysis' progress. Rejects with an `ApiError` with status 404 if it was never started. */
export function getAnalysis(id: string): Promise<Analysis> {
  return get(`/api/analyses/${encodeURIComponent(id)}`);
}
