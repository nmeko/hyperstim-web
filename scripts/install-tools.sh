#!/usr/bin/env bash
# Install the pinned system tools in tools.env (plan 010). Skips what is already there.
#
#   scripts/install-tools.sh dev            ffmpeg, uv, deno, nvm + Node, test browsers (./dev.sh --install-tools)
#   scripts/install-tools.sh server <dir>   OS packages, and uv + deno into <dir> (deploy/setup.sh, as root)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/tools.env"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() {
  echo "install-tools: $*" >&2
  exit 1
}

MODE="${1:-}"
case "$MODE" in
  dev) BIN="$HOME/.local/bin" ;;
  server) BIN="${2:?usage: install-tools.sh server <dir>}" ;;
  *) fail "usage: install-tools.sh dev | server <dir>" ;;
esac
SUDO=""
[ "$(id -u)" = 0 ] || SUDO="sudo"

# --- OS packages ----------------------------------------------------------------------

if command -v apt-get >/dev/null; then
  wanted="$APT_PACKAGES"
  [ "$MODE" = server ] && wanted="$wanted $APT_PACKAGES_SERVER"
  missing=""
  for p in $wanted; do
    dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q "install ok installed" || missing="$missing $p"
  done
  if [ -n "$missing" ]; then
    say "Installing OS packages:$missing"
    $SUDO apt-get update -qq
    # shellcheck disable=SC2086
    $SUDO apt-get install -y -qq $missing
  fi
elif [ "$MODE" = dev ] && command -v brew >/dev/null; then
  for p in $BREW_PACKAGES; do
    brew list "$p" >/dev/null 2>&1 || brew install "$p"
  done
else
  [ "$MODE" = dev ] || fail "the server setup needs apt-get (Debian/Ubuntu)."
  echo "No apt-get or Homebrew: install these yourself: $BREW_PACKAGES, curl, unzip" >&2
fi

if ! ffmpeg -version 2>/dev/null | head -n 1 | grep -q "version $FFMPEG_VERSION"; then
  echo "Warning: ffmpeg $FFMPEG_VERSION expected (the dataset's), found: $(ffmpeg -version 2>/dev/null | head -n 1)" >&2
  echo "         Live-analysis features may differ slightly from the dataset's." >&2
fi

# --- uv and deno: pinned release binaries, checked against their published checksums ---

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) TRIPLE=x86_64-unknown-linux-gnu ;;
  Linux-aarch64) TRIPLE=aarch64-unknown-linux-gnu ;;
  Darwin-arm64) TRIPLE=aarch64-apple-darwin ;;
  Darwin-x86_64) TRIPLE=x86_64-apple-darwin ;;
  *) fail "no uv/deno builds for $(uname -s) $(uname -m)" ;;
esac
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

# install_binary <name> <version> <archive url> <checksum url>
install_binary() {
  local name="$1" version="$2" url="$3" sum_url="$4" found tmp
  # Dev: any one on PATH at the right version will do; server: the one in <dir>.
  if [ "$MODE" = dev ]; then found="$(command -v "$name" || true)"; else found="$BIN/$name"; fi
  if [ -x "$found" ] && "$found" --version 2>/dev/null | head -n 1 | grep -qE " $version( |$)"; then
    return
  fi
  say "Installing $name $version into $BIN"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/archive" "$url"
  [ "$(sha256 "$tmp/archive")" = "$(curl -fsSL "$sum_url" | cut -d' ' -f1)" ] || fail "$name: checksum mismatch"
  case "$url" in
    *.zip) unzip -q "$tmp/archive" -d "$tmp/x" ;;
    *) mkdir "$tmp/x" && tar -xzf "$tmp/archive" -C "$tmp/x" ;;
  esac
  mkdir -p "$BIN"
  install -m 755 "$(find "$tmp/x" -type f -name "$name" | head -n 1)" "$BIN/$name"
  rm -rf "$tmp"
}

u="https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$TRIPLE.tar.gz"
install_binary uv "$UV_VERSION" "$u" "$u.sha256"
d="https://github.com/denoland/deno/releases/download/v$DENO_VERSION/deno-$TRIPLE.zip"
install_binary deno "$DENO_VERSION" "$d" "$d.sha256sum"

# --- Node (dev): nvm, then the version in frontend/.nvmrc --------------------------------

if [ "$MODE" = dev ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    say "Installing nvm $NVM_VERSION"
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/v$NVM_VERSION/install.sh" | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  (cd "$ROOT/frontend" && nvm install >/dev/null && echo "Node $(node --version) (frontend/.nvmrc)")

  # The browsers the end-to-end tests run in (plan 012), at the version Playwright's
  # package-lock.json entry expects, with their OS libraries (apt; none needed on macOS).
  say "Installing the end-to-end test browsers (Chromium, WebKit, and the Safari check's WebKit)"
  (
    cd "$ROOT/frontend"
    nvm use --silent
    [ -d node_modules ] || npm ci
    npx playwright install --with-deps chromium webkit
    # The Safari check's own Playwright and WebKit (plan 017), in a browser folder of its own.
    cd e2e/safari
    [ -d node_modules ] || npm ci
    npm run install-browser -- --with-deps
  )
  case ":$PATH:" in
    *":$BIN:"*) ;;
    *) echo "Add $BIN to your PATH (e.g. in ~/.bashrc), then open a new shell." >&2 ;;
  esac
fi

say "Tools ready: uv $UV_VERSION, deno $DENO_VERSION, $(ffmpeg -version 2>/dev/null | head -n 1 | cut -d' ' -f1-3)"
