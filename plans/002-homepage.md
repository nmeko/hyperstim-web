# 002 — Homepage

**Area:** Home page (`/`) and its endpoints.

## Goal

Build the home page (`/`) following the look of the mockup's home panel: hero with illustration on top, "check a video" card bottom-left, and a top-ranked table bottom-right (replacing the mockup's highlights block). Build it first on mock data, then add the backend endpoints that feed it.

## Decisions

- **Scope.** This plan also covers what the home page needs to exist at all: frontend scaffold, root layout (header + footer), the typed API client, and the backend scaffold with the endpoints below. Cookie banner, other pages, live analysis, and the Pages deploy workflow are later plans.
- **Score shown.** "Stimulation score", 0–100 = the dataset's composite percentile (higher = more stimulating than other videos in the dataset). Shown as an integer plus a small bar.
- **"Top" means highest score.** The table is titled "Stimulation rankings", never "top-rated" or "best". _(was: “Most stimulating”, kept even though it also shows the least stimulating; briefly “Most and least stimulating”)_
- **High ranks are a warning, not a prize.** The table highlights the most stimulating videos/channels as the ones to watch out for. Nothing in it looks like an award: no gold/silver/bronze, trophies, stars, or crowns. Ranks 1–3 may later get a warning style (see table card below); this is shown by design only, with no extra text. The score meter's warmest colour (coral) is at the high end.
- **Both ends in one table.** The table shows the 3 most and the 3 least stimulating, separated by a quiet “Least stimulating” divider, so parents see the range. _(was: no calm view; only the most stimulating, calmer videos on `/rankings`)_
- **Table rows.**
  - Videos: rank, video title (channel name in small text below it), score. Row links to `/video?id=…`.
  - Channels: rank, channel name, score, plus "N videos" in small text below the name. Not linked for now (no channel page yet).
  - Ranks 1–3, a “Least stimulating” divider, then the 3 lowest-scoring, shown as −3, −2, −1 (−1 = least stimulating; screen readers: “3rd least stimulating”, …, “least stimulating”). _(was: their real ranks counting back from `total`, e.g. 10,410, 10,411, 10,412)_ When the dataset is too small for a gap, overlapping items are dropped and the gap row is left out; every row then shows its plain rank. Then a "See full rankings →" link to `/rankings`, carrying the current view (`/rankings?view=channels`) _(human decision, 2026-10-15, with plan 007)_. _(was: top 5 rows)_
- **Channel score** = mean stimulation score of the channel's videos in the dataset; every channel is ranked, however few videos it has _(human decision, 2026-10-28: the minimum kept small channels from being judged on a few videos; the collector now keeps adding videos to them, plan 013)_.
- **Art location** changes from 001: originals live in `frontend/art/`, and `public/images/` holds only generated WebP files (see **Images**).
- **Mock data** uses made-up video titles and channel names, so the public repo makes no claims about real channels.
- **Analyze form, this plan only:** parses a YouTube link or 11-char ID client-side; invalid input shows an inline error; valid input navigates to `/video?id=…` (page built in a later plan). Live analysis wiring comes with that plan.

## Design

### Layout

