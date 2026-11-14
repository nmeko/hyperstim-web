# 010 — Deployment

**Area:** Environments, releases, and deploying the frontend (GitHub Pages) and the backend (our server).

## Goal

A lightweight release with one command: `main` is the latest dev version, prod runs the last release and can be behind `main`.

## Decisions

- **Two environments, no staging** (one-person team; add it if the team grows).

  | | Dev | Prod |
  |---|---|---|
  | Frontend | `next dev` (`./dev.sh`, plan 003) | GitHub Pages, built from a release tag |
  | Backend | any dev checkout, `uvicorn --reload`, localhost only _(human decision, 2026-10-17)_ | the prod instance (below) at the release commit, always-on systemd service behind nginx |
  | Config | `.env` / `.env.local` (dev values) | the instance's `env` file (analysis limits on, `YOUTUBE_API_KEY` set, `CORS_ORIGIN` = the site's origin: the org's Pages custom domain, which `<owner>.github.io` redirects to); Actions variables for the frontend |
  | Data | `backend/analysis/` | the instance's `data/` |

- **Releases are semantic-version tags `vMAJOR.MINOR.PATCH`, bumped from the commit messages since the last release** _(human decision, 2026-10-24: replaces the date tags `vYYYY.MM.DD.N`)_. Commits follow Conventional Commits (the rule is in `DEVELOPMENT.md`, "Commit messages", and `AGENTS.md` points to it _(human decision, 2026-11-13, plan 016)_):
  - `!` after the type (`feat!: …`) or a `BREAKING CHANGE:` line in the body → **major**.
  - any `feat` → **minor**; anything else (`fix`, `docs`, `refactor`, `chore`, …, or a subject that doesn't parse) → **patch**.
  - One tag releases frontend and backend together (they share the API contract).
- **Breaking (major) = something a visitor relied on stops working or changes meaning** _(human decision, 2026-10-24)_:
  - a page URL or a shareable link (e.g. a rankings search, a compare link) stops working: removed, or moved without a redirect;
  - scores or measurements change meaning, so they can't be compared with earlier ones (a new dataset, feature extraction or scoring method).

  Not breaking: redesigns, new or reworded text, new pages, removed features whose URLs still answer. The API isn't public (CORS allows only our site), so API changes aren't breaking for outsiders; within the site they stay additive regardless (below).
- **Release notes** _(human decision, 2026-10-24)_: `release.sh` writes the commits since the last release into the annotated tag's message, grouped: Breaking changes, Features, Fixes, Other (subjects only; `docs`/`chore`/`ci`/`test`/`build`/`style`/`refactor`/`perf` under Other). The dataset's growth (plan 013) is the last bullet under Other, after the commits _(human decision, 2026-11-02)_. A rollback's notes say "Roll back to vX.Y.Z".
- **GitHub Release pages** _(human decision, 2026-10-24)_: a new workflow `.github/workflows/release-page.yml`, on push of `v*` tags, creates a GitHub Release titled with the tag and with the tag's message as its notes (read through GitHub's API with the runner's `gh`, so the server still needs only git, curl and uv; the workflow gets `contents: write`). It can also be run by hand for a tag (Actions → Release page → Run workflow), for the renamed old tags: a tag push runs the workflows of the tagged commit, and the old commits don't have this one. No privacy change: these pages are on the repo, not the site.
- **Versions start at `v1.0.0`, the release that was live on 2026-10-24** (`bdd054b`, date tag `v2026.10.17.4`) _(human decision, 2026-10-24: the old commits don't follow the message format, so bumping each old release from them, to `v1.1.0` … `v1.4.0`, gave minor versions some of them weren't worth)_. Its tag's notes say "First public release."; the five date tags and the briefly used `v1.0.0` … `v1.4.0` (with their Release pages) are deleted. That changes nothing live: Pages keeps the deployed site, and the server's `releases/v2026.10.17.4/` keeps running until the next release replaces it. The Deploy workflow is disabled (Actions → Deploy → `⋯` → Disable workflow) while the tag is pushed, so it doesn't redeploy, and enabled again afterwards; then the Release page workflow is run by hand for `v1.0.0` (a tag push runs the workflows of the tagged commit, and that commit doesn't have it).
- **What is released: the latest `main` on GitHub** (`origin/main`) by default, whatever branch or uncommitted changes the local checkout has. No branch or working-tree checks.
- **Backend changes stay additive** (new fields/endpoints) within a release, so the old frontend keeps working for the minute between the backend and frontend deploys.
- **Only git, curl and uv needed** (no `gh`) _(human decision, 2026-10-17)_. GitHub's API is read without a login (public repo).
- **`release.sh [<commit or tag>]` at the repo root**, plain bash, run as `hyperstim-release`:
  1. `git fetch`; take `origin/main` (or the given commit, which must be on `main`). Stop if that commit is already the latest release, or if CI (`ci.yml`, all four jobs: including SonarQube Cloud's quality gate, plan 012 _(human decision, 2026-10-24)_, and the end-to-end tests _(human decision, 2026-10-27: until then only `frontend` and `backend` were checked)_) didn't pass on it (read from GitHub's API with curl; still running or failed: say so and stop). One release at a time (a lock).
  2. **Backend first, in a fresh checkout per release** (a worktree `releases/<tag>/` of the instance's clone, with its own `.venv`), so testing never touches the running service: as the service user, check out the commit, `uv sync --locked`, run `pytest`; if either fails, remove the checkout and stop. Then point `releases/current` at it, restart the service, poll `GET /api/health`. If unhealthy: point `current` back at the previous release, restart, report, stop. No tag is pushed, so the frontend stays as it was. The newest 5 releases are kept (newest by time, not by name, so the old date-named checkouts are removed in order too).
  3. **Then the tag:** create the next version tag on the commit (bumped from the commits since the latest version tag, with the release notes as its message) and push it. The push starts `deploy.yml`; the script polls the run (curl) and prints the result and the site URL.
  4. Each step's outcome is appended to `releases.log`.
- **Rollback = a new release of an older commit:** `hyperstim-release v1.2.0` releases that commit under the next patch version (e.g. `v1.4.1`, notes: "Roll back to v1.2.0"), so the newest version is always what's live.
- **Who can release:** anyone with a login on the server, in the release group, and with push access to the GitHub repo. They run `release.sh` from **any clone on the server** (their own included), not only the dev checkout, since it releases from GitHub's `main`, not from the clone it runs in.
- **One config file for the whole server setup** _(human decision, 2026-10-17: the step-by-step setup was too complicated)_: `deploy/server.env` (git-ignored; committed: `deploy/server.env.example` with placeholders and a comment per value). It holds every value that differs per server: instance directory, service name and user, release group and its members, local port, the nginx site file of the API host, `CORS_ORIGIN`, `YOUTUBE_API_KEY`, `YTDLP_COOKIES`, the limits. Nothing else is edited by hand.
- **One setup command:** `sudo deploy/setup.sh` reads `deploy/server.env` and does the whole server setup: installs the system packages and tools (below), creates the user, group and `<prod-dir>`, clones the repo, writes the API's `env` and `instance.env`, renders and installs the systemd unit, nginx files and sudoers rule from the templates, checks them (`nginx -t`, `visudo -c`) and reloads. It can be run again at any time (after editing `server.env` or when the templates change) and only changes what differs, listing what it changed; a failing `nginx -t` restores the site file. It also installs a `hyperstim-release` command (root-owned, knows `<prod-dir>`), so releasers need no config of their own: `release.env` and `release.env.example` go away.
- **System requirements in one place, for dev and the server** _(human decision, 2026-10-17: they were scattered; dev too)_: `tools.env` at the repo root pins uv, deno, nvm and the expected ffmpeg version, and lists the OS packages (apt; Homebrew on macOS for dev). One installer, `scripts/install-tools.sh`, installs exactly these and skips what's already there: uv and deno as release binaries checked against their published checksums, ffmpeg etc. from the OS packages (warning if ffmpeg isn't the dataset's version), and for dev nvm plus the Node in `frontend/.nvmrc`. Dev runs it as `./dev.sh --install-tools` (into `~/.local/bin`); `setup.sh` runs it for the server (into `<prod-dir>/bin/`, plus nginx and envsubst). CI reads uv's version from `tools.env`. Language dependencies stay in `package-lock.json` and `uv.lock`. For dev it also installs the browsers the end-to-end tests run in (plan 012), Playwright's Chromium and WebKit with the OS libraries they need: `npx playwright install --with-deps chromium webkit` in `frontend/` (running `npm ci` first if `node_modules` is missing), so their version always follows Playwright's in `package-lock.json` and needs no pin in `tools.env`. Then the Safari check's own Playwright and WebKit in `frontend/e2e/safari/` (2026-10-30, plan 017). Not on the server, which runs no browser tests _(human decision, 2026-10-27: new developers must get them from the setup, not find out from a failing test)_.
- **`.github/workflows/deploy.yml`:** on push of tags `v*`; `npm ci`, `npm run build` with `NEXT_PUBLIC_API_BASE`, `NEXT_PUBLIC_BASE_PATH` and `NEXT_PUBLIC_SITE_ORIGIN` from Actions variables (also the optional `NEXT_PUBLIC_GA_ID`, plan 009, and `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, plan 011), then the official Pages actions (`configure-pages`, `upload-pages-artifact`, `deploy-pages`). CI already ran the checks on that commit.
- **The prod API is served under `/v2/` on the existing API domain**, next to the old API on `/api/` (the old site still uses it until it's retired, 001 migration step 4) _(human decision, 2026-10-17)_. nginx maps `/v2/api/…` to the service's `/api/…`, so the frontend only needs `NEXT_PUBLIC_API_BASE=https://<api-host>/v2`; no code change.
- **The repo is named `hyperstim`, so the site is at `https://aismithlab.com/hyperstim/`** _(human decision, 2026-10-17: shorter than `/hyperstimulation-website/`; `hyperstimulation` is taken by the research repo, since GitHub repo names ignore case)_. Pages serves a project repo at `<domain>/<repo-name>/`, so the path is changed by renaming the repo. Renamed from `hyperstimulation-website` on 2026-10-17, after the first release; the old address returns 404 (GitHub redirects git and web URLs of a renamed repo, but not its Pages). The repo itself only ever says `<repo-name>`; the name lives outside it, and all of these were changed (`deploy/README.md` lists them for any later rename):
  - the GitHub repo name, and the Actions variable `NEXT_PUBLIC_BASE_PATH` = `/hyperstim`;
  - each clone's `origin` (old URLs still work through GitHub's redirect, but update them);
  - the prod clone's `origin`: `sudo deploy/setup.sh` sets it from the clone it runs in;
  - a new release, so the frontend is built under the new path.
- **The first release goes to this repo's Pages; the old site is deployed elsewhere and isn't affected** _(human decision, 2026-10-17)_.
- **The YouTube API key is the one dev uses** _(human decision, 2026-10-17)_; dev and prod share its quota (10,000 units/day; a new analysis costs 1, prod caps at 1,000/day). In Google Cloud, restrict the key to the YouTube Data API and to the server's IP (dev and prod both run there).

### The prod instance

Everything of the instance sits in one directory `<prod-dir>` on the server, so it's easy to find and trace _(human decision, 2026-10-17)_. It's outside home folders (in the system's usual place for what a machine serves): the service user can't enter home folders, and prod shouldn't depend on one person's account _(human decision, 2026-10-17)_. Layout and setup: `deploy/README.md`.

```
<prod-dir>/                  owned by root
  repo/                      clone of this repo; fetches from GitHub without a login (public repo)
  releases/<tag>/            one checkout per release, with its own .venv
  releases/current -> <tag>  what the service runs
  data/                      the service's only writable folder: analyses, caches
  bin/                       uv and deno (the service can't use ones in a home folder)
  uv/                        uv's Python and cache
  env                        prod config and secrets (readable by the service only)
  instance.env               what release.sh needs
  <service>.service          systemd unit, linked into systemd with `systemctl link`
  nginx-*.conf               per-IP connection cap and the /v2/ locations, included by nginx
  releases.log               one line per release: time, who, tag, commit, result
```

The growing dataset (plan 013, decision 11) adds the collector's service and folders, the data bot's user, clone and daily timer, the hourly alert check with its root-only token file (decision 12, 2026-10-29), and the release group's read access (plan 014); `release.sh` restarts the collector after the API.

- Runs as its **own system user** (`<service-user>`), so the public service can't read or write anyone's home folder, the dev checkouts, or GitHub credentials _(human decision, 2026-10-17)_. Pushing the tag uses the releaser's own GitHub login, from their clone.
- `<prod-dir>` itself, the unit, the nginx files, `env` and `bin/` are owned by root (the service user must not change what runs it or how).
- Releasing needs no full sudo: a sudoers rule lets the release group run commands as the service user and run exactly `systemctl restart <service>`.
- Server files with real values stay on the server (001); `deploy/` holds them as templates with placeholders, rendered by `setup.sh` from `server.env`.
- **`deploy/` vs `release.sh`:** `deploy/setup.sh` prepares the server, once (and again only when the server setup changes). `release.sh` (via `hyperstim-release`) ships a new version, frontend and backend together, every time.

## Protection against abuse

The API URL is public once the site is (the browser calls it), and CORS stops only other websites' pages, not scripts. So all protection is on the server. Already in the app: per-IP limit on new analyses (20/hour _(human decision, 2026-10-17: too strict)_), a queue of 10, one analysis at a time on at most 4 cores, the made-for-kids check, thumbnails only for known videos, capped query parameters.

Added in prod:

- **Only nginx is reachable from outside:** uvicorn listens on `127.0.0.1`; nginx proxies only `/v2/api/`.
- **nginx: no request-rate limits** _(human decision, 2026-10-17: too strict)_, for the API and thumbnails alike. Kept: at most 20 connections at once per IP (`limit_conn`, over it → 429), small request bodies, short timeouts. Risk taken: each thumbnail request makes us fetch from YouTube, so one script could make the server hammer YouTube; add a thumbnail rate limit back if that shows up. When YouTube can't be reached, the server waits 10 minutes before asking again for that image _(2026-11-02, plan 009)_.
- **A daily cap on new analyses across all visitors** (`ANALYSIS_LIMIT_PER_DAY`, env var, 0 = off for dev; prod 1,000 _(human decision, 2026-10-17: too strict)_), so many IPs together can't use up the YouTube API quota or get the server's IP blocked by YouTube for heavy downloading. Over the cap → the same "busy" answer as a full queue.
- **API docs off in prod** (`/docs`, `/redoc`, `/openapi.json`), via an env var; on in dev.
- **systemd hardening** for the service (the pipeline parses downloaded videos with ffmpeg, so limit the damage if one is malicious): own user, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, write access only to `data/`, `MemoryMax` and `CPUQuota`.
- **Firewall:** only SSH and 80/443 open to the internet, set in the cloud provider's security group.

Not now (add if abuse shows up): fail2ban on repeated 429s; a CDN or bot-check in front (third party: the privacy policy would have to name it).

## Steps

1. **GitHub setup, by hand (an org/repo admin):**
   1. Scan the whole git history for anything the public-repo rules forbid; fix before going public.
   2. Settings → General → Danger Zone: make the repo public.
   3. Settings → Pages → Build and deployment: source "GitHub Actions".
   4. Settings → Environments → `github-pages` → Deployment branches and tags: add the tag rule `v*` (by default only the default branch may deploy).
   5. Settings → Secrets and variables → Actions → Variables: `NEXT_PUBLIC_API_BASE` = `https://<api-host>/v2`, `NEXT_PUBLIC_BASE_PATH` = `/<repo-name>`, `NEXT_PUBLIC_SITE_ORIGIN` = `https://<domain>` (plan 011).
2. **Cloud setup, by hand:** check the instance's security group allows only 22, 80, 443 from the internet; restrict the YouTube API key (above).
3. **Server setup:** copy `deploy/server.env.example` to `deploy/server.env`, fill it in, run `sudo deploy/setup.sh` (`deploy/README.md`). What it sets up: service user and release group, `<prod-dir>` layout, `bin/` tools, clone, `env`, systemd unit (`Restart=always`, enabled at boot, `--proxy-headers`, no `--reload`, single process), nginx files included from the API site, sudoers rule, `hyperstim-release`.
4. Backend: `ANALYSIS_LIMIT_PER_DAY` and the docs switch, with tests; `.env.example` and `backend/README.md` updated.
5. Write `deploy.yml`, `release.sh`, the `deploy/` templates, `server.env.example`, `setup.sh` and a short guide; `tools.env`, `scripts/install-tools.sh`, `./dev.sh --install-tools`; git-ignore `deploy/server.env`. Run `setup.sh` on our server over the setup done by hand so far (it should change nothing but add `hyperstim-release`).
6. Docs: `DEVELOPMENT.md` "Release" section _(human decision, 2026-10-24: moved there from the root `README.md`, plan 001)_ (who can release, `hyperstim-release`, rollback) and `--install-tools`; `backend/README.md` links to `deploy/README.md`; `CLAUDE.md` gets one line on releasing.
7. Update 001: frontend deployed on a release tag; prod backend runs from its own instance (done).
8. Check: 429 from nginx above 20 connections per IP; docs 404 in prod; first release end to end; a failing backend test leaves the service untouched; an unhealthy backend rolls back and pushes no tag; rollback to an older tag; a release from another clone, on a feature branch with uncommitted edits, still releases `origin/main`.

9. **Semantic versions (2026-10-24):**
   1. `CLAUDE.md`: replace the line "Commit messages: imperative, describe the why." with the **Commit messages** section below _(human decision, 2026-10-24: the instructions must be written out so Claude knows how to write them)_.
   2. `.githooks/commit-msg` (bash, no dependency) rejects a subject that doesn't match `<type>[!]: <subject>` (git's own `Merge …` and `Revert "…"` subjects pass); `./dev.sh` sets `git config core.hooksPath .githooks` once per clone. CI doesn't check: a bad message already on `main` can't be fixed, and `release.sh` counts it as a patch.
   3. `release.sh`: latest release = highest `vX.Y.Z` tag; bump and notes from the commits in `<latest>..<commit>`, by `scripts/release-notes.sh`; prune checkouts by time.
   4. `.github/workflows/release-page.yml`.
   5. Once on `main`, replace the old tags with `v1.0.0` (above): Deploy disabled, tags pushed and deleted, Deploy enabled, Release page workflow run for `v1.0.0`.
   6. Docs: `DEVELOPMENT.md` Release section (moved from the root `README.md`, plan 001) (version scheme, where the notes are, rollback example). `deploy.yml`, `ci.yml` (Sonar's `--match 'v*'`) and the Pages environment's `v*` rule need no change.
   7. Check: a release with only `fix` commits bumps patch, with a `feat` minor, with `!` major; a rollback bumps patch; the tag message and the Release page list the grouped commits; the hook rejects `Add x` and accepts `feat: Add x (plan 010)`.

### Commit messages (the text for `CLAUDE.md`)

> - **Commit messages follow Conventional Commits**; `release.sh` takes the next version and the release notes from them (plan 010). Format: `<type>[!]: <subject> (plan NNN)`, then an optional body after a blank line.
>   - **Subject:** imperative, capitalised, no full stop; says what changes and why, in words a reader of the release notes understands. End with the plan(s) it belongs to, `(plan 007)` or `(plans 007, 008)`; leave it out for changes outside any plan.
>   - **Type**, by what the change means for the live site (pick the first that fits; split the commit if it's two things):
>     - `feat`: something new visitors can see or use: pages, features, text, API endpoints. → minor version.
>     - `fix`: the site or API didn't work as intended, or an existing feature is adjusted to work better (how it behaves, looks or is laid out), including security fixes (also a dependency upgrade done for one). → patch. _(human decision, 2026-10-28: adjusting an existing feature was a `feat`, a minor version)_
>     - `perf`: faster or lighter, same behaviour. `refactor`: code change with no visible change. `style`: formatting only.
>     - `test`: tests only. `docs`: plans, READMEs, `STYLE.md`, `CLAUDE.md`, code comments. `build`: dependencies, build config, dev scripts. `ci`: CI, release and server setup (`.github/`, `release.sh`, `deploy/`). `chore`: anything else.
>   - **Breaking:** add `!` after the type and a body line `BREAKING CHANGE: <what stops working, and what to do instead>` when a page URL or shareable link stops working (removed, or moved without a redirect), or scores or measurements change meaning so they can't be compared with earlier ones. → major version. Redesigns, new text and new pages are not breaking.
>   - Examples:
>     - `feat: Add the compare page for two videos or two channels (plan 008)`
>     - `fix: Show a count of 0 as 0 and silent clips as "No sound" (plan 004)`
>     - `fix: Upgrade Next.js to 16.4.2 for its security fixes`
>     - `docs: Record human decisions in place in plans`
>     - `ci: Number release tags from .1 each day (plan 010)`
>     - `feat!: Score videos with the v3 feature set (plan 002)` + body `BREAKING CHANGE: scores are not comparable with earlier releases.`

## Open questions

None.
