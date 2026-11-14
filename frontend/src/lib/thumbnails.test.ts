import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkThumbnail, useThumbnailGone } from "./thumbnails";

// The store lives for the page load, so each test uses its own video IDs.

function answer(status: number) {
  const fetch = vi.fn(async () => ({ status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("thumbnail checks", () => {
  it("marks a video gone when our backend answers 404, asking once", async () => {
    const fetch = answer(404);
    const { result } = renderHook(() => useThumbnailGone("gone0000001"));
    expect(result.current).toBe(false);

    act(() => {
      checkThumbnail("gone0000001");
      checkThumbnail("gone0000001");
    });
    await waitFor(() => expect(result.current).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/thumbnails/gone0000001?size=mq");
  });

  it("says nothing about the video when YouTube can't be reached (502)", async () => {
    const fetch = answer(502);
    const { result } = renderHook(() => useThumbnailGone("down0000001"));
    act(() => checkThumbnail("down0000001"));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current).toBe(false);
  });

  it("says nothing about the video when the network fails", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useThumbnailGone("offline0001"));
    act(() => checkThumbnail("offline0001"));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current).toBe(false);
  });

  it("knows nothing about no video", () => {
    const { result } = renderHook(() => useThumbnailGone(null));
    expect(result.current).toBe(false);
  });
});
