// Converts the art listed in art/used.json to WebP in public/images/.
// Unlisted art stays in art/ and is never shipped.
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const artDir = path.join(root, "art");
const outDir = path.join(root, "public", "images");

const used = JSON.parse(await readFile(path.join(artDir, "used.json"), "utf8"));
await mkdir(outDir, { recursive: true });

async function mtime(file) {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

for (const [name, entry] of Object.entries(used)) {
  if (name.startsWith("_")) continue;
  // A number, or { width, trim } for art whose transparent margins are cut off first.
  const { width: displayWidth, trim = false } = typeof entry === "number" ? { width: entry } : entry;
  const src = path.join(artDir, `${name}.png`);
  const out = path.join(outDir, `${name}.webp`);
  // Skip up-to-date outputs so `npm run dev` starts fast.
  if ((await mtime(out)) > Math.max(await mtime(src), await mtime(path.join(artDir, "used.json")))) {
    continue;
  }
  let image = sharp(src);
  if (trim) image = sharp(await image.trim().toBuffer());
  const info = await image
    .resize({ width: displayWidth * 2, withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90 })
    .toFile(out);
  console.log(`images: ${name}.webp ${info.width}x${info.height} ${Math.round(info.size / 1024)} KB`);
}
