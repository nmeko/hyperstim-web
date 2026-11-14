# 001 — Overall architecture

**Area:** Site-wide: architecture, hosting, API conventions, privacy, and rules that apply to every page.

## Goal

Replace the old static site (vanilla HTML/JS, dataset baked into a ~10 MB JS file, separate live-analysis API) with a maintainable Next.js frontend and a single backend that serves both the dataset and live analysis.

## Repo layout

```
frontend/   Next.js app (static export → GitHub Pages)
backend/    FastAPI app (runs on our server)
plans/      numbered plans
.github/workflows/   CI (plan 012) + Pages deploy
README.md, DEVELOPMENT.md   repo front page, developer guide (below)
ARCHITECTURE.md             diagrams of dev, CI, prod and outside services (below)
```

### README and developer guide _(human decision, 2026-10-24: the README read like a developer guide)_

- **`README.md` is for anyone who lands on the repo** (parents, researchers, developers): what the site is, not how to work on it.
  1. `# HyperStim?`, the site's name _(human decision, 2026-10-24)_, the SonarQube Cloud badges (quality gate, coverage, reliability rating; each links to the project's new-code summary) and the Deploy workflow's status badge _(human decision, 2026-10-24)_, and a one-line pitch: how stimulating are kids' YouTube videos?
  2. **What it is:** one paragraph: a platform that helps parents understand how stimulating children's videos are by analyzing audiovisual features (rapid scene changes, bright colors, loud sounds), so they can explore and compare videos and make more informed decisions about what their children watch. The name links to the live site _(human decision, 2026-10-24: better framing)_.
  3. **What you can do:** check any video by its link; rankings of videos and channels; compare two videos or channels; how it works. One line each, linking to the site's pages.
  4. **A growing dataset** _(2026-10-29, plan 013; human decision, 2026-10-29: after What you can do)_: one line, then the growth chart (light and dark through `<picture>`), redrawn daily by the data bot, so its numbers never go stale.
  5. **What the score is and isn't:** production style only, measured from a 5-minute clip; it doesn't judge content, educational value or age appropriateness. Same copy limits as the site (plan 006): no claims about effects on children.
  6. **How it's built:** 2–3 lines (static Next.js site on GitHub Pages; Python/FastAPI API with the video dataset and the analysis pipeline), linking to `DEVELOPMENT.md`.
  7. **Privacy** (link to the policy) and **License** (Apache 2.0, link to `LICENSE`).
- **No numbers that go stale** (video count, dates) and **no link to the research** _(human decision, 2026-10-24)_.
- **`DEVELOPMENT.md` is the developer entry point:** the old README's content, moved unchanged (repo map, "Run locally" from plan 003, "Release" from plan 010). It links to the `frontend/`, `backend/` and `deploy/` READMEs.
- **`ARCHITECTURE.md` maps the system in Mermaid diagrams** _(human decision, 2026-10-27: diagrams rather than prose, so new team members see how dev, CI, prod and the outside services connect; rendered by GitHub and by VS Code with a Mermaid extension)_: the big picture, dev environment, tests and CI, a release, the prod server, the growing dataset, a visitor's request. Each change to these areas updates its diagram; details stay in the plans and READMEs. Linked from `DEVELOPMENT.md`.
- **Plan 010's pending switch to semantic-version tags** also changes the "Release" section: whichever change lands second updates it in `DEVELOPMENT.md` _(human decision, 2026-10-24)_.

### Agent instructions _(human decision, 2026-11-12; built 2026-11-12)_

Goal: a new team member's coding agent (Claude Code, Codex, Cursor, Copilot, …) follows the same rules.

