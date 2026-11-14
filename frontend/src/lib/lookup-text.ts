import { ApiError } from "./api";

// What a channel link's lookup says, in the compare picker (plan 008) and the rankings search (plan 007).

export const LOOKING_UP = "Looking up this channel…";
export const PRESS_ENTER = "Press Enter to look up this channel.";

/** A failed `lookupChannel`, in words. */
export function lookupErrorText(error: unknown): string {
  const status = error instanceof ApiError ? error.status : null;
  if (status === 404 || status === 422) return "We couldn’t find a YouTube channel for that link.";
  if (status === 429) {
    return "You’ve looked up or checked several new videos and channels in the last hour. Please try again later, or pick a channel from our dataset.";
  }
  return "We couldn’t look up that link. Please try again in a moment.";
}
