// Mock API responses for frontend work without a backend (NEXT_PUBLIC_API_MOCK=1).
// All titles and channel names are made up. Video pages: mockVid0500 returns a server error;
// any other ID that isn't a mock video is analyzed live in ~12 s, then has a result. Live
// analysis: mockVidWait waits in the queue first; the IDs in MOCK_FAILURES fail with their
// error; mockVidBusy gets 503 (queue full) and mockVid0429 gets 429 (limit reached). Channel
// pages: every mock channel has generated videos (Zippy Zoom Kids: 60 over many years; Little
// Paws Play: one year; Quiet Meadow Tales: one video; Puddle Lane: counts of 0 and missing
// values); MOCK_CHANNEL_ERROR returns a server error; any other channel ID is not found.
// Rankings: every mock channel's videos (~1,100, with generated channels and an accented
// name), ranked like the backend; the search "mock error" returns a server error.
import {
  ApiError,
  type Analysis,
  type AnalysisErrorCode,
  type AnalysisStatus,
  type ChannelDetail,
  type ChannelLookup,
  type ChannelSummary,
  type ChannelVideo,
  type Feature,
  type ListResponse,
  type Meta,
  type Order,
  type RankedChannel,
  type RankedVideo,
  type Method,
  type Params,
  type VideoDetail,
  type VideoSummary,
} from "./api";
import { CATEGORIES } from "./categories";
import { FEATURE_INFO } from "./features";

const round1 = (x: number) => Math.round(x * 10) / 10;

const videos: VideoSummary[] = [
  { id: "mockVid0001", title: "Super Turbo Rainbow Race – 40 Minutes of Non-Stop Surprise Eggs and Racing Cars Compilation", channelId: "UCmockZippyZoomKids00000", channel: "Zippy Zoom Kids", score: 97.4 },
  { id: "mockVid0002", title: "Crazy Color Blast Dance Party!!", channelId: "UCmockBouncyBeatsTv00000", channel: "Bouncy Beats TV", score: 95.1 },
  { id: "mockVid0003", title: "Mega Monster Truck Jump Challenge", channelId: "UCmockZippyZoomKids00000", channel: "Zippy Zoom Kids", score: 93.8 },
  { id: "mockVid0004", title: "Wiggle Pop Numbers Song", channelId: "UCmockBouncyBeatsTv00000", channel: "Bouncy Beats TV", score: 91.2 },
  { id: "mockVid0005", title: "Fizzy the Robot Saves the Candy Factory", channelId: "UCmockSparklePopStudio00", channel: "Sparkle Pop Studio", score: 88.6 },
  { id: "mockVid0006", title: "Animal Sounds Speed Round", channelId: "UCmockLittlePawsPlay0000", channel: "Little Paws Play", score: 71.3 },
  { id: "mockVid0007", title: "Counting Clouds with Mr. Moss", channelId: "UCmockPuddleLane00000000", channel: "Puddle Lane", score: 42.9 },
  { id: "mockVid0008", title: "Building a Treehouse Step by Step", channelId: "UCmockMapleCorner0000000", channel: "Maple Corner", score: 33.5 },
  { id: "mockVid0009", title: "Bedtime Story: The Sleepy Lighthouse", channelId: "UCmockQuietMeadowTales00", channel: "Quiet Meadow Tales", score: 12.4 },
  { id: "mockVid0010", title: "Watching Snails in the Garden", channelId: "UCmockPuddleLane00000000", channel: "Puddle Lane", score: 6.8 },
];