- **`AGENTS.md` holds the project rules** _(human decision, 2026-11-12)_: `CLAUDE.md` is moved there (`git mv`, so its history follows), and `CLAUDE.md` keeps one line, `@AGENTS.md`, so Claude Code reads the same file. `.gemini/settings.json` sets `"contextFileName": "AGENTS.md"` for Gemini CLI.
- **The current docs point to `AGENTS.md`** _(human decision, 2026-11-12)_: `DEVELOPMENT.md`, `dev.sh`, `frontend/README.md`, `backend/README.md`, `scripts/release-notes.sh`, `.githooks/commit-msg`'s comment, and `docs` in the commit types. Older plans keep `CLAUDE.md`: they are the record.
- **Written for Claude Code first** _(human decision, 2026-11-12: most work uses Claude Code; clarity isn't traded for compatibility)_. Where a rule depends on a Claude Code feature, a short aside covers other agents without naming them, e.g. "an artifact page (or your agent's equivalent, such as a local HTML page)" _(human decision, 2026-11-12)_. Today that's only the review screenshots rule. 001's "Claude Code asks for each one" (Visual style, Illustrations) becomes "the agent asks".
- **Rules moved from one agent's private memory into the repo** _(human decision, 2026-11-12)_, so every agent and team member has them:
  - `AGENTS.md`, Engineering: **Paid YouTube API results are never fetched twice.** When paging through Data API searches by hand (a search costs 100 units of the 10,000 a day the collector shares), save each page's results and `nextPageToken` and continue from them; check the day's use first (the collector's `units` table plus your own).
  - `AGENTS.md`, next to the `STYLE.md` rules: **Hint text needs a yes.** Don't add hint or help text to a UI interaction (e.g. "Hold and slide to…") without asking; propose the wording and placement, and build without it until approved.
  - `AGENTS.md`, commit types: **handling a failure is `fix`.** New text or UI that explains or handles a failure of an existing feature (e.g. a note for a missing thumbnail) is `fix`, not `feat`.
  - `experiments/README.md` (on `exp/main`): **Long jobs run detached**, as a `systemd-run --user` unit, not as an agent session's background task (one died with its session's out-of-memory kill and nothing ran for 8 h). Before starting one, ask the team how much memory it may use: it depends on what else runs then (off-peak it may use most of it, at peak it could bring the server down). Measure each step's peak memory before running workers in parallel, and write a progress file the next session can read.
  - Plan 013: the decision **not to build more block tracking** (2026-11-01): the collector's `attempts` table is the record, analyzed later once more blocks have happened.
- **Kept out of the repo:** where the research repo is (and the design inspiration, which the repo never names) is given to team members directly.

Steps (all built 2026-11-12):

1. `git mv CLAUDE.md AGENTS.md`; new `CLAUDE.md` with `@AGENTS.md`; `.gemini/settings.json`.
2. Update the references listed above, the screenshots aside, and 001's Illustrations line.
3. Add the moved rules (`AGENTS.md`, plan 013); the experiments README rule on `exp/main`.
4. Commit on `001-architecture` (`docs:`); the `exp/main` change separately there.

## Frontend

- Next.js App Router, TypeScript, Tailwind, `output: "export"`. Deployed by a GitHub Actions workflow when a release tag is pushed, so `main` is the latest dev version and the live site can be behind it (plan 010) _(human decision, 2026-10-17)_.
- Backend URL injected at build time via `NEXT_PUBLIC_API_BASE` (GitHub Actions variable), not hard-coded.
- Served as a GitHub Pages project page, so the app uses `basePath` = `/<repo-name>` (set from env so it can change).
- Pages:
  - `/` Home: one-line pitch, one input that accepts a YouTube link or a video ID (no file upload), a few highlighted videos, links into the rest of the site.
  - `/rankings` Sortable, filterable, paginated table of all videos (score, category breakdown, topic, era, etc.). Each row links to its detail page.
  - `/video?id=<youtube-id>` Per-video detail: embedded YouTube player, score, category breakdown, metadata, "compare with…". Query param rather than `/video/[id]` because a static export can't pre-render pages for videos analyzed live.
  - `/compare` Two videos side by side with per-category breakdown; state in the URL query (`?a=…&b=…`) so links are shareable.
  - `/how-it-works` Method explained for a general audience (features → categories → score).
  - `/about` Who makes the site (the AI Smith Lab at UC San Diego), why, and how to get in touch (plan 015) _(human decision, 2026-10-26: built; no paper)_.
  - `/faq` Accordion of common questions.
  - `/privacy` Privacy policy (plan 009): what we store, why, and for how long; GitHub Pages, YouTube and Google Analytics; no cookies from us unless the visitor accepts analytics _(2026-10-17, plan 009)_. Embeds use `youtube-nocookie.com`. **The policy must stay true:** every change is checked against it; a change to what the site or backend stores, logs, or loads from third parties that the policy would have to reflect is agreed with the team before it's built, and then updates the policy in the same change _(human decision, 2026-10-16, plan 009; agreed first: 2026-10-17)_.
