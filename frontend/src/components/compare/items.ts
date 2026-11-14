import { channelLabel } from "@/components/ChannelName";
// What a compare slot holds (plan 008): a video or a channel, loaded by its ID.
import { ApiError, getChannel, getVideo, type ChannelDetail, type Feature, type VideoDetail } from "@/lib/api";
import { isChannelId, isVideoId } from "@/lib/youtube";
import type { View } from "./state";

export type Item = { kind: "video"; video: VideoDetail } | { kind: "channel"; channel: ChannelDetail };

/** An ID that can't be a video's or channel's: the slot says it can't find it. */
export const INVALID_ID = 400;

/** The item with this ID, or null for an empty slot. A video not in the dataset fails with 404. */
export async function loadItem(view: View, id: string): Promise<Item | null> {
  if (!id) return null;
  if (view === "videos") {
    if (!isVideoId(id)) throw new ApiError(INVALID_ID, "Not a video ID");
    return { kind: "video", video: await getVideo(id) };
  }
  if (!isChannelId(id)) throw new ApiError(INVALID_ID, "Not a channel ID");
  return { kind: "channel", channel: await getChannel(id) };
}

export function itemName(item: Item): string {
  return item.kind === "video" ? item.video.title : channelLabel(item.channel.name, item.channel.id);
}

export function itemScore(item: Item): number {
  return item.kind === "video" ? item.video.score : item.channel.score;
}

export function itemFeatures(item: Item): Feature[] {
  return item.kind === "video" ? item.video.features : item.channel.features;
}
