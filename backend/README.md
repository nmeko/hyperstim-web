# HyperStim backend

FastAPI app that serves the website's data API from the dataset in `data/`, plus live analysis of other videos with the analysis pipeline (`pipeline/`). The API contract is mirrored by the frontend's `src/lib/api.ts`; change both together.

## Prerequisites

`./dev.sh --install-tools` at the repo root installs all of them, at the versions in `../tools.env`:

- [uv](https://docs.astral.sh/uv/). It installs the pinned Python (`.python-version`) and all Python dependencies, including dev tools.
- For the pipeline only (live analysis, not needed for the data API or tests):
  - **ffmpeg + ffprobe 6.1.1**, the version the dataset was extracted with (Ubuntu 24.04's package).
  - **[deno](https://deno.com/)**, the JavaScript runtime yt-dlp uses for YouTube (`--remote-components ejs:github`).

## Setup

```sh
cd backend
uv sync
cp .env.example .env
```

## Environment variables

See `.env.example`.

| Variable | Purpose |
|---|---|
| `DATASET_PATH` | Dataset TSV (`data/videos.tsv`); its `videos.meta.json` must sit next to it. |
| `CORS_ORIGIN` | The one origin allowed to call the API (the frontend's URL). |
| `ANALYSIS_DIR` | Folder for live analyses: one JSON result per video, plus the running video's temporary clip. Outside the repo on the server (locally `analysis/`, git-ignored). |
| `THUMBNAIL_DIR` | Folder for cached video thumbnails, one file per video and size. Outside the repo on the server (locally `thumbnails/`, git-ignored). |
| `ANALYSIS_LIMIT_PER_IP` | New live analyses one IP address may start per hour; `0` = no limit (local development). Optional, default 20. |
| `ANALYSIS_LIMIT_PER_DAY` | New live analyses all visitors together may start in 24 hours (over it: `503 Busy`, like a full queue); `0` = no limit (local development). Optional, default 1000. Survives a restart. |
| `API_DOCS` | `1` = serve the API docs (`/docs`, `/redoc`, `/openapi.json`), `0` = off (production). Optional, default 1. |
| `YOUTUBE_API_KEY` | YouTube Data API key for the live analysis's made-for-kids check (1 quota unit per new video). Empty = no check, for local development; always set it on the server. Never commit it. |
| `YTDLP_COOKIES` | Optional cookies file for yt-dlp, if YouTube asks for one. Never commit it. |
| `COLLECTED_DIR` | The collector's exported files, added to the dataset and reloaded when they change (see **Growing dataset**). Optional; unset = `DATASET_PATH` only. |
| `COLLECTED_RELOAD_S` | Seconds between looks at `COLLECTED_DIR`. Optional, default 300. |
| `USAGE_DIR` | Folder for the daily usage counts (see **Usage numbers**). Optional; unset = nothing counted. Outside the repo on the server (locally `usage/`, git-ignored). |
| `COLLECTOR_DATA_DIR`, `COLLECTOR_CLIPS_DIR`, `COLLECT_PER_DAY`, `COLLECTOR_UNITS_PER_DAY` | The collector's settings (see **Growing dataset**); the API doesn't read them. |
| `ALERT_GITHUB_TOKEN`, `ALERT_REPO`, `ALERT_DATA_UNIT` | The hourly alert check's (server only, set by `deploy/setup.sh`): a fine-grained token with only "Issues: Read and write", the repo as `<owner>/<name>`, and the daily commit's systemd unit. Without the token the check only logs what it would post. |

Prod (on the server, from a release tag) is set up and updated as described in [`../deploy/README.md`](../deploy/README.md).

## Commands

| Command | What it does |
|---|---|
| `uv run --env-file .env uvicorn --factory hyperstim_api.main:create_app --reload` | Dev server at http://localhost:8000 (API docs at `/docs`) |
| `uv run ruff check` | Lint |
| `uv run ruff format` | Format (CI runs `ruff format --check`) |
| `uv run mypy` | Type check |
| `uv run pytest` | Tests |
| `uv run pytest --cov --cov-report=xml` | Tests with coverage, report in `coverage.xml` (CI runs this) |

## Dataset

`data/videos.tsv` (one row per video: ID, title, channel, category, publication date, duration, and the 12 raw features) and `data/videos.meta.json` (source commit, cache version, date) are copied from the research repo by:

```sh
uv run python scripts/import_dataset.py <path-to-research-repo-checkout>
```

The script only reads the research repo, checks the data against its figures of record, and refuses to write if anything is off. Re-run it when the research data changes and commit both files. Video clips are never stored here.

`data/collected/` holds the videos added since (plan 013), committed daily by the data bot (`scripts/commit-data.sh` at the repo root). Before each commit it runs `scripts/growth_chart.py`, which draws `growth.svg` and `growth-dark.svg` (the README's growth chart) from `CHANGELOG.tsv` (its columns: `data/collected/README.md`); to try it locally: `cd data/collected && uv run python ../../scripts/growth_chart.py`.

`data/videos.channel-names.tsv` (`channel_id`, `channel_title`) is ours, not the research repo's: names looked up on YouTube for the reference channels whose videos carry none, and the current names of renamed ones (plan 013). The API shows a channel's name from the collector's `collected/channel-names.tsv` first, then from this file, then the one a video's row carries; the site shows the channel's ID where none has one. The import leaves it alone.

At startup the app scores every video (`src/hyperstim_api/scoring.py`): each of the 12 features is ranked as a percentile within the reference set (`data/videos.tsv`), the 12 percentiles are averaged, and the score is that average's percentile among the reference set's videos (0 = least, 100 = most stimulating). Videos added later and live checks are scored against the same reference set, so a video's score never changes as the dataset grows (plan 013). A channel's score is the mean of its videos' scores.

Rankings (`GET /api/videos` and `GET /api/channels`; `src/hyperstim_api/ranking.py`) are sorted once at startup for the score and each feature: most stimulating first, ties by ID. Rows with no value come last and get no rank; on a per-minute feature, zero events counts as no value. A request filters by category (`sort`, `order`, `category`, `q`, `offset`, `limit`; channels also `minVideos`, default 1, so every channel is ranked), and the ranks are counted within that category. Least stimulating first (`order=asc`) reverses the list and counts the ranks from that end (1 = the least stimulating). Search matches without regard to case, accents or repeated spaces and doesn't change ranks. A channel is listed under a category when at least one of its videos is in it.

## Growing dataset

The collector (`src/hyperstim_api/collector/`, plan 013) keeps adding videos: v2's channels plus ones a weekly re-run of v2's channel search finds, and from them eligible uploads (made for kids, 2–60 minutes, not a Short, online in the US; 2015 onwards), channel first (`sampling.pick_order`). A third of each day's downloads (UTC) explores (`sampling.EXPLORE_SHARE`, `sampling.explore_turn`): it brings the channels that got their first video up to the others (`sampling.catch_up_order`: at least 5 videos and one every other year, then up to the lowest channel in), and with none catching up takes a channel's first video while fewer than 3 got theirs today (`sampling.FIRST_VIDEOS_PER_DAY`), for a channel the filters have judged in, the one with the most subscribers first (`store.first_video`; their counts read again weekly, `Collector.refresh_waiting`); each attempt records whether it explored (`attempts.explore`), each channel whether it's catching up (`channels.catching_up`). The rest expands the channels in, channel first: the channel with the fewest videos per year (its videos over the active parts of its years with an eligible upload, `sampling.active_part`), the higher channel score first on a tie (the collector scores the dataset's videos against the reference set at `DATASET_PATH`, which `run` needs too), its year with the fewest videos per active year below its threshold (its own average, or the other channels' lowest, whichever is higher), and in it the upload with the lowest fixed random number (`sampling.rank`). Checks run ahead of the downloads in the same order, a few uploads at a time (`sampling.CHECKS_PER_YEAR`), after a new channel's 20 lowest numbers (the new channels with the most subscribers first). The year files record each video's rule (`rule_version`: `v2`, `pick` = `level`; before 2026-11-02, `v1` with `sample` or `floor` and the cut-off then). A channel under 10 % made for kids among its checked uploads (`sampling.left_out`), or under 5 estimated eligible uploads per active year (`sampling.eligible_per_year`), is left out with all its videos, reference ones too, judged from 20 answers, again at each export and at least daily, until it's back above both. It downloads and measures each one with the same pipeline as live checks (one core, low priority, never while a live check runs), keeps the clip and its feature cache in `COLLECTOR_CLIPS_DIR`, and exports `collected/<year>.tsv` (added videos, with their provenance), `collected/removed.tsv` (dataset videos gone from YouTube, checked monthly), `collected/channel-names.tsv` (the current names of the dataset's channels, read again weekly, `Collector.refresh_names`, so a renamed channel shows its new name), `collected/excluded-channels.tsv` (the channels left out, with their made-for-kids answers; the API leaves their videos out of everything but the scoring pools) and `collected/meta.json`. The API reads that folder (`COLLECTED_DIR`) and reloads within `COLLECTED_RELOAD_S`; list answers carry the dataset's version (`asOf`), which the site sends back so a visitor's pages don't shift while they browse.

It runs as its own process (not inside the API), with its state in `COLLECTOR_DATA_DIR/collector.db` (SQLite):

```sh
uv run --env-file .env python -m hyperstim_api.collector seed <research-repo>   # once: v2's channels and upload lists
uv run --env-file .env python -m hyperstim_api.collector run                    # until stopped
uv run --env-file .env python -m hyperstim_api.collector status                 # counts, pace, quota, channels below 5, exploring and first videos today, the channels waiting for theirs, left out, blocks, retries, last success per job, score drift
uv run --env-file .env python -m hyperstim_api.collector alerts                 # the hourly alert check; logs what it would post without ALERT_GITHUB_TOKEN
uv run --env-file .env python -m hyperstim_api.collector recount <backup>...    # once: the changelog's day-end counts from daily backups of collector.db
```

- **Days end at 23:59:59 UTC** (plan 013, decision 10): the collector does nothing in each UTC day's last 10 minutes, and its first tick of a day closes the day before: it records the changelog's `ch_ready`, `ch_out`, `ch_yr_2nd` and `ch_yr_med` (at 23:59:59 when the tick before finished before midnight, else with the time they're from) and writes the files again, plus a copy as they stood at midnight in `collected/day-end/` (videos added or taken out after midnight left out), which the daily commit takes. `CHANGELOG.tsv` lists finished days only. `recount` takes those for the day before each backup (its first tick's time, or the file's) unless the day has a count from closer to its end, in which case it only fills in a blank `ch_yr_2nd` and `ch_yr_med`; run it as the service user with `<clips-dir>/backups/collector-*.db` (kept 7 days). Who is left out and when is logged in `collector.db` (`left_out_log`): `ch_out` is counted from it, and `excluded-channels.tsv` shows each channel's `since`.

- **Pace:** `COLLECT_PER_DAY` (120) downloads a day at random intervals. If YouTube blocks downloads ("not a bot"), it waits 6 hours (doubling up to 2 days if blocked again, and halving the pace, which doubles back every 3 days without a block); a block seen by a live check (`ANALYSIS_DIR/youtube-blocked`) pauses it too.
- **Offline check:** each dataset video is checked monthly with the Data API; one missing twice, a day apart, is taken out (`removed.tsv`). A video whose thumbnail YouTube no longer has (`ANALYSIS_DIR/offline-hints/`) is checked on the next tick instead.
- **Failed downloads** (not blocks) are tried again 1, 3 and 7 days later, within the daily pace; the 4th failure gives up. Three failures in a row pause downloads for an hour. yt-dlp's full output for each failed download is kept in `COLLECTOR_DATA_DIR/download-logs/<date>/<id>.log` for 30 days; the warning in the log names the file.
- **Other failures** (plan 013, decision 12): a Data API error makes only that channel's list, batch of uploads or job wait (1 hour, 6 hours, then a day at a time), and downloads go on. An answer that can't settle an upload (missing, no made-for-kids answer, Shorts probe undecided) is asked again 1, 3 and 7 days later, final the 4th time; a dataset video is taken out only when it's still gone a day later. Any other error while collecting a video is a failed download. A failed backup is tried again an hour later. A new channel's upload list is read page by page and goes on from where it stopped.
- **Nothing incomplete is shown:** a measured video without a title, channel name or date waits (`measured`) until the daily repair pass looks it up, then goes on the site; the API also leaves out any incomplete row in the files. On first start after an update, `collector.db` gains its new columns (everything picked before the floor counts as `sample`) and channels that joined after v2 have their upload lists read again in full (only missing uploads are added).
- **Data API:** it shares the site's key and stops at `COLLECTOR_UNITS_PER_DAY` (7,000 of the 10,000 a day), leaving the rest for live checks.
- **Categories:** v2's keyword classifier (`pipeline/63_classify_categories.py`); a video no keyword places has no category.
- **Disk:** about 13 MB a clip; it pauses below 50 GB free.
- **Backup:** once a day it copies `collector.db` to `COLLECTOR_CLIPS_DIR/backups/` (the newest 7 kept).
- **One collector, on prod** (`deploy/README.md`). A second one would double the downloads from YouTube and pick different videos, so don't run it locally against the real key. Dev reads the copy the data bot commits daily (`COLLECTED_DIR=data/collected`, the default): `git pull` brings in the new videos.

## Usage numbers

With `USAGE_DIR` set, the API counts what visitors do (plan 014): one file a day, `USAGE_DIR/<YYYY-MM-DD>.tsv` (UTC), columns `kind`, `key`, `extra`, `count`, rewritten every minute. Nothing about who: no IP, cookie or visitor ID.

| `kind` | `key` | `extra` |
|---|---|---|
| `video_view` | video ID | `dataset` or `live` |
| `channel_view` | channel ID | |
| `live_check` | video ID | `new`, `repeat` (already checked for someone) or `in_dataset` |
| `channel_lookup` | channel ID (a pasted channel link) | `in` or `not_in` the dataset |
| `search_videos`, `search_channels` | the search text (lower-cased, ≤ 80 characters) | `found` or `nothing` |

A search counts once its visitor stops typing for 10 seconds (each IP's last search is held in memory for that long, never written), so half-typed words aren't counted. Counts are rough: scripts and crawlers count too.

To answer a question, combine them with the other files on the server: the live checks' results in `ANALYSIS_DIR/<id>.json` (title, channel, measurements), the collector's `collector.db` and `status` (growth, channels, health) and the dataset. Examples: most checked videos we don't have, by channel, last 30 days; searches that found nothing; videos added per week; the share of the dataset from the 100 busiest channels.

## Live analysis

A video that isn't in the dataset is analyzed on request (`POST /api/analyses/{id}`, polled with `GET /api/analyses/{id}`; `src/hyperstim_api/analysis.py`): check YouTube's made-for-kids flag (Data API, `YOUTUBE_API_KEY`) and look up with yt-dlp, download the clip and measure it with the unchanged pipeline scripts, then score it against the dataset. Live results never change the dataset's scores, rankings or counts; `GET /api/videos/{id}` serves them like dataset videos.

- One video at a time, in a background thread of the API process; up to 10 more wait in a queue. **Run the API as a single process** (no `--workers`).
- Measuring uses at most 4 cores (`MEASURE_CORES` in `analysis.py`; more barely help, since most of the work is single-threaded), leaving the rest of the server free.
- Each video's state is `ANALYSIS_DIR/<id>.json`. Results are kept until the file is deleted; videos waiting or running when the API stopped start again at the next start.
- The per-IP limit sees the visitor's address only if uvicorn trusts the reverse proxy: on the server, run it with `--proxy-headers --forwarded-allow-ips <proxy address>`. Its counts are kept in memory only; the daily limit (`ANALYSIS_LIMIT_PER_DAY`) is counted again from `ANALYSIS_DIR` at each start.

## Thumbnails

`GET /api/thumbnails/{id}?size=hq|mq` (`src/hyperstim_api/thumbnails.py`) serves a video's YouTube thumbnail (`hq` 480×360, `mq` 320×180), so visitors' browsers don't contact YouTube before they press play (the privacy policy says so; plan 009). Only for videos in the dataset or requested for live analysis; anything else is 404. The server fetches each image from YouTube once and keeps it in `THUMBNAIL_DIR` for 30 days (then fetches it again), so YouTube sees at most one request per video and size in that time however often it's shown; the response tells the visitor's browser to keep it for a day. A thumbnail YouTube doesn't have is 404, remembered for a day. YouTube unreachable is 502 (not kept by the browser), unless an older copy is cached, which is served instead; YouTube isn't asked again for that image for 10 minutes. When YouTube says a dataset video's thumbnail is gone, the API leaves an empty file named by the video's ID in `ANALYSIS_DIR/offline-hints/`; the collector checks those videos on its next tick (plan 013, decision 5).

## Privacy

The privacy policy (`/privacy`, plan 009) promises what the server keeps; keep the server set up to match:

- uvicorn's access log is off in the app (`create_app`), so no flag is needed. The reverse proxy already logs every request (deleted after 14 days); uvicorn's would be a second copy with visitors' IPs, kept as long as the server keeps the service's output. The app's own log lines contain no IPs.
- The reverse proxy's access and error logs are deleted after 14 days.
- Check every change to what the backend stores or logs against the policy; one the policy would have to reflect is agreed with the team first, then updates the policy in the same change (`AGENTS.md`).

## Channel lookup

`GET /api/channel-lookup?url=…` (`src/hyperstim_api/channel_lookup.py`) finds the channel behind a YouTube channel link (`/channel/UC…`, `/@handle`, `/c/…`, `/user/…`; not video links), and says whether it's in the dataset; the compare page and the rankings search use it. A `/channel/UC…` link is answered from what we have. A handle, `/c/` or `/user/` link asks YouTube with yt-dlp (under a second), is cached in memory for a day, and counts toward the same per-IP limit as new live analyses (`ANALYSIS_LIMIT_PER_IP`).
- Needs ffmpeg/ffprobe and deno (see Prerequisites); `deno` must be on the API's `PATH`. On the server, `deploy/setup.sh` takes care of both.
- The progress estimate uses typical step durations (`TYPICAL_S` in `analysis.py`); each finished analysis logs its step times, so re-time them if the server changes.

## Blog clip data

A blog post's clip comparisons (`::::clips` blocks, plan 018) chart cuts and motion from `frontend/public/blog-media/<slug>/clips.json`. After adding or changing a block, re-measure and commit the JSON:

```sh
uv run python scripts/clip_data.py <slug>
```

It downloads only the stretches the tabs play into a temporary folder, measures them with the pipeline at the dataset's settings, and deletes them; only titles, times and numbers are written. It also adds the post's videos to `data/blog-videos.txt`, the list of videos the blog embeds, whose thumbnails the API serves like a dataset video's (plan 009, Thumbnails); a test fails if a post embeds a video the list lacks. Needs the network, ffmpeg/ffprobe and deno. `--content-dir` and `--media-dir` point it at other folders.

## Social video data

A post's social video (plan 018, Social video) plays the verses in `frontend/content/blog/<date>-<slug>/social-video.md`. After changing them, re-measure and commit the JSON next to them:

```sh
uv run python scripts/social_video_data.py ../frontend/content/blog/<date>-<slug>
```

It measures the verses exactly as `clip_data.py` measures a post's clips (same download and pipeline settings) and writes `social-video.json`. The video itself is rendered in `frontend/` (see `frontend/content/blog/README.md`, Social video).

## Pipeline

See [`pipeline/README.md`](pipeline/README.md).