| Width | Layout |
|---|---|
| `lg`+ (≥1024) | Row 1: hero text (left, ~55%) · illustration (right). Row 2: check-a-video card (left, ~45%) · table card (right). Max-width container. |
| `md` (768–1023) | Hero as on `lg`: text on the left, illustration at the top right (344 px wide, see the kid's size in 001) _(human decision, 2026-10-16: as on the other pages; same head size on every page)_; at 768 px the H1 wraps to five lines. Row 2 stacked: form card, then table card. |
| < `md` (320–767) | Single column: heading → paragraph → form card → table card. No illustration _(human decision, 2026-10-16)_; decorations hidden. Input and button stack, both full width. |

### Elements, top to bottom

All visible text is in **Copy** below; this list says only where things go.

1. **Header** (shared layout): skip link (visible on focus) first; logo left, links to `/`; nav right with the current page underlined and `aria-current="page"`; `sun_1.png` small, decorative, beside the nav on `lg`+. Below `lg`: menu button opens the nav as a full-width list.
2. **Hero, left.** H1 (Shantell Sans _(was: Patrick Hand)_, navy, large) with a yellow marker highlight behind its last words; intro in two paragraphs: the opening question alone, then what the site does and the invitation to compare (Nunito, slate) _(human decision, 2026-10-17)_. _(was: three paragraphs, one per sentence; before that two paragraphs, and one intro paragraph plus a small note under it)_
3. **Hero, right.** `kid_1.png`, `aria-hidden`, no speech bubble. Hidden below `md`; a fixed width from `md` (344 / 392 / 464 px at `md` / `lg` / `xl`), so its head is the same size as the other pages' kids (001) _(human decision, 2026-10-16)_. _(was: with a hand-styled CSS speech bubble saying “What’s next?”)_
4. **Check-a-video card** (butter panel `#FEF8D4`, large rounded corners). `grass_1.png` / `flower_1.png` peeking from the bottom-left corner on `md`+. H2 alone _(was: with an info button on the same row, right-aligned with the “Check video” button)_, visible label + input (white, 2px navy outline, thick sunny-yellow ring on focus _(was: light grey-navy outline, default focus outline)_), primary button, inline error (`aria-live="polite"`). No length hint under them _(human decision, 2026-10-26: its 15-minute limit had nothing behind it; a check takes about the same time for any length, since only a 5-minute clip is measured)_. The input's `aria-describedby` points to the error. No popup: the label already says what to paste, so the intro is dropped. _(was: intro and hint in a speech-bubble popup from the info button; before that, intro under the H2 and hint under the button)_
5. **Table card** (white card, subtle border, large rounded corners). `flower_2.png` decorative at top-right corner on `md`+.
   - H2 with a segmented control on the same line, to its right (wraps below it when the row is too narrow: phones, and 1024–~1110 px where the two-column card is narrowest). Compact pill with two options, the selected one filled sunny yellow (see `STYLE.md`). Two buttons with `aria-pressed`; default Videos. _(was: two separate pill chips, which wrapped below the longer H2 on desktop)_
   - Table with an sr-only caption naming the current view. Columns: rank, name, score. The Score header has a small info "i" right after it (`InfoTip`: small navy-outlined circle, navy “i” in Shantell Sans, 44 px touch target) with the score explanation in the popover from `frontend/design/STYLE.md`, opening below the "i" so it covers table rows rather than the heading and the Videos/Channels control, above it when there is no room below. Shown while the mouse hovers; a click/tap or Enter/Space keeps it open until clicked again, Escape, or a click outside. _(was: a speech bubble, white with 2px navy outline, tail and slight tilt, opening below; shared with the check-a-video card)_ _(was: explanation as a footnote under the table)_
   - Every row has the same fixed height (room for a two-line name plus the second line), so the card doesn't change height when switching views or while loading. The gap row is a divider, not a row: short, no row lines above or below it, “Least stimulating” centred, small and muted between two dotted rules (no arrow), not clickable, and read by screen readers too _(human decision, 2026-11-02: as a full-width row between row lines with a ↓, it looked like a link to the full ranking)_. _(was: rows sized to content; a short `aria-hidden` “…” row; briefly “16,369 videos in between”)_
   - Rank cell: numbers (1, 2, 3, −3, −2, −1) right-aligned in a narrow fixed-width column, `tabular-nums` _(was: left-aligned)_; ranks 1–3 in navy, others slate. No row tint. _(was: rows 1–3 get a very light coral row tint)_ Deferred: ranks 1–3 inside a hand-drawn warning triangle (art below), `aria-hidden`, number staying real text, no "warning" wording. _(was: part of this plan)_
   - Name cell: name clamped to 2 lines (full name stays in the DOM); second line in small text (channel name for videos, video count for channels).
   - Score cell: integer, then the segmented score meter from `frontend/design/STYLE.md` (5 segments, `aria-hidden`; one colour per score, cool → warm) _(briefly 10 segments)_, beside the number from `sm` up and below it on phones. _(was: a continuous bar, yellow → orange → coral by value)_
   - "See full rankings" link. _(was: footnote, then the link)_
   - States: loading = 3 grey skeleton rows, the gap row, 3 more _(was: 5 rows)_ (`aria-busy`) plus sr-only loading text; error = message + retry button; empty = message.
6. **Footer** (shared layout): copyright on the left, footer links on the right on `md`+ _(was: links left, copyright right)_; stacked below `md` with the links first. _(was: also a “Source code on GitHub” link)_ No contact email for now. "Cookie settings" comes with the cookie-banner plan.

### Copy

Final text for every string on the page. `{…}` = filled in at runtime. Arrows (→) after link/button text are decorative (`aria-hidden`). Use typographic apostrophes (’).

**Page metadata**

| Where | Text |
|---|---|
| `<title>` | HyperStim? - How stimulating are kids’ videos? |
| Meta description | Compare how stimulating children’s YouTube videos are: a 0–100 score for fast cuts, loud sound, bright colors, and more, made for parents. _(human decision, 2026-10-17: name stimulation and parents; was: “See how fast, loud, and intense children’s YouTube videos are.”)_ |

**Header**

| Where | Text |
|---|---|
| Skip link | Skip to main content |
| Logo alt | HyperStim? home |
| Nav `aria-label` | Main |
| Nav items | Home · Rankings · Compare · How it works _(human decision, 2026-10-16: About delayed, plan 001)_ |
| Menu button (closed / open) | Menu / Close menu |

**Hero**

| Where | Text |
|---|---|
| H1 | How stimulating are the videos **your child watches?** (bold part = marker highlight) |
| Intro, paragraph 1 | From rapid scene changes to bright colors and loud sounds, children’s videos vary in how stimulating they are. _(human decision, 2026-10-24: replaces the question and the name; the site’s name isn’t in the intro)_ |
| Intro, paragraph 2 | Explore and compare {N} videos to better understand what your child is watching. _(human decision, 2026-10-24: two paragraphs; {N} is the real count, not “thousands of”)_ |
| `{N}` | Video count from `/api/meta`, rounded down to whole thousands as “{n}k+” (10,412 → “10k+”); below 1,000, the exact count. Before it loads or if it fails: “thousands of”. _(was: “more than 5,400”, rounded down to the nearest 100)_ |
| Illustration alt | (empty, decorative) |

**Check-a-video card**

| Where | Text |
|---|---|
| H2 | Check a video |
| Input label | YouTube link or video ID |
| Placeholder | https://www.youtube.com/watch?v=… |
| Button | Check video → |
| Error: empty | Paste a YouTube link or video ID first. |
| Error: not valid | That doesn’t look like a YouTube link or video ID. |

**Table card**

| Where | Text |
|---|---|
| H2 | Stimulation rankings _(was: “Most stimulating”; briefly “Most and least stimulating”)_ |
| Segmented control `aria-label` | Show ranking of |
| Segmented control options | Videos · Channels |
| Caption (videos / channels) | The 3 most and 3 least stimulating videos / The 3 most and 3 least stimulating channels _(was: Top 5 most stimulating videos / channels)_ |
| Gap row | Least stimulating _(human decision, 2026-11-02: no arrow)_ _(was: “…”; briefly “{n} videos in between” / “{n} channels in between”)_ |
| Bottom ranks (sr-only) | 3rd least stimulating · 2nd least stimulating · least stimulating (shown as −3, −2, −1) |
| Column headers | # (sr-only: Rank) · Video *or* Channel · Score + info “i” |
| Score info button label (sr) | About the score |
| Video row, second line | {channel name} |
| Channel row, second line | {n} videos |
| Score info popup | Scores range from 0 to 100. Videos with higher scores are more stimulating. _(human decision, 2026-11-09: keep it simple, “stimulating” not “intense”, no word on how channel scores are worked out)_ _(was: footnote under the table)_ |
| Link | See full rankings → |
| Loading (sr-only) | Loading rankings… |
| Error | We couldn’t load the rankings. |
| Error button | Try again |
| Empty | No rankings yet. |

**Footer**

| Where | Text |
|---|---|
| Footer nav `aria-label` | Footer |
| Links | Privacy policy · Cookie settings · GitHub ↗ (plan 015, 2026-10-26; FAQ dropped, About in the header) |
| Copyright | © {year} HyperStim? _(was: “HyperStim Research Team”; before that “research team”, lower case)_ |

All decorative images (`kid_1`, `sun_1`, `grass_*`, `flower_*`, warning triangle) have `alt=""`.

### Images

- **Two folders, so the art backlog never reaches the delivered site:**
  - `frontend/art/`: every original from the team, used or not (the backlog). Committed, but not deployed: Next.js only ships what's in `public/`.
  - `frontend/public/images/`: generated, git-ignored. A script (`npm run images`, run automatically before `dev` and `build`) converts only the images listed in `frontend/art/used.json` to WebP, resized to 2× their largest display width (≈ 100–300 KB instead of 1–2 MB). Unused art adds nothing to the site's size or load time.
  - Every page uses the same images through `/images/<name>.webp` (a small helper adds the `basePath`). Using a new image = add one line to `used.json`.
  - Conversion uses `sharp` (dev dependency only).
- Used on this page: `Logo`, `kid_1`, `sun_1`, `grass_1`, `flower_1`, `flower_2`.
- **Deferred (not needed for now): warning triangle** (`warning_1.png`). Spec kept for when it is requested:
  - Shows: a road-sign-style warning triangle with rounded corners, empty inside (no "!"); the rank number is laid over it in code.
  - Colours: sunny yellow fill `#F8D040`, coral outline `#F85858`.
  - Style: hand-drawn crayon, matching the other illustrations; slightly wobbly edges.
  - Size: 1:1 canvas, at least 256 × 256 px, triangle filling the canvas; transparent PNG.
  - Until then, ranks 1–3 render as plain numbers (no placeholder art).

## API contract (frontend `api.ts` ↔ backend)

```
GET /api/meta
  → { videoCount: number, channelCount: number, updatedAt: string /* ISO date */ }
GET /api/videos?sort=score&order=desc|asc&limit=3
  → { items: [{ id: string, title: string, channel: string, score: number, … }], total: number }
GET /api/channels?sort=score&order=desc|asc&limit=3
  → { items: [{ name: string, score: number, videoCount: number, … }], total: number }
```

The list endpoints' full contract (sorting by measurement, `order`, category, search, paging, and the extra item fields) is owned by plan 007; the home card uses `sort=score`, `order=desc|asc` and `limit` _(human decision, 2026-10-15, plan 007: `sort=score_desc|score_asc` became `sort=score&order=desc|asc`)_. The home table makes one request per end and view. `score` is rounded to 1 decimal by the backend; the frontend shows it as an integer.

## Backend (steps 7–8)

- **Layout.** `backend/` as a uv project: `pyproject.toml`, `uv.lock`, `.python-version` (3.12, same as the pipeline's environment _(was: 3.13)_), `.env.example`, `README.md`, `src/hyperstim_api/` (`main.py` app + routes, `config.py` env, `dataset.py` load + rank, `scoring.py` percentiles), `scripts/import_dataset.py`, `data/`, `pipeline/`, `tests/` with a small synthetic fixture TSV.
- **Dependencies.** Runtime: `fastapi`, `uvicorn`, plus the pipeline's deps at its exact pins (`numpy==2.4.3`, `opencv-python-headless==4.13.0.92`, `PyYAML==6.0.1`, `yt-dlp==2026.8.19`; exact because feature values must match the dataset's). Not copied: deps these two scripts don’t use (`scipy`, `google-api-python-client`, `matplotlib`). Dev: `pytest`, `httpx2` (FastAPI test client; `httpx2`, which Starlette now asks for), `ruff`, `mypy`. Data read with the stdlib `csv` module, no pandas (16k rows is small).
- **Env vars** (`.env.example` has placeholders only):
  - `DATASET_PATH`: the dataset file. Required, like `CORS_ORIGIN`; the app refuses to start without them. `.env.example` points it at the committed `backend/data/videos.tsv`. _(was: a file outside the repo)_
  - `CORS_ORIGIN`: the one allowed origin (the Pages site, or `http://localhost:3000` locally). GET only.
- **Dataset source** (research repo, read-only; copied, never modified there). Contemporary v2 corpus, feature caches `CACHE_VERSION 11`, 16,375 videos:
  - `runs/feature-set-v11/features-contemporary-v11.tsv`: exactly the 16,375 videos, metadata + the 12 features. No titles; its `content_category` is empty.
  - `data/contemporary-v2-categories.tsv`: `category` and `title`, joined on `video_id`. `play` is shown as “play & activity” (as the analysis does).
  - `data/contemporary-v2-corpus.tsv`: used only as a check (rows with `removed_v30 == 0` and `clip_present == 1` must be exactly the features file's IDs).
  - `data/contemporary-v2-figures-of-record.md`: the import checks its totals (16,375 videos; per-category counts).
  - Checked: all joins are 1:1, every video has a title; `inter_cut_dssim_mean` is empty for 1,461 videos (no cut pair) and `loudness_jumps_per_min`/`lufs` for 7; 542 channels, 512 with ≥ 5 videos.
- **Import script** `backend/scripts/import_dataset.py <research-repo-dir>`: reads the files above, runs the checks, and writes `backend/data/videos.tsv` (committed, ≈ 3 MB) plus `backend/data/videos.meta.json` (source, `CACHE_VERSION`, feature-table date, row count). Columns: `video_id`, `title`, `channel_id`, `channel_title`, `category`, `published_at`, `duration_s` (the video's full length, from the corpus file; the features file's `duration_s` is the clip's), the 12 features. Nothing else from the research files (no view/subscriber counts, tiers, cache info). Re-run by hand when the research data changes.
- **Dataset input** for the app: `videos.tsv` as above. Rows without an ID or with no feature values are skipped and counted in a startup log line.
- **Score** = a percentile, 0–100. Computed at startup: each of the 12 features is ranked separately as a percentile within the dataset (`100·(count ≤ value − 1)/(n − 1)`); a video's composite is the mean of its 12 feature percentiles (missing features left out); its score is the percentile of that composite among all videos' composites (same formula), rounded to 1 decimal. So the least stimulating video is 0 and the most stimulating 100. A channel's score is the mean of its videos' scores. Live videos are scored against the same pools. _(was: the composite itself, which only spans about 28–83 because averaging pulls scores toward the middle)_ `scoring.py` will be reused by live analysis later.
- **Ranking.** Videos sorted by score, ties broken by `video_id` so the order is stable. `order=asc` is the exact reverse of `order=desc`, so ranks counted back from `total` match (every video has a score, so `total` counts them all; see plan 007 for the other criteria). Channels grouped by `channel_id` (name = `channel_title`), score = mean of their videos' unrounded scores, then rounded. `total` = number of videos / channels that pass `minVideos`.
- **`/api/meta`.** `videoCount` = scored videos, `channelCount` = distinct channels among them (no threshold), `updatedAt` = the feature-table date from `videos.meta.json` _(was: the file's modification date; git doesn't keep those)_.
- **Params.** `sort` (default `score`), `order` ∈ {`desc`, `asc`} (default `desc`), `limit` 1–100 (default 20), `minVideos` 1–1000 (default 1, _2026-10-28, plan 013_; was 5); the rest in plan 007 _(2026-10-15)_. Anything else → 422 (FastAPI's default validation).
- **`/api/health`** → `{ "status": "ok" }`.
- **Pipeline** (`backend/pipeline/`, copied from the research repo's `code/pipeline/`; only what serving the site needs):
  - `58_download_clips_v2.py`: the downloader that produced the dataset's clips (30 s offset, 300 s, format 18 / ≤ 360p, player clients default → mweb → android). One change: `--clips-dir` has no default (the original default is a server path).
  - `04_extract_features_v2.py` at `CACHE_VERSION 11`, unchanged.
  - `config.yaml`: only `output_dir` and `clips_dir`, which 04 reads. `pipeline/output/` (clips, caches) is git-ignored.
  - `README.md`: source commit, what was copied and changed, the two-stage usage.
  - Vendored code: excluded from ruff and mypy so it stays identical to the research version.
- **Server tools** (not pip packages; in `backend/README.md` as prerequisites): ffmpeg + ffprobe 6.1.1 (the version the dataset was extracted with), and deno (yt-dlp's JS runtime for `--remote-components ejs:github`).
- **CI.** New `backend` job: `uv sync --locked`, `ruff check`, `ruff format --check`, `mypy`, `pytest`. uv version pinned in the workflow.

## Steps

1. **Frontend scaffold.** Next.js (App Router, TS, static export, `basePath` from env), Tailwind with the palette from 001 as theme tokens, Shantell Sans _(was: Patrick Hand)_ + Nunito via `next/font`, ESLint, Vitest + Testing Library. npm scripts: `lint`, `typecheck`, `build`, `test`. GitHub Actions CI running them.
2. **Images.** Move the originals from `public/images/` to `frontend/art/`; add `used.json` and the conversion script; git-ignore `public/images/`. Request the warning triangle from the team.
3. **Shared layout.** Header (with mobile menu) and footer as above.
4. **API client + mocks.** Types and functions for the three endpoints in `src/lib/api.ts`; mock responses (made-up data, ~10 videos, ~6 channels) used when `NEXT_PUBLIC_API_MOCK=1`.
5. **Home page.** Hero, check-a-video card (with link/ID parser), table card with chip toggle and all states.
6. **Frontend tests + review.** Unit tests: link/ID parser, chip toggle switches table and caption, loading/error/empty states. Manual check at 320, 360, 768, 1280, 1920 px and keyboard-only. Stop here for review of the page on mock data.
7. **Backend scaffold.** FastAPI app, env config (`DATASET_PATH`, `CORS_ORIGIN`), `.env.example`, ruff + mypy + pytest, CI job. Dataset loaded into memory at startup.
8. **Backend endpoints.** `/api/health`, `/api/meta`, `/api/videos` (sort + limit), `/api/channels` (sort, limit, minVideos). Pytest against a small synthetic fixture dataset (ranking order, channel threshold, limits, bad params → 422).
9. **Connect.** Frontend uses the real backend when `NEXT_PUBLIC_API_BASE` is set; run both locally and check the page end to end. `frontend/.env.example` now defaults to the local backend (`http://localhost:8000`, mock off); CI builds keep using the mock.
10. **Safari fixes** (2026-10-30, plan 017). In Safari, a tap anywhere in the rankings card opened the least stimulating video, as Safari ignores `relative` on a table row. The name's link now covers its cell, and a click elsewhere in the row opens it (`LinkedRow`). The Videos/Channels pill gets its own height (`min-h-9`). `STYLE.md` (Tables, Segmented control, Browser pitfalls); tests.
11. **Quieter gap row** (2026-11-02). The gap row becomes the divider described under Elements (no row lines, dotted rules, no arrow), so it no longer looks clickable; “See full rankings →” stays under the table _(human decision, 2026-11-02)_. Also the loading state's gap row. `STYLE.md` (Muted note); component test for the divider's text and that it has no link; the E2E home spec and the Safari check still pass.

## Review decisions

Human decisions from the step 6 review of the page on mock data (recorded per the human-decision rule in `CLAUDE.md`).

1. **Images can't be selected or dragged, on every page.** Set once for all `<img>` in the global stylesheet (`user-select: none`, `-webkit-user-drag: none`), so later pages get it without extra work.
2. **Heading font is Shantell Sans, weight 600, on every page** (headings, the info “i”, and any other hand-lettered text; body and UI stay Nunito). Chosen after comparing ten handwritten Google Fonts on the home hero: marker-style and very readable. Replaces 001's example **Patrick Hand** (thin, narrow pen strokes that read like notebook handwriting). Shantell Sans runs wider, so heading sizes are about 10 % smaller than with Patrick Hand.
3. **Data comes from the research repo, copied into this one.** Copy (and transform if needed) the data into this repo without modifying anything in the research repo; this repo must stand alone afterwards. Source files as listed under **Backend**. _(overrides 001: “dataset loaded from a file outside the repo”)_
4. **Extraction pipeline for later live analysis:** the research repo's `code/pipeline/04_extract_features_v2.py` at `CACHE_VERSION 11`, in two stages: `extract` (expensive decode, run once, writes a per-clip cache) and `derive` (cheap thresholds, re-runnable). Its default thresholds equal the v11 run that produced the dataset.
5. **The clip download script is copied too.** We definitely need the server tools (ffmpeg/ffprobe) to serve the backend.
6. **Video IDs and metadata may be committed**, as long as it's not the actual video clips. So `videos.tsv` (IDs, metadata, features) is committed.
7. **Score = the average of the 12 percentiles.**
8. **Copy in the pipeline, only the parts needed to serve the website:** the download and extract scripts. _(overrides 001: pipeline “not vendored into this repo”, run from its own environment)_
9. **Downloader is `58_download_clips_v2.py` only**, the script that produced the dataset's clips. _(was: `03_download_clips.py`)_
10. **Scores are percentiles, 0–100.** Percentiles are computed on each of the 12 dimensions separately; a video's overall score averages the 12, rescaled so it shows a percentile; a channel's score averages all its videos' scores.
11. **The check-a-video tooltip is removed.** It felt out of place: dialog-like (thick navy border, shadow, tail), too large, and covering the input it explains. The label already says what to paste, so the intro line is dropped (and, later, the length hint too: see Elements, Check-a-video card).
12. **Popovers follow the site's quiet UI style** (thin light border, soft shadow, rounded, no tail or tilt, compact) and open on the side of the trigger with no controls, so the Score info opens below its “i”.
13. **One living style guide, `frontend/design/STYLE.md`**, kept as part of this plan's work: it is the single source for the current look (values stay in `globals.css` tokens), overrides 001's Visual style section, and plans reference it instead of restating styles. `CLAUDE.md` says to read it before UI work, update it with any style change, flag requests that conflict with it, and screenshot UI changes before handing them back.
14. **The table is titled “Stimulation rankings”.**
15. **The gap between the two ends says how many items it skips** (“16,369 videos in between”, counted, not hard-coded), in small muted centred text instead of “…”, which looked like missing data.
16. **Ranks are right-aligned** in a fixed-width column with tabular digits.
17. **Scores show a 10-segment meter instead of a bar.** Filled = `max(1, ceil(score/10))`; one segment always shows as a visual convention, the number stays exact. All filled segments share one colour by score (cool for low, warm for high).
18. **High ranks are still the warnings** (the meter's coral end), but the warning triangles aren't needed at this moment.
19. **The table was too busy; simplified:** the bottom ranks show as −3, −2, −1 instead of their full ranks; the gap row says “↓ Least stimulating” instead of the count in between (overrides 15); the meter has 5 segments instead of 10 (overrides 17).
20. **Videos/Channels is a segmented control on the same line as the H2, on its right** (instead of two chips).
21. **A little more space between the table's columns** (rank → name 16/20 px, name → score 16/24 px, phone/desktop).
22. **The footer copyright says “© {year} HyperStim?”** instead of “© {year} HyperStim Research Team”.

## Open questions

None.

## Resolved questions

1. Copy: approved as in **Copy**, with the user's edits.
2. Channel ranking: mean score, channels with ≥ 5 scored videos.
3. Images: originals (incl. unused ones) kept in `frontend/art/`; only used images are converted and shipped.
4. Footer: no contact email for now; copyright holder “HyperStim?” _(was: “HyperStim Research Team”; before that “HyperStim research team”)_.
5. Header nav: Home · Rankings · Compare · How it works · About (plan 015, 2026-10-26); no FAQ link (the questions are on How it works).
6. Data release: IDs, metadata and features are public; clips never (review decision 6).
7. Score: average of the 12 percentiles (review decision 7).
8. Pipeline: copied in, downloader + extractor only (review decisions 8–9).
