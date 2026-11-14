// Renders a post's social video (plan 018, Social video) to an MP4, or opens it for review.
//
//   node scripts/social-video.mjs <folder> [--serve] [--clips DIR] [--out FILE]
//
// <folder> is the post's folder next to its markdown file, holding social-video.html and
// social-video.json (backend/scripts/social_video_data.py). The script downloads each video's
// verses to a temporary folder with the backend's yt-dlp, serves the folder and the clips on
// localhost, records the film frame by frame in Playwright's Chromium and has ffmpeg join the
// frames and each turn's sound into <folder>/<folder's name>.mp4. The clips are deleted afterwards.
// Neither the clips nor the MP4 are ever committed (AGENTS.md, Public repository).
//
//   --serve      open the film for review instead (prints its address; Ctrl-C stops it)
//   --clips DIR  use clips downloaded before: DIR/clips.json lists each side's file and the
//                second of its video it starts at, { "a": { "file": "a.mp4", "start": 14.5 }, … }
//   --out FILE   where to write the MP4
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const FPS = 30;
const HEIGHT = 720; // the clips' height: each video is drawn about 700 px wide
const MARGIN_S = 0.5; // downloaded around the verses
const FORMAT = `bestvideo[height<=${HEIGHT}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${HEIGHT}]`;
const backend = path.resolve(import.meta.dirname, "../../backend");
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".mp4": "video/mp4" };

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { serve: { type: "boolean" }, clips: { type: "string" }, out: { type: "string" } },
});
if (positionals.length !== 1) {
  console.error("usage: node scripts/social-video.mjs <folder> [--serve] [--clips DIR] [--out FILE]");
  process.exit(2);
}
const folder = path.resolve(positionals[0]);
const out = path.resolve(opts.out ?? path.join(folder, `${path.basename(folder)}.mp4`));
const data = JSON.parse(await readFile(path.join(folder, "social-video.json"), "utf8"));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"], ...options });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

/** Each side's verses as one stretch: from before the first to after the last. */
function stretches() {
  return Object.fromEntries(
    ["a", "b"].map((side) => {
      const parts = data.tabs.map((tab) => tab[side]);
      const start = Math.max(0, Math.min(...parts.map((p) => p.start)) - MARGIN_S);
      return [side, { id: data.videos[side].id, start, end: Math.max(...parts.map((p) => p.end)) + MARGIN_S }];
    }),
  );
}

/** Downloads the stretches, or takes them from --clips: { side: { path, start } }. */
async function sourceClips(tmp) {
  if (opts.clips) {
    const dir = path.resolve(opts.clips);
    const list = JSON.parse(await readFile(path.join(dir, "clips.json"), "utf8"));
    return Object.fromEntries(Object.entries(list).map(([side, c]) => [side, { path: path.join(dir, c.file), start: c.start }]));
  }
  const clips = {};
  for (const [side, s] of Object.entries(stretches())) {
    const file = path.join(tmp, `download-${side}.mp4`);
    console.log(`downloading ${s.id} ${s.start}-${s.end} s`);
    // --force-keyframes-at-cuts re-encodes the cut, so the clip starts exactly at `start`.
    await run(
      "uv",
      ["run", "python", "-m", "yt_dlp", "--no-warnings", "--no-playlist", "-f", FORMAT, "--download-sections", `*${s.start}-${s.end}`,
        "--force-keyframes-at-cuts", "--merge-output-format", "mp4", "--remote-components", "ejs:github", "--output", file,
        `https://www.youtube.com/watch?v=${s.id}`],
      { cwd: backend },
    );
    clips[side] = { path: file, start: s.start };
  }
  return clips;
}

