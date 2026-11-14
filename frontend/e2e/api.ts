import type { APIRequestContext } from "@playwright/test";
import type { ChannelDetail, RankedChannel, RankedVideo } from "../src/lib/api";
import { API } from "./backend";

// Tests pick their videos and channels through the real API, so a new import of the
// reference set doesn't break them (plan 012).

async function list<T>(request: APIRequestContext, path: string): Promise<T[]> {
  const res = await request.get(`${API}/api${path}`);
  if (!res.ok()) throw new Error(`${path}: ${res.status()}`);
  return ((await res.json()) as { items: T[] }).items;
}

/** The `n` most stimulating videos (most stimulating first). */
export function topVideos(request: APIRequestContext, n = 1) {
  return list<RankedVideo>(request, `/videos?limit=${n}`);
}

/** The `n` most stimulating channels. */
export function topChannels(request: APIRequestContext, n = 1) {
  return list<RankedChannel>(request, `/channels?limit=${n}`);
}

/** The least stimulating video. */
export async function leastStimulatingVideo(request: APIRequestContext) {
  return (await list<RankedVideo>(request, "/videos?order=asc&limit=1"))[0];
}

/** A channel's videos. */
export async function channelVideos(request: APIRequestContext, id: string) {
  const res = await request.get(`${API}/api/channels/${id}`);
  if (!res.ok()) throw new Error(`channel ${id}: ${res.status()}`);
  return ((await res.json()) as ChannelDetail).videos;
}
