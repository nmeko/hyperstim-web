import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getAnalysis,
  getChannel,
  getChannels,
  getMeta,
  getVideo,
  getVideos,
  lookupChannel,
  startAnalysis,
  thumbnailUrl,
} from "./api";

const fetchMock = vi.fn();

function reply(status: number, body: unknown = {}) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

/** The URL and options of the only `fetch` call. */
function call(): [string, RequestInit] {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return fetchMock.mock.calls[0] as [string, RequestInit];
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("api client", () => {
  it("GETs JSON and returns the body", async () => {
    reply(200, { videoCount: 3 });
    await expect(getMeta()).resolves.toEqual({ videoCount: 3 });
    const [url, init] = call();
    expect(url).toBe("/api/meta");
    expect(init).toEqual({ method: "GET", headers: { Accept: "application/json" } });
  });

  it("drops unset and empty list parameters", async () => {
    reply(200, { total: 0, items: [] });
    await getVideos({ sort: "score", order: "desc", category: "", q: undefined, offset: 0, limit: 20 });
    expect(call()[0]).toBe("/api/videos?sort=score&order=desc&offset=0&limit=20");
  });

  it("asks for a list as of an earlier version", async () => {
    reply(200, { total: 0, items: [], asOf: "2026-10-26T10:00:00Z" });
    await getVideos({ sort: "score", order: "desc", limit: 20, asOf: "2026-10-26T10:00:00Z" });
    expect(call()[0]).toBe("/api/videos?sort=score&order=desc&limit=20&asOf=2026-10-26T10%3A00%3A00Z");
  });

  it("encodes the search text in the query", async () => {
    reply(200, { total: 0, items: [] });
    await getChannels({ sort: "score", order: "asc", q: "Zoë & co", limit: 10, minVideos: 5 });
    expect(call()[0]).toBe("/api/channels?sort=score&order=asc&q=Zo%C3%AB+%26+co&limit=10&minVideos=5");
  });

  it("encodes IDs in the path", async () => {
    reply(200);
    await getVideo("a/b?c");
    expect(call()[0]).toBe("/api/videos/a%2Fb%3Fc");
    fetchMock.mockReset();
    reply(200);
    await getChannel("UC x");
    expect(call()[0]).toBe("/api/channels/UC%20x");
  });

  it("POSTs to start an analysis, without a body", async () => {
    reply(200, { status: "queued" });
    await startAnalysis("abcdefghijk");
    const [url, init] = call();
    expect(url).toBe("/api/analyses/abcdefghijk");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("GETs an analysis and looks up a channel link", async () => {
    reply(200, { status: "done" });
    await getAnalysis("abcdefghijk");
    expect(call()[0]).toBe("/api/analyses/abcdefghijk");
    fetchMock.mockReset();
    reply(200);
    await lookupChannel("https://www.youtube.com/@kids");
    expect(call()[0]).toBe("/api/channel-lookup?url=https%3A%2F%2Fwww.youtube.com%2F%40kids");
  });

  it.each([404, 429, 503])("rejects with an ApiError carrying status %i", async (status) => {
    reply(status, { detail: "no" });
    const error = await getVideo("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, name: "ApiError", message: `GET /api/videos/x failed with ${status}` });
  });

  it("rejects when the network fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(getMeta()).rejects.toThrow("Failed to fetch");
  });

  it("builds thumbnail URLs", () => {
    expect(thumbnailUrl("a/b")).toBe("/api/thumbnails/a%2Fb?size=hq");
    expect(thumbnailUrl("abc", "mq")).toBe("/api/thumbnails/abc?size=mq");
  });

  it("uses the mock backend when NEXT_PUBLIC_API_MOCK is 1", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "1");
    const meta = await getMeta();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(meta).toHaveProperty("videoCount");
  });
});

describe("api base", () => {
  it("prefixes NEXT_PUBLIC_API_BASE", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE", "https://api.example.org");
    vi.resetModules();
    const api = await import("./api");
    reply(200);
    await api.getMeta();
    expect(call()[0]).toBe("https://api.example.org/api/meta");
    expect(api.thumbnailUrl("abc")).toBe("https://api.example.org/api/thumbnails/abc?size=hq");
  });
});