- Shared layout on every page (in the root layout):
  - Header: site name/logo (links home) and nav (Home, Rankings, Compare, How it works, Blog _(plan 018, 2026-11-09)_, About _(plan 015, 2026-10-26)_), with the current page marked.
  - Cookie banner for Google Analytics (Accept / Reject of equal weight) and a "Cookie settings" button in the footer _(human decision, 2026-10-17, plan 009: GA added; the rules require a banner only with analytics)_. Nothing from Google loads before Accept. YouTube players load only after "Play video" is clicked (plan 004).
  - Site icon (browser tab, bookmarks, home screen): the logo's "H" _(human decision, 2026-10-17: without one, browsers showed the default icon of the domain the site is served from)_. Next.js metadata files `src/app/icon.png` and `apple-icon.png`, so every page declares it under the site's base path; how it's made is in `STYLE.md`.
  - Footer: only what the header doesn't have _(plan 015, 2026-10-26)_: "© {year} HyperStim?" on the left _(human decision, 2026-10-26: no lab or school named there)_; on the right Privacy policy, Cookie settings (only when there is a choice to make, plan 009), GitHub ↗ (the repo, new tab) _(human decision, 2026-10-26)_. No FAQ (the questions are on How it works, in the header), no About (in the header), no contact email (the form is on the About page).
- Data fetched client-side from the backend with small typed hooks; static text pages need no backend.
- Responsive (RWD), mobile-first with Tailwind's default breakpoints; supported from 320 px phones up to wide desktop monitors:
  - Content in a max-width container on large screens so lines and tables don't stretch.
  - Nav collapses into a menu button on small screens.
  - Rankings: table on `md`+, stacked cards on phones.
  - Compare and detail pages: side-by-side on `lg`+, stacked on smaller screens.
  - Touch targets ≥ 44 px; no hover-only interactions; YouTube embeds and charts scale with width.
  - Check each page at 360, 768, 1280, and 1920 px wide before merging.
- Home input flow: parse link/ID → if the video is in the dataset, go to its detail page; otherwise start live analysis, show progress, then land on the detail page.
- Carry over the useful old-site behaviours (shareable compare links, accessible chart fallbacks), re-implemented rather than copied.

## Visual style

Guided by `frontend/design/Design Mockup.png`. It sets the look only: its text, names, and layouts are not ours to copy.

- Look: warm and friendly, with hand-drawn crayon/watercolor illustrations, lots of whitespace, cards with large rounded corners, pastel section backgrounds, pill-shaped filter chips, and a yellow marker highlight behind key words in headings.
- Fonts (Google Fonts via `next/font`, self-hosted at build):
  - Headings, logo: a rounded handwritten font, e.g. **Patrick Hand**.
  - Body, UI, tables: a rounded sans-serif, e.g. **Nunito**.
- Palette (Tailwind theme tokens; tune for contrast during the build):

  | Role | Hex |
  |---|---|
  | Page background (white) | `#FFFFFF` |
  | Heading / nav ink (navy) | `#0F2E8A` |
  | Body text (slate) | `#4A5262` |
  | Primary button | `#0F4A9C` |
  | Marker highlight / sunny accent | `#F8E683` / `#F8D040` |
  | Stimulation scale low → high | `#F8D040` → `#F8A048` → `#F85858` |
  | Compare: video A / video B | `#FDA28C` / `#9FBBF5` |
  | Pastel panels: butter / mint / sky | `#FEF8D4` / `#E5F6E6` / `#EEF6FA` |
  | Accents: leaf green / sky blue / heart coral | `#448D62` / `#32ADF7` / `#FD7371` |

