import path from "node:path";
import type { PlaywrightTestConfig } from "@playwright/test";
import { API_PORT, GA_ID, prepareBackendDirs, SITE_PORT } from "./backend";

/** The blog's test posts, which the E2E build shows instead of content/blog/ (plan 018). */
const BLOG_FIXTURES = "src/lib/blog/fixtures";

/**
 * The two servers the end-to-end tests run against (plan 012): the real backend with the
 * committed reference set, and the built static site. Shared by the main suite's config and the
 * Safari check's (e2e/safari, plan 017); `frontend` is the frontend folder's absolute path.
 */
export function servers(frontend: string, ci: boolean): PlaywrightTestConfig["webServer"] {
  const dirs = prepareBackendDirs();
  return [
    {
      command: "uv run uvicorn --factory hyperstim_api.main:create_app --port " + API_PORT,
      cwd: path.join(frontend, "../backend"),
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !ci,
      timeout: 120_000,
      env: {
        DATASET_PATH: "data/videos.tsv",
        // Only the reference set, so the server's daily data commits don't move what tests see.
        COLLECTED_DIR: "",
        CORS_ORIGIN: `http://localhost:${SITE_PORT}`,
        ANALYSIS_DIR: dirs.analysis,
        THUMBNAIL_DIR: dirs.thumbnails,
        USAGE_DIR: "",
        ANALYSIS_LIMIT_PER_IP: "0",
        ANALYSIS_LIMIT_PER_DAY: "0",
        API_DOCS: "0",
        YOUTUBE_API_KEY: "",
        YTDLP_COOKIES: "",
      },
    },
    {
      // Builds the static export for this backend, with the blog's test posts and their media
      // (plan 018), then serves it like GitHub Pages (`trailingSlash` gives each page an index.html).
      command:
        `npm run build && node -e "require('fs').cpSync('${BLOG_FIXTURES}/media', 'out/blog-media', { recursive: true })"` +
        ` && uv run --project ../backend python -m http.server ${SITE_PORT} --directory out`,
      cwd: frontend,
      url: `http://localhost:${SITE_PORT}/`,
      reuseExistingServer: !ci,
      timeout: 300_000,
      // Set here so they win over a developer's .env.local.
      env: {
        NEXT_PUBLIC_API_BASE: `http://localhost:${API_PORT}`,
        NEXT_PUBLIC_API_MOCK: "",
        NEXT_PUBLIC_BASE_PATH: "",
        NEXT_PUBLIC_SITE_ORIGIN: "",
        NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: "",
        // A made-up ID, so the consent banner works as in prod; Google's tag itself never loads.
        NEXT_PUBLIC_GA_ID: GA_ID,
        BLOG_CONTENT_DIR: BLOG_FIXTURES,
        BLOG_MEDIA_DIR: `${BLOG_FIXTURES}/media`,
      },
    },
  ];
}