const channels: ChannelSummary[] = [
  { id: "UCmockZippyZoomKids00000", name: "Zippy Zoom Kids", score: 89.7, videoCount: 60 },
  { id: "UCmockBouncyBeatsTv00000", name: "Bouncy Beats TV", score: 86.2, videoCount: 60 },
  { id: "UCmockSparklePopStudio00", name: "Sparkle Pop Studio", score: 79.4, videoCount: 23 },
  { id: "UCmockLittlePawsPlay0000", name: "Little Paws Play", score: 64.0, videoCount: 9 },
  { id: "UCmockMapleCorner0000000", name: "Maple Corner", score: 38.1, videoCount: 17 },
  { id: "UCmockPuddleLane00000000", name: "Puddle Lane", score: 24.6, videoCount: 14 },
  { id: "UCmockQuietMeadowTales00", name: "Quiet Meadow Tales", score: 15.3, videoCount: 1 },
  { id: "UCmockTumbleTown00000000", name: "Tumble Town", score: 58.2, videoCount: 14 },
  { id: "UCmockStarrySongClub0000", name: "Starry Song Club", score: 47.5, videoCount: 26 },
  { id: "UCmockPebblePine00000000", name: "Pebble & Pine", score: 19.8, videoCount: 11 },
  { id: "UCmockCafeCrayon00000000", name: "Café Crayón Kids", score: 52.7, videoCount: 12 },
];

// Generated channels, so the rankings have many pages. IDs "UCmockG01…": their videos are "mockG010000"….
const NAME_WORDS = [
  ["Happy", "Bright", "Little", "Sunny", "Wonder", "Jolly", "Merry", "Cozy", "Lucky", "Zany"],
  ["Tots", "Sprouts", "Pals", "Beats", "Tales", "Builders", "Explorers", "Giggles", "Rockets", "Gardens"],
  ["TV", "Club", "World", "Land", "Studio"],
];
for (let n = 1; n <= 30; n++) {
  const rand = random(`channel${n}`);
  const pick = (words: string[]) => words[Math.floor(rand() * words.length)];
  channels.push({
    id: `UCmockG${String(n).padStart(2, "0")}${"0".repeat(15)}`,
    name: `${pick(NAME_WORDS[0])} ${pick(NAME_WORDS[1])} ${pick(NAME_WORDS[2])}`,
    score: round1(5 + rand() * 90),
    videoCount: 3 + Math.floor(rand() * 58),
  });
}

/** Each mock channel's main category; generated channels take turns. */
function mainCategory(channelId: string, index: number): string {
  const fixed: Record<string, string> = {
    UCmockZippyZoomKids00000: "gaming",
    UCmockBouncyBeatsTv00000: "music",
    UCmockQuietMeadowTales00: "narrative",
    UCmockPuddleLane00000000: "educational",
  };
  return fixed[channelId] ?? CATEGORIES[index % CATEGORIES.length].key;
}

/** A video's category: mostly its channel's main one. */
function categoryOf(videoId: string, channelId: string): string {
  const rand = random(`${videoId}:category`);
  const main = mainCategory(channelId, channels.findIndex((c) => c.id === channelId));
  return rand() < 0.75 ? main : CATEGORIES[Math.floor(rand() * CATEGORIES.length)].key;
}

/** Mock raw value per feature at a given percentile (rough dataset ranges). */
const FEATURE_SCALE: Record<string, (p: number) => number> = {
  cuts_per_min: (p) => p * 0.4,
  inter_cut_dssim_mean: (p) => 0.2 + p * 0.004,
  palette_change_per_min: (p) => p * 0.3,
  lstar_flash_per_min: (p) => p * 0.05,
  motion_frac: (p) => p * 0.008,
  loudness_jumps_per_min: (p) => p * 0.02,
  mean_saturation: (p) => 0.2 + p * 0.005,
  mean_lstar: (p) => 40 + p * 0.4,
  lufs: (p) => -30 + p * 0.25,
  high_lufs_frac: (p) => 0.5 + p * 0.005,
  build_resolve_per_min: (p) => p * 0.01,
  loudness_jump_at_cut_per_min: (p) => p * 0.02,
};

// Spread around the video's score so the measurements differ from each other.
const OFFSETS = [6, -9, 3, -2, -14, -7, 1, -25, 4, -18, -10, -5];

function mockFeatures(score: number, overrides: Record<string, number | null> = {}): Feature[] {
  return Object.entries(FEATURE_SCALE).map(([key, scale], i) => {
    if (key in overrides) {
      const value = overrides[key];
      // A count of 0 shows as percentile 0, as the backend sends it.
      return { key, value, percentile: value === null ? null : value === 0 ? 0 : 50 };
    }
    const percentile = round1(Math.min(100, Math.max(0, score + OFFSETS[i])));
    return { key, value: Math.round(scale(percentile) * 1000) / 1000, percentile };
  });
}