/** Every frame a keyframe, so the film can seek to any frame at once. */
async function prepare(clips, tmp) {
  const list = {};
  for (const [side, c] of Object.entries(clips)) {
    const file = `${side}.mp4`;
    await run("ffmpeg", ["-y", "-v", "error", "-i", c.path, "-vf", `scale=-2:${HEIGHT}`, "-c:v", "libx264", "-preset", "veryfast",
      "-crf", "16", "-g", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", path.join(tmp, file)]);
    list[side] = { file, start: c.start };
  }
  await writeFile(path.join(tmp, "clips.json"), JSON.stringify(list));
}

/** Serves the folder, and the clips under /clips/, with byte ranges so videos can seek. */
function serve(tmp) {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const [dir, rel] = url.startsWith("/clips/") ? [tmp, url.slice(7)] : [folder, url.slice(1) || "social-video.html"];
    const file = path.join(dir, rel);
    try {
      if (!file.startsWith(dir + path.sep)) throw new Error("outside");
      const { size } = await stat(file);
      const type = TYPES[path.extname(file)] ?? "application/octet-stream";
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
      if (range) {
        const start = Number(range[1] || 0), end = range[2] ? Number(range[2]) : size - 1;
        res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1, "Accept-Ranges": "bytes" });
        createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
        createReadStream(file).pipe(res);
      }
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Each turn's sound, from its clip, at the turn's time in the film: silence and turns in a row. */
function audioFilter(turns, duration) {
  const format = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  const parts = [], labels = [];
  const silence = (seconds) => {
    if (seconds <= 0.001) return;
    const label = `s${parts.length}`;
    parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${seconds.toFixed(3)},${format}[${label}]`);
    labels.push(`[${label}]`);
  };
  let at = 0;
  turns.forEach((u, i) => {
    silence(u.t0 - at);
    parts.push(`[${u.side === "a" ? 1 : 2}:a]atrim=start=${u.from}:end=${u.from + u.len},asetpts=PTS-STARTPTS,${format},` +
      `afade=t=in:d=0.05,afade=t=out:st=${Math.max(0, u.len - 0.15)}:d=0.15[t${i}]`);
    labels.push(`[t${i}]`);
    at = u.t0 + u.len;
  });
  silence(duration - at);
  return `${parts.join(";")};${labels.join("")}concat=n=${labels.length}:v=0:a=1[sound]`;
}

async function render(url, tmp) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`${url}/social-video.html?render`);
    await page.waitForFunction(() => window.film || document.body.dataset.error);
    const film = await page.evaluate(() => (window.film ? { duration: window.film.duration, turns: window.film.turns } : null));
    if (!film) throw new Error(await page.evaluate(() => document.body.dataset.error));
    const frames = Math.round(film.duration * FPS);
    const ffmpeg = spawn("ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
      "-i", path.join(tmp, "a.mp4"), "-i", path.join(tmp, "b.mp4"), "-filter_complex", audioFilter(film.turns, film.duration),
      "-map", "0:v", "-map", "[sound]", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", String(film.duration), out],
    { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((resolve, reject) => ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))));
    for (let f = 0; f < frames; f++) {
      await page.evaluate((t) => window.film.frame(t), f / FPS);
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1920, height: 1080 } });
      if (!ffmpeg.stdin.write(png)) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
      if (f % (FPS * 5) === 0) console.log(`frame ${f} of ${frames}`);
    }
    ffmpeg.stdin.end();
    await done;
  } finally {
    await browser.close();
  }
}

const tmp = await mkdtemp(path.join(os.tmpdir(), "social-video-"));
const cleanup = () => rm(tmp, { recursive: true, force: true });
try {
  await prepare(await sourceClips(tmp), tmp);
  const server = await serve(tmp);
  const url = `http://127.0.0.1:${server.address().port}`;
  if (opts.serve) {
    console.log(`review the film at ${url}/social-video.html (Ctrl-C stops)`);
    process.on("SIGINT", () => cleanup().then(() => process.exit(0)));
  } else {
    await render(url, tmp);
    server.close();
    await cleanup();
    console.log(`wrote ${out}`);
  }
} catch (error) {
  await cleanup();
  console.error(`social-video: ${error.message}`);
  process.exit(1);
}
