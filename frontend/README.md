# HyperStim frontend

Next.js (App Router, static export) + Tailwind CSS. Deployed to GitHub Pages; talks to the backend only through `src/lib/api.ts`.

## Prerequisites

- [nvm](https://github.com/nvm-sh/nvm); the Node version is pinned in `.nvmrc`. `./dev.sh --install-tools` at the repo root installs both.

## Setup

```sh
cd frontend
nvm install        # or `nvm use`
npm ci
cp .env.example .env.local
```

## Environment variables

See `.env.example`. All are read at build time.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_BASE_PATH` | Path prefix the site is served under (`/<repo-name>` on GitHub Pages). Empty locally. |
| `NEXT_PUBLIC_API_BASE` | Backend base URL, no trailing slash. Locally `http://localhost:8000`: start the backend first ([`../backend/README.md`](../backend/README.md)); its `CORS_ORIGIN` must be this site's origin (`http://localhost:3000`). |
| `NEXT_PUBLIC_GA_ID` | Google Analytics measurement ID (`G-…`). Empty: no consent banner, no "Cookie settings" button and no analytics code. Set only for production. |
| `NEXT_PUBLIC_SITE_ORIGIN` | The site's origin (`https://<domain>`), no path or trailing slash. Used for the sitemap and canonical URLs. Empty: `http://localhost:3000`. |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | Google Search Console verification token (plan 011). Empty: no verification tag. Set only for production. |
| `NEXT_PUBLIC_API_MOCK` | `1` = use the mock data in `src/lib/mock.ts` instead of the backend. |
| `BLOG_CONTENT_DIR`, `BLOG_MEDIA_DIR` | Where the blog's posts and their media are read from (default `content/blog` and `public/blog-media`). Only the E2E build sets them, to the test posts in `src/lib/blog/fixtures/`. |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at http://localhost:3000 |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Vitest unit tests |
| `npm run test:coverage` | Tests with coverage, report in `coverage/` (CI runs this) |
| `npm run test:e2e` | End-to-end tests (Playwright): builds the site and runs it against the real backend (see **Testing**) |
| `npm run build` | Static export to `out/` |
| `npm run images` | Convert art to WebP (runs automatically before `dev` and `build`) |

## Testing

What to test and at which level: [AGENTS.md](../AGENTS.md) (**Tests**) and [plan 012](../plans/012-code-quality.md).

- **Unit and component tests** (`npm test`): Vitest + Testing Library, next to the code (`*.test.ts(x)`). Each component test file includes an axe accessibility check (`expectNoAxeViolations` from `src/test/axe.ts`).
- **End-to-end tests** (`npm run test:e2e`): Playwright, in `e2e/`. Needs the backend set up (`uv sync` in `../backend`) and the browsers, which `./dev.sh --install-tools` installs; by hand:
  ```sh
  npx playwright install --with-deps chromium webkit
  ```
  It builds the site, starts the backend (port 8100, the reference set in `../backend/data/`) and serves `out/` (port 3100), then runs every test in Chromium and WebKit, each at 1280 px and 360 px (projects `chromium-desktop`, `webkit-desktop`, `chromium-phone`, `webkit-phone`). Requests to other hosts fail the test; YouTube embeds and Google's tag get empty answers. `--project=webkit-phone` runs one of them; `--ui` opens Playwright's test runner. A failed run leaves a trace in `test-results/` (`npx playwright show-trace <file>`).
- **Flaky tests** ([plan 012](../plans/012-code-quality.md), Flaky tests): a test that fails only sometimes is fixed, not retried. CI's machines are slower than a laptop, so reproduce it under load, with no retries:
  ```sh
  npx playwright test e2e/channel.spec.ts -g "centred" --project=webkit-desktop --repeat-each 40 --workers 4 --retries 0
  ```
  More workers make more load; from about 8, WebKit starts timing out on its own. A fix is done when that run passes in full. After anything that moves (a scroll, an animation), check positions with `expect.poll(…)` rather than one reading.
- **Safari check** (`npm test` in `e2e/safari/`, [plan 017](../plans/017-browser-support.md)): a few end-to-end checks in WebKit 26, the engine of the newest shipping Safari. The main suite's WebKit is newer than any Safari, so it misses Safari bugs such as overlays a table row can't hold. Every button, link and field on each page must get the tap aimed at it, and the compare page's info popups must open next to their buttons. It has its own Playwright version (pinned in `e2e/safari/package.json`) and keeps its WebKit in `~/.cache/ms-playwright-safari`; it starts the same servers as the main suite. `./dev.sh --install-tools` sets it up; by hand:
  ```sh
  cd e2e/safari
  npm ci
  npm run install-browser            # add `-- --with-deps` for the system libraries
  npm test
  ```
  CI runs it after the main suite. When a new Safari version ships, move the pin up to a Playwright whose WebKit matches a Safari still in wide use.

## Images

Originals from the team live in `art/` (including unused ones). Only images listed in `art/used.json` are converted to WebP into `public/images/` (git-ignored), at 2× the given display width (`{ "width": …, "trim": true }` cuts off transparent margins first). To use a new image, add a line to `used.json` and reference it as `asset("/images/<name>.webp")`.

The link-preview image, `public/og-image.png` (1200 × 630, opaque PNG), is committed: `art/Logo.png` centred above `art/kid_1.png` on white, both scaled to fit with margins so a square crop still shows the kid. Recompose it if either changes; its size and alt text are in `src/lib/site.ts` (plan 011).

## Blog

Posts are markdown files in `content/blog/`, rendered at build time with `react-markdown`, `remark-gfm`, `remark-directive` and `gray-matter` (plan 018). How to write and publish one: [`content/blog/README.md`](content/blog/README.md).

## Styles

How the site looks (rules, and the classes for each card, control and popover) is in [`design/STYLE.md`](design/STYLE.md). Colour and font values are Tailwind tokens in `src/app/globals.css`.
