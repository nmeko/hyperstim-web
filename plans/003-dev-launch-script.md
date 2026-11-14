# 003 — Dev launch script

**Area:** Local development setup (`dev.sh`).

## Goal

One command that starts the backend and the frontend together for local development, with the frontend talking to the real backend.

## Decisions

- **`./dev.sh` at the repo root**, plain bash (no new dependencies such as `concurrently` or `make`).
- **What it does:**
  1. Checks the prerequisites (`uv`; nvm or Node 24) and says how to install a missing one.
  2. Checks both ports are free and stops with a clear message if not (e.g. another `next dev` on 3000).
  3. Installs dependencies only when needed: `uv sync` (fast, no-op when up to date); `npm ci` only if `frontend/node_modules` is missing.
  4. Starts the backend (`uvicorn --reload`) and the frontend (`next dev`) side by side, each output line prefixed with `[backend]` / `[frontend]`.
  5. Ctrl+C (or either process exiting) stops both.
- **Ports:** backend 8000, frontend 3000; overridable with `BACKEND_PORT` / `FRONTEND_PORT`.
- **Settings are passed as environment variables, not by editing `.env` files.** The script sets `DATASET_PATH`, `CORS_ORIGIN` (= the frontend's URL), `NEXT_PUBLIC_API_BASE` (= the backend's URL), and an empty `NEXT_PUBLIC_API_MOCK`. These override `.env` / `.env.local`, so the ports always match and a leftover `NEXT_PUBLIC_API_MOCK=1` doesn't silently show mock data.
- **Mock mode:** `./dev.sh --mock` starts only the frontend with mock data (no backend needed).
- **Docs:** `DEVELOPMENT.md` gets a "Run locally" section _(human decision, 2026-10-24: moved there from the root `README.md`, plan 001)_; the frontend/backend READMEs keep their per-app commands.

## Steps

1. Write `dev.sh` (executable).
2. Update `DEVELOPMENT.md`.
3. Check: normal start, `--mock`, port already in use, Ctrl+C stops both, port overrides.

## Open questions

None.
