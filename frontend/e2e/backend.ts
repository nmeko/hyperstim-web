import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Ports of the two servers the E2E tests start (playwright.config.ts), away from the dev
// servers' 3000 and 8000 so both can run at once.
export const API_PORT = 8100;
export const SITE_PORT = 3100;
export const API = `http://localhost:${API_PORT}`;
/** Made-up Google Analytics ID the E2E build gets, so the consent banner shows. */
export const GA_ID = "G-E2ETEST000";

/** A live analysis that has already finished; the backend loads it at startup. */
export const ANALYZED = {
  id: "E2Etest0001",
  title: "E2E test video",
  channelId: "UCe2eTestChannel00000000",
  channel: "E2E test channel",
};

/**
 * Empty analysis and thumbnail folders for the backend, outside the repo, with one finished
 * analysis (CI can't download videos). Runs before the servers start, and again in each
 * worker, which writes the same files.
 */
export function prepareBackendDirs() {
  const root = path.join(os.tmpdir(), "hyperstim-e2e");
  const analysis = path.join(root, "analysis");
  const thumbnails = path.join(root, "thumbnails");
  fs.mkdirSync(analysis, { recursive: true });
  fs.mkdirSync(thumbnails, { recursive: true });
  const now = Date.now() / 1000;
  const record = {
    id: ANALYZED.id,
    status: "done",
    status_since: now,
    requested_at: now,
    title: ANALYZED.title,
    channel_id: ANALYZED.channelId,
    channel: ANALYZED.channel,
    // Raw feature values of a typical dataset video.
    features: {
      cuts_per_min: 22.62,
      inter_cut_dssim_mean: 0.753,
      palette_change_per_min: 20.984,
      lstar_flash_per_min: 1.6393,
      motion_frac: 0.208,
      loudness_jumps_per_min: 0.3278,
      mean_saturation: 136.5,
      mean_lstar: 33.54,
      lufs: -13.98,
      high_lufs_frac: 0.76813,
      build_resolve_per_min: 0.0,
      loudness_jump_at_cut_per_min: 0.0,
    },
    error: null,
  };
  fs.writeFileSync(path.join(analysis, `${ANALYZED.id}.json`), JSON.stringify(record));
  return { analysis, thumbnails };
}
