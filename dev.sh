#!/usr/bin/env bash
# Start the backend and the frontend together for local development (plan 003).
#
#   ./dev.sh          backend + frontend, the frontend using the real backend
#   ./dev.sh --mock   frontend only, with mock data
#   ./dev.sh --install-tools   install the pinned system tools (tools.env): ffmpeg, uv, deno, nvm + Node,
#                              and the end-to-end test browsers
#
# Ports: BACKEND_PORT (default 8000), FRONTEND_PORT (default 3000).
# The settings that must match the ports are passed as environment variables and
# override backend/.env and frontend/.env.local for this run; the files are not changed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
MOCK=0

case "${1:-}" in
  "") ;;
  --mock) MOCK=1 ;;
  --install-tools) exec "$ROOT/scripts/install-tools.sh" dev ;;
  -h | --help)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "Unknown option: $1 (try --help)" >&2
    exit 2
    ;;
esac

fail() {
  echo "dev.sh: $*" >&2
  exit 1
}

# The commit-msg hook checks commit messages (AGENTS.md, plan 010).
git -C "$ROOT" config core.hooksPath .githooks

# --- Prerequisites -----------------------------------------------------------

if [ "$MOCK" = 0 ]; then
  # The uv installer puts uv in ~/.local/bin, which is not always on PATH.
  command -v uv >/dev/null || PATH="$HOME/.local/bin:$PATH"
  command -v uv >/dev/null ||
    fail "uv is not installed. See https://docs.astral.sh/uv/getting-started/installation/"
fi

NODE_VERSION="$(cat "$ROOT/frontend/.nvmrc")"
NVM_SH="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
if [ -s "$NVM_SH" ]; then
  # nvm.sh is not written for `set -u`.
  set +u
  # shellcheck source=/dev/null
  . "$NVM_SH"
  nvm use --silent "$NODE_VERSION" >/dev/null ||
    fail "Node $NODE_VERSION is not installed. Run: nvm install $NODE_VERSION"
  set -u
fi
command -v node >/dev/null ||
  fail "Node is not installed. Install nvm (https://github.com/nvm-sh/nvm), then: nvm install $NODE_VERSION"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" = "$NODE_VERSION" ] ||
  fail "Node $NODE_VERSION is required, found $(node -v). Run: nvm install $NODE_VERSION"

port_in_use() {
  (: >"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}
check_port() {
  ! port_in_use "$2" ||
    fail "port $2 ($1) is already in use. Stop whatever is using it, or set ${1}_PORT to another port."
}
check_port FRONTEND "$FRONTEND_PORT"
[ "$MOCK" = 1 ] || check_port BACKEND "$BACKEND_PORT"

# --- Dependencies (only what is missing) ---------------------------------------

if [ "$MOCK" = 0 ]; then
  (cd "$ROOT/backend" && uv sync --quiet)
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "Installing frontend dependencies (npm ci)…"
  (cd "$ROOT/frontend" && npm ci --no-audit --no-fund)
fi

# --- Run -----------------------------------------------------------------------

# Each app runs as its own job (process group), so stopping one stops all of
# its child processes too (uvicorn's reloader, Next.js workers).
set -m
PIDS=""

prefix() {
  while IFS= read -r line; do
    printf '[%s] %s\n' "$1" "$line"
  done
}

cleanup() {
  trap '' INT TERM
  for pid in $PIDS; do
    kill -TERM -- "-$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if [ "$MOCK" = 0 ]; then
  {
    cd "$ROOT/backend"
    env_file=()
    [ -f .env ] && env_file=(--env-file .env)
    DATASET_PATH=data/videos.tsv \
      CORS_ORIGIN="http://localhost:$FRONTEND_PORT" \
      ANALYSIS_DIR=analysis \
      THUMBNAIL_DIR=thumbnails \
      ANALYSIS_LIMIT_PER_IP=0 \
      ANALYSIS_LIMIT_PER_DAY=0 \
      uv run "${env_file[@]+"${env_file[@]}"}" \
      uvicorn --factory hyperstim_api.main:create_app \
      --host 127.0.0.1 --port "$BACKEND_PORT" --reload 2>&1 | prefix backend
  } &
  PIDS="$PIDS $!"
  API_BASE="http://localhost:$BACKEND_PORT"
  API_MOCK=""
else
  API_BASE=""
  API_MOCK=1
fi

{
  cd "$ROOT/frontend"
  NEXT_PUBLIC_API_BASE="$API_BASE" NEXT_PUBLIC_API_MOCK="$API_MOCK" \
    npm run dev -- --port "$FRONTEND_PORT" 2>&1 | prefix frontend
} &
PIDS="$PIDS $!"

echo "Frontend: http://localhost:$FRONTEND_PORT"
if [ "$MOCK" = 0 ]; then
  echo "Backend:  http://localhost:$BACKEND_PORT (API docs at /docs)"
else
  echo "Mock data, no backend."
fi
echo "Press Ctrl+C to stop."

# Stop everything as soon as either app exits (bash 3.2 on macOS has no `wait -n`).
while :; do
  for pid in $PIDS; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "dev.sh: an app stopped; stopping the other." >&2
      exit 1
    fi
  done
  sleep 1
done