const NO_EVENTS = { lstar_flash_per_min: 0, build_resolve_per_min: 0, loudness_jump_at_cut_per_min: 0 };

const featureOverrides: Record<string, Record<string, number | null>> = {
  // Counts of 0: shown as 0.
  mockVid0009: NO_EVENTS,
  // Missing values: no cuts at all, and no sound (no loudness, so no loudness jumps either).
  mockVid0010: { ...NO_EVENTS, cuts_per_min: 0, inter_cut_dssim_mean: null, lufs: null, loudness_jumps_per_min: 0 },
};

function videoDetail(id: string): VideoDetail {
  if (id === "mockVid0500") throw new ApiError(500, "Mock server error");
  const video = videos.find((v) => v.id === id);
  if (video) return { ...video, channelInDataset: true, features: mockFeatures(video.score, featureOverrides[id]) };
  for (const channel of channels) {
    const found = channelVideos(channel).find((v) => v.id === id);
    if (found) {
      const { id, title, score, features } = found;
      return { id, title, score, features, channelId: channel.id, channel: channel.name, channelInDataset: true };
    }
  }
  if (analyses.has(id) && mockAnalysis(id).status === "done") {
    const live = { id, title: LIVE_TITLE, channelId: "UCmockFreshFinds00000000", channel: "Fresh Finds", score: 64.2 };
    return { ...live, channelInDataset: false, features: mockFeatures(live.score) };
  }
  throw new ApiError(404, "Video not found");
}

const LIVE_TITLE = "Jelly Bean Jungle Adventure – Mock Video Checked Live";
// Seconds per step, shorter than the real ones (~6, 15 and 25 s) so the flow is quick to try.
const MOCK_STEPS: [AnalysisStatus, number][] = [
  ["lookup", 2],
  ["download", 4],
  ["measure", 6],
];
const MOCK_WAIT_S = 4; // mockVidWait's time in the queue
// IDs that fail after the look-up, one per error.
const MOCK_FAILURES: Record<string, AnalysisErrorCode> = {
  mockVidFail: "unavailable",
  mockNotKids: "not_for_kids",
  mockVidShrt: "too_short",
  mockVidLive: "live",
  mockVidErrr: "failed",
};
const analyses = new Map<string, number>(); // ID -> start time (ms)

function mockAnalysis(id: string): Analysis {
  const base = { queuePosition: null, remainingS: null, error: null };
  let elapsed = (Date.now() - (analyses.get(id) ?? Date.now())) / 1000;
  const wait = id === "mockVidWait" ? MOCK_WAIT_S : 0;
  if (elapsed < wait) {
    return { ...base, status: "queued", queuePosition: Math.ceil((wait - elapsed) / 2), progress: 0 };
  }
  elapsed -= wait;
  const error = MOCK_FAILURES[id];
  if (error && elapsed > MOCK_STEPS[0][1]) return { ...base, status: "failed", progress: 0, error };
  const total = MOCK_STEPS.reduce((sum, [, s]) => sum + s, 0);
  let before = 0;
  for (const [status, seconds] of MOCK_STEPS) {
    if (elapsed < before + seconds) {
      const within = elapsed - before;
      return {
        ...base,
        status,
        progress: (before + Math.min(within, seconds * 0.9)) / total,
        remainingS: Math.round(total - before - Math.min(within, seconds * 0.9)),
      };
    }
    before += seconds;
  }
  return { ...base, status: "done", progress: 1 };
}

function analysisRequest(method: Method, id: string): Analysis {
  const video = videos.find((v) => v.id === id);
  if (video) return { queuePosition: null, remainingS: null, error: null, status: "done", progress: 1 };
  if (method === "POST") {
    if (id === "mockVidBusy") throw new ApiError(503, "Busy");
    if (id === "mockVid0429") throw new ApiError(429, "Too many requests");
    const current = analyses.has(id) ? mockAnalysis(id) : null;
    if (!current || current.status === "failed") analyses.set(id, Date.now());
  } else if (!analyses.has(id)) {
    throw new ApiError(404, "Analysis not found");
  }
  return mockAnalysis(id);
}

