import { describe, expect, it } from "vitest";
import { parseVideoInput, readSearchInput } from "./youtube";

const ID = "dQw4w9WgXcQ";

describe("parseVideoInput", () => {
  it.each([
    ID,
    `  ${ID}  `,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s&list=PL123`,
    `http://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc123`,
    `youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}`,
  ])("accepts %s", (input) => {
    expect(parseVideoInput(input)).toEqual({ ok: true, id: ID });
  });

  it.each(["", "   ", "\n"])("reports empty input %j", (input) => {
    expect(parseVideoInput(input)).toEqual({ ok: false, reason: "empty" });
  });

  it.each([
    "hello",
    "dQw4w9WgXc", // 10 chars
    "dQw4w9WgXcQQ", // 12 chars
    "dQw4w9WgX!Q",
    `https://vimeo.com/${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/@somechannel",
    `https://www.youtube.com/playlist?list=${ID}`,
    "https://youtu.be/",
    "not a url at all",
  ])("rejects %s", (input) => {
    expect(parseVideoInput(input)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("readSearchInput", () => {
  const CHANNEL = "UCbCmjCuTUZos6Inko4u57UQ";
  it.each([
    ["", { kind: "empty" }],
    ["   ", { kind: "empty" }],
    ["peppa pig", { kind: "name", videoId: null }],
    [ID, { kind: "name", videoId: ID }],
    [`https://youtu.be/${ID}`, { kind: "video", id: ID }],
    [`youtube.com/shorts/${ID}`, { kind: "video", id: ID }],
    [`https://www.youtube.com/channel/${CHANNEL}`, { kind: "channel", id: CHANNEL }],
    [`youtube.com/channel/${CHANNEL}/videos`, { kind: "channel", id: CHANNEL }],
    ["https://www.youtube.com/@CoComelon", { kind: "channelPage" }],
    ["m.youtube.com/@CoComelon/videos?si=x", { kind: "channelPage" }],
    ["https://www.youtube.com/c/Cocomelon", { kind: "channelPage" }],
    ["https://www.youtube.com/user/checkgate", { kind: "channelPage" }],
    ["https://www.youtube.com/channel/nope", { kind: "badLink" }],
    ["https://www.youtube.com/", { kind: "badLink" }],
    ["https://example.com/@CoComelon", { kind: "badLink" }],
  ])("reads %j", (input, expected) => {
    expect(readSearchInput(input)).toEqual(expected);
  });
});