- Light theme only (no dark mode for now). Colours are never the only way information is shown (scores also carry numbers/labels).
- Illustrations live in `frontend/public/images/`. The agent asks for each one (object, pose, colours, size, background) and the team supplies it; no placeholder art is committed.
- **The kid** _(human decision, 2026-10-16)_:
  - **Hidden below `md` (768 px) on every page**: the hero kids, the kid on the score panel, and `kid_2` above the message box. Layouts drop the room they kept for it there.
  - **The hero kids (home, rankings, compare, how it works, blog, privacy, about) have the same head size** at every width they show at: each kid's face is as wide as the home kid's (`kid_1`), compared side by side at the same breakpoint _(human decision, 2026-11-10: sized by eye distance (`kid_1`'s turned face puts its eyes close together), their heads were 10–20 % larger than the home kid's; then fine-tuned by eye against it)_.

    | Art (page) | `md` | `lg` | `xl`+ |
    |---|---|---|---|
    | `kid_1` (home) | 344 px | 392 px | 464 px |
    | `kid_blocks_2` (rankings) | 216 px | 248 px | 288 px |
    | `kid_compare` (compare) | 232 px | 264 px | 312 px |
    | `kid_wonder` (how it works) | 244 px | 276 px | 324 px |
    | `kid_quiet` (privacy) | 208 px | 232 px | 272 px |
    | `kid_wave` (about) | 184 px | 208 px | 244 px |
    | `kid_notebook` (blog) | 202 px | 230 px | 272 px |

  - The score-panel kids (video, channel) keep their own size (about 75 % of the home kid's head, plan 004). New art gets its widths by comparing its face with `kid_1`'s.
  - `STYLE.md` gets this in the same change (the **Hand-drawn art** rule, the recurring-character line, and each page's entry); the pages' plans (002, 004–008) say what it means for each.

## Backend

- FastAPI + uvicorn, run as a systemd service behind the existing nginx (TLS). Deployment files live only on the server. Prod runs from its own clone at the release tag, separate from the dev checkout (plan 010) _(human decision, 2026-10-17)_.
- Config via env (`.env` on server, `.env.example` in repo): dataset path, pipeline path, allowed CORS origin, rate limits.
- Endpoints (v1):
  - `GET /api/videos` — list with search, filters, sort, pagination (powers rankings + search).
  - `GET /api/videos/{id}` — one video with full breakdown.
  - `GET /api/meta` — filter options, dataset size, last-updated date.
  - `POST /api/analyze` (YouTube link or video ID only), `GET /api/analyze/{job_id}` — live analysis (same contract as today's API, cleaned up).
  - `GET /api/health`.
  - `GET /api/thumbnails/{id}` — a known video's YouTube thumbnail, fetched by the backend and cached for 30 days _(human decision, 2026-10-17, plan 009)_ so visitors' browsers never contact YouTube before they press play _(human decision, 2026-10-16, plan 009)_.
- Data exposure: the API returns video IDs, public metadata, and scores/features only. Downloaded clips are never served, never committed, and are deleted once analysis finishes; playback on the site uses YouTube embeds.
- Data: dataset loaded into memory at startup from a file outside the repo (5k rows is small). Analysis results stored as plain JSON files, one per video, so they survive restarts _(human decision, plan 004: plain files are enough for this lightweight task)_. Analysis runs the existing pipeline via its configured path (not vendored into this repo).
- Tests: pytest for endpoints with a small synthetic fixture dataset.

## Migration

1. Scaffold both apps + CI (lint, typecheck, build, tests).
2. Backend data endpoints, then frontend pages against them.
3. Port live analysis into the new backend; run it on a new port alongside the current API.
4. Switch nginx + Pages over; retire the old API and site.

## Open questions

None.

## Resolved questions

1. Dataset is public via the API (IDs, metadata, scores); downloaded clips are never exposed.
2. GitHub Pages project page.
3. Yes — rankings rows link to a per-video detail page.
4. No file upload; YouTube links or video IDs only.
5. Privacy policy contact and log retention: moved to plan 009 (server logs kept 14 days) _(2026-10-16)_.