export const MOCK_CHANNEL_ERROR = "UCmockServerError0000000";

/** Deterministic pseudo-random numbers in [0, 1), so mock channels look the same on every load. */
function random(seed: string): () => number {
  let a = [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761), 1);
  return () => {
    a = Math.imul(a + 0x6d2b79f5, 1); // wraps to a 32-bit integer, like `| 0`
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TITLE_WORDS = [
  ["Tiny", "Giant", "Sleepy", "Speedy", "Rainbow", "Bubbly", "Silly", "Brave", "Sparkly", "Wobbly"],
  ["Trucks", "Dinosaurs", "Kittens", "Robots", "Rockets", "Ducks", "Trains", "Monsters", "Bunnies", "Pirates"],
  ["Race to the Bridge", "Learn Colors", "Go Camping", "Bake a Cake", "Find the Treasure", "Sing Along", "Count to Ten", "Clean Up", "Build a Tower", "Say Goodnight"],
];

// Channels whose mock videos follow a special pattern (see the comment at the top).
const CHANNEL_SHAPES: Record<string, { years: [number, number]; zeroEvents?: boolean }> = {
  UCmockZippyZoomKids00000: { years: [2016, 2026] },
  UCmockLittlePawsPlay0000: { years: [2024, 2024] },
  UCmockPuddleLane00000000: { years: [2019, 2023], zeroEvents: true },
};
const PER_MINUTE_EVENTS = ["lstar_flash_per_min", "build_resolve_per_min", "loudness_jump_at_cut_per_min"];

const channelVideoCache = new Map<string, ChannelVideo[]>();

/** A mock channel's videos, oldest first: dates bunched in some years, scores drifting over time. */
function channelVideos(channel: ChannelSummary): ChannelVideo[] {
  const cached = channelVideoCache.get(channel.id);
  if (cached) return cached;
  const rand = random(channel.id);
  const shape = CHANNEL_SHAPES[channel.id] ?? { years: [2019, 2025] };
  const [first, last] = shape.years;
  const start = Date.UTC(first, 0, 1);
  const span = Date.UTC(last, 11, 31) - start;
  const ownVideos = videos.filter((v) => v.channelId === channel.id);
  const result: ChannelVideo[] = Array.from({ length: channel.videoCount }, (_, i) => {
    // Squaring bunches the dates towards the later, busier years.
    const t = Math.sqrt(rand());
    const publishedAt = new Date(start + t * span).toISOString().slice(0, 10);
    const own = ownVideos[i];
    const score = own?.score ?? round1(Math.min(100, Math.max(0, channel.score + (t - 0.5) * 30 + (rand() - 0.5) * 36)));
    const features = mockFeatures(score, own ? featureOverrides[own.id] : undefined).map((f) =>
      own || f.percentile === null
        ? f
        : { ...f, percentile: round1(Math.min(100, Math.max(0, f.percentile + (rand() - 0.5) * 30))) },
    );
    if (shape.zeroEvents && !own) {
      for (const f of features) {
        if (PER_MINUTE_EVENTS.includes(f.key) && rand() < 0.4) Object.assign(f, { value: 0, percentile: 0 });
      }
      if (i % 6 === 2) {
        // No sound: no loudness, so no loudness jumps either.
        Object.assign(features[8], { value: null, percentile: null });
        Object.assign(features[5], { value: 0, percentile: 0 });
      }
      if (i % 7 === 3) {
        // No cuts at all: 0 for Rapid cutting, no value for Scene discontinuity.
        Object.assign(features[0], { value: 0, percentile: 0 });
        Object.assign(features[1], { value: null, percentile: null });
      }
    }
    const title =
      own?.title ??
      TITLE_WORDS.map((words) => words[Math.floor(rand() * words.length)]).join(" ");
    const id = own?.id ?? `mock${channel.id.slice(6, 9)}${String(i).padStart(4, "0")}`;
    return { id, title, publishedAt, score, features };
  }).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
  channelVideoCache.set(channel.id, result);
  return result;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function channelDetail(id: string): ChannelDetail {
  if (id === MOCK_CHANNEL_ERROR) throw new ApiError(500, "Mock server error");
  const channel = channels.find((c) => c.id === id);
  if (!channel) throw new ApiError(404, "Channel not found");
  const list = channelVideos(channel);
  const features = list[0].features.map(({ key }, i) => {
    const measured = list.map((v) => v.features[i]).filter((f) => f.value !== null);
    const value = mean(measured.map((f) => f.value ?? 0));
    const percentile = mean(measured.map((f) => f.percentile ?? 0));
    return { key, value, percentile: percentile === null ? null : round1(percentile) };
  });
  return {
    id,
    name: channel.name,
    videoCount: list.length,
    score: round1(mean(list.map((v) => v.score)) ?? 0),
    features,
    videos: list,
  };
}

type Ranked = { id: string; score: number; features: Feature[] };

/** Every mock channel's videos, with their channel and category. */
function allVideos(): Omit<RankedVideo, "rank">[] {
  return channels.flatMap((channel) =>
    channelVideos(channel).map(({ id, title, score, features }) => ({
      id,
      title,
      channelId: channel.id,
      channel: channel.name,
      category: categoryOf(id, channel.id),
      score,
      features,
    })),
  );
}

/** Channels as the rankings list them: those with a video in `category` ("" = all). */
function allChannels(minVideos: number, category: string): Omit<RankedChannel, "rank">[] {
  return channels
    .filter((c) => c.videoCount >= minVideos)
    .map((c) => channelDetail(c.id))
    .filter((c) => !category || c.videos.some((v) => categoryOf(v.id, c.id) === category))
    .map(({ id, name, videoCount, score, features }) => ({ id, name, videoCount, score, features }));
}

/** The value a list is ranked by; null when the item has none. */
function rankValue(item: Ranked, sort: string): number | null {
  if (sort === "score") return item.score;
  return item.features.find((f) => f.key === sort)?.percentile ?? null;
}

/** Ranks by position; equal values share the first one's rank. */
function withRanks<T>(items: { item: T; value: number }[]): (T & { rank: number })[] {
  const out: (T & { rank: number })[] = [];
  items.forEach(({ item, value }, i) => {
    const tied = i > 0 && value === items[i - 1].value;
    out.push({ ...item, rank: tied ? out[i - 1].rank : i + 1 });
  });
  return out;
}

/** Lower case, accents removed, for search. */
const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Ranks like the backend: by `sort` within the category, most stimulating first, ties by ID (equal
 * values share a rank), items without a value last and unranked. Search keeps ranks; `asc` reverses the ranked items and
 * counts their ranks from the least stimulating end.
 */
function rankList<T extends Ranked>(
  items: T[],
  params: Params,
  names: (item: T) => string[],
  addedAt: (item: T) => string = () => MOCK_REFERENCE,
): ListResponse<T & { rank: number | null }> {
  const sort = String(params.sort ?? "score");
  const order = String(params.order ?? "desc") as Order;
  const q = fold(String(params.q ?? "").trim());
  if ((sort !== "score" && !Object.hasOwn(FEATURE_INFO, sort)) || (order !== "desc" && order !== "asc")) {
    throw new ApiError(422, "Bad parameters");
  }
  if (q === "mock error") throw new ApiError(500, "Mock server error");
  const valued = items
    .map((item) => ({ item, value: rankValue(item, sort) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) return a.value === null ? (b.value === null ? 0 : 1) : -1;
      return b.value - a.value || a.item.id.localeCompare(b.item.id);
    })
  const withValue = valued.filter((v): v is { item: T; value: number } => v.value !== null);
  const ranked = withRanks(withValue);
  const unranked = valued.filter((v) => v.value === null).map(({ item }) => ({ ...item, rank: null }));
  // Least stimulating first: reversed, ranks counted from that end (1 = the least stimulating).
  const calmFirst = withRanks([...withValue].reverse());
  const ordered = [...(order === "asc" ? calmFirst : ranked), ...unranked];
  // A name matches in part; an ID (from a pasted link) exactly, as in the backend.
  const id = String(params.q ?? "").trim();
  // `addedFrom`/`addedBefore` only hide rows, like the search.
  const from = String(params.addedFrom ?? "");
  const before = String(params.addedBefore ?? "");
  const matching = ordered.filter(
    (item) =>
      (!q || item.id === id || names(item).some((name) => fold(name).includes(q))) &&
      (!from || addedAt(item) >= from) &&
      (!before || addedAt(item) < before),
  );
  const offset = Number(params.offset ?? 0);
  const limit = Number(params.limit ?? 20);
  // The mock data never changes, so every list is from the same version.
  return { items: matching.slice(offset, offset + limit), total: matching.length, asOf: MOCK_VERSION };
}

const MOCK_VERSION = "2026-09-30T00:00:00Z";
const MOCK_REFERENCE = "2026-09-01T00:00:00Z";

/**
 * Channel links: `/channel/<mock ID>` and a mock video's link find their channel; `@zippy`
 * finds Zippy Zoom Kids; `@missing` isn't found; `@busy` is over the limit; any other handle
 * or video is a channel we don't have ("Faraway Friends").
 */
function channelLookup(url: string): ChannelLookup {
  const byId = url.match(/\/channel\/(UC[\w-]{22})/);
  const found = (channel: ChannelSummary) => ({
    channelId: channel.id,
    name: channel.name,
    inDataset: true,
    videoCount: channel.videoCount,
  });
  if (byId) {
    const channel = channels.find((c) => c.id === byId[1]);
    return channel ? found(channel) : { channelId: byId[1], name: null, inDataset: false, videoCount: 0 };
  }
  if (/@missing/i.test(url)) throw new ApiError(404, "Channel not found");
  if (/@busy/i.test(url)) throw new ApiError(429, "Too many requests");
  if (!/youtube\.com\/(@|c\/|user\/)/i.test(url)) throw new ApiError(422, "Not a YouTube channel link");
  if (/@zippy/i.test(url)) return found(channels[0]);
  return { channelId: "UCmockFarawayFriends0000", name: "Faraway Friends", inDataset: false, videoCount: 0 };
}

export async function mockRequest(method: Method, path: string, params: Params): Promise<unknown> {
  // Short delay so loading states are visible during development.
  await new Promise((resolve) => setTimeout(resolve, 400));
  const category = String(params.category ?? "");
  switch (path) {
    case "/api/meta":
      return {
        videoCount: allVideos().length,
        channelCount: channels.length,
        updatedAt: "2026-09-30",
        addedLast7Days: 3,
        channelCount7DaysAgo: channels.length - 1,
        lastAddedAt: MOCK_VERSION,
        referenceCount: allVideos().length - 3,
        channelsCheckedAt: "2026-09-29",
      } satisfies Meta;
    case "/api/videos":
      return rankList(
        allVideos().filter((v) => !category || v.category === category),
        params,
        (v) => [v.title, v.channel],
        // The 3 added videos (see meta) are the list's last 3.
        (v) => (allVideos().slice(-3).some((added) => added.id === v.id) ? MOCK_VERSION : MOCK_REFERENCE),
      );
    case "/api/channels":
      return rankList(allChannels(Number(params.minVideos ?? 1), category), params, (c) => [c.name]);
    case "/api/channel-lookup":
      return channelLookup(String(params.url ?? ""));
    default:
      if (path.startsWith("/api/videos/")) {
        return videoDetail(decodeURIComponent(path.slice("/api/videos/".length)));
      }
      if (path.startsWith("/api/channels/")) {
        return channelDetail(decodeURIComponent(path.slice("/api/channels/".length)));
      }
      if (path.startsWith("/api/analyses/")) {
        return analysisRequest(method, decodeURIComponent(path.slice("/api/analyses/".length)));
      }
      throw new Error(`No mock for ${path}`);
  }
}
