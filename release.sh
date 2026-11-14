#!/usr/bin/env bash
# Release to prod (plan 010): the backend first, then the tag that deploys the frontend.
#
#   hyperstim-release          release the latest main on GitHub
#   hyperstim-release <ref>    release an older commit or tag of main (a rollback), under the next patch version
#
# On the server, run it as `hyperstim-release` (installed by deploy/setup.sh) from any clone
# of this repo. Needs: membership in the release group, and push access to GitHub.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

case "${1:-}" in
  -h | --help)
    sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  -*)
    echo "Unknown option: $1 (try --help)" >&2
    exit 2
    ;;
esac
TARGET="${1:-origin/main}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() {
  echo "release: $*" >&2
  exit 1
}

# --- Settings -------------------------------------------------------------------------

[ -n "${PROD_DIR:-}" ] || fail "run it as hyperstim-release (set up by deploy/setup.sh)."
[ -f "$PROD_DIR/instance.env" ] || fail "no $PROD_DIR/instance.env: is PROD_DIR right?"
. "$PROD_DIR/instance.env"
for name in SERVICE_USER SERVICE PORT; do
  [ -n "${!name:-}" ] || fail "$name is not set in $PROD_DIR/instance.env."
done

REPO="$(git -C "$ROOT" remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"
WHO="$(id -un)"

# One release at a time.
exec 9<"$PROD_DIR/instance.env"
flock -n 9 || fail "another release is running."

# As the service user, with the instance's own uv and deno.
# From the instance's folder: the service user can't read the clone this runs in.
as_service() {
  cd "$PROD_DIR" && sudo -n -u "$SERVICE_USER" env \
    HOME="$PROD_DIR/data" \
    PATH="$PROD_DIR/bin:/usr/bin:/bin" \
    UV_PYTHON_INSTALL_DIR="$PROD_DIR/uv/python" \
    UV_CACHE_DIR="$PROD_DIR/uv/cache" \
    "$@"
}

log() { echo "$(date -Is) $WHO $1 ${COMMIT:0:12} $2" | as_service tee -a "$PROD_DIR/releases.log" >/dev/null; }

# GitHub's API, read without a login once the repo is public (GITHUB_TOKEN works before).
github() {
  local auth=()
  [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  curl -fsSL "${auth[@]+"${auth[@]}"}" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO/$1"
}

# Prints one field from GitHub's JSON on stdin, by a Python expression over `d`.
json() { as_service uv run --no-project --quiet python -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

# --- What to release --------------------------------------------------------------------

git -C "$ROOT" fetch --quiet --tags origin || fail "couldn't fetch from GitHub: check your GitHub login in this shell."
COMMIT="$(git -C "$ROOT" rev-parse --verify --quiet "$TARGET^{commit}")" || fail "unknown commit or tag: $TARGET"
git -C "$ROOT" merge-base --is-ancestor "$COMMIT" origin/main || fail "$TARGET is not on main."

# The highest version tag vX.Y.Z. (A major under 1000 skips the old date tags, vYYYY.MM.DD, that
# a clone may still have: they were renamed to versions.)
versions() { grep -E '^v[0-9]{1,3}\.[0-9]+\.[0-9]+$' | sort -V || true; }
LATEST="$(git -C "$ROOT" tag -l 'v*' | versions | tail -n 1)"
[ -n "$LATEST" ] || fail "no release tag vX.Y.Z found."
[ "$(git -C "$ROOT" rev-parse "$LATEST^{commit}")" != "$COMMIT" ] ||
  fail "$(git -C "$ROOT" log -1 --format='%h %s' "$COMMIT") is already the latest release ($LATEST)."

# The bump and the release notes come from the commit messages since the latest release (plan 010).
# A rollback (a commit the latest release already has) is a patch.
if git -C "$ROOT" merge-base --is-ancestor "$COMMIT" "$LATEST"; then
  was="$(git -C "$ROOT" tag --points-at "$COMMIT" -l 'v*' | versions | tail -n 1)"
  BUMP=patch
  NOTES="Roll back to ${was:-$(git -C "$ROOT" rev-parse --short "$COMMIT")}."
else
  # The daily data commits (plan 013) may only touch the dataset files.
  (cd "$ROOT" && scripts/check-data-commits.sh "$LATEST..$COMMIT") ||
    fail "a data: commit since $LATEST changes more than the dataset files (above)."
  out="$(cd "$ROOT" && scripts/release-notes.sh "$LATEST..$COMMIT")"
  BUMP="${out%%$'\n'*}"
  NOTES="${out#*$'\n'}"
  [ "$BUMP" != none ] ||
    fail "only data: commits since $LATEST: nothing to release (the site already serves new videos)."
fi
IFS=. read -r major minor patch <<<"${LATEST#v}"
case "$BUMP" in
  major) TAG="v$((major + 1)).0.0" ;;
  minor) TAG="v$major.$((minor + 1)).0" ;;
  *) TAG="v$major.$minor.$((patch + 1))" ;;
esac

say "Releasing $(git -C "$ROOT" log -1 --format='%h %s' "$COMMIT") as $TAG ($BUMP after $LATEST)"
printf '%s\n\n' "$NOTES"

# CI (ci.yml) must have passed on the commit: all four jobs, including the end-to-end tests and
# SonarQube's quality gate (plan 012).
checks="$(github "commits/$COMMIT/check-runs?per_page=100")" ||
  fail "couldn't read CI results from GitHub (a private repo needs GITHUB_TOKEN)."
ci="$(json "' '.join(sorted(r['name'] + '=' + (r['conclusion'] or r['status']) for r in d['check_runs'] if r['name'] in ('frontend', 'backend', 'e2e', 'sonar')))" <<<"$checks")"
[ "$ci" = "backend=success e2e=success frontend=success sonar=success" ] ||
  fail "CI hasn't passed on this commit: ${ci:-no results yet}."

# --- Backend ----------------------------------------------------------------------------
# Each release gets its own checkout (a worktree of the instance's repo) with its own .venv;
# `releases/current` points at the live one. So testing a release never touches the running service,
# and going back is pointing `current` back.

KEEP=5 # releases kept, the live one included
REL="$PROD_DIR/releases"
PREVIOUS="$(as_service readlink "$REL/current" || true)"

point_current_at() {
  as_service ln -sfn "$1" "$REL/current.new"
  as_service mv -T "$REL/current.new" "$REL/current"
}

healthy() {
  for _ in $(seq 30); do
    curl -fs -o /dev/null "http://127.0.0.1:$PORT/api/health" && return 0 # quiet while it starts
    sleep 1
  done
  return 1
}

say "Backend: checking out and testing in releases/$TAG"
as_service git -C "$PROD_DIR/repo" fetch --quiet --tags origin
as_service git -C "$PROD_DIR/repo" worktree add --quiet --detach "$REL/$TAG" "$COMMIT"
if ! as_service uv --directory "$REL/$TAG/backend" sync --locked --quiet ||
  ! as_service uv --directory "$REL/$TAG/backend" run --locked pytest -q -p no:cacheprovider; then
  as_service git -C "$PROD_DIR/repo" worktree remove --force "$REL/$TAG"
  log "$TAG" "tests-failed"
  fail "backend install or tests failed; the running service is unchanged and no tag was pushed."
fi

say "Backend: switching to $TAG and restarting $SERVICE"
point_current_at "$TAG"
sudo -n systemctl restart "$SERVICE"
if ! healthy; then
  [ -n "$PREVIOUS" ] || fail "the first backend didn't answer /api/health: check journalctl -u $SERVICE"
  point_current_at "$PREVIOUS"
  sudo -n systemctl restart "$SERVICE"
  if healthy; then back="back on $PREVIOUS"; else back="STILL UNHEALTHY on $PREVIOUS: check journalctl -u $SERVICE"; fi
  log "$TAG" "unhealthy"
  fail "the new backend didn't answer /api/health; $back. No tag was pushed."
fi

# The collector (plan 013) runs the same release. If it doesn't stay up, the API release stands.
say "Backend: restarting $SERVICE-collector"
sudo -n systemctl restart "$SERVICE-collector"
sleep 10
if ! systemctl is-active --quiet "$SERVICE-collector"; then
  log "$TAG" "collector-failed"
  echo "release: the collector didn't stay up (the API is fine; carrying on): journalctl -u $SERVICE-collector" >&2
fi

# Keep the newest releases, by when they were checked out (a worktree's .git file is written once),
# not by name: the checkouts from before the versions are named by date.
for old in $(as_service sh -c 'stat -c "%Y %n" "$1"/v*/.git' sh "$REL" | sort -n | head -n "-$KEEP" | cut -d' ' -f2-); do
  old="$(basename "$(dirname "$old")")"
  [ "$old" = "$(as_service readlink "$REL/current")" ] ||
    as_service git -C "$PROD_DIR/repo" worktree remove --force "$REL/$old"
done

# --- Frontend ---------------------------------------------------------------------------

say "Frontend: pushing $TAG (starts the Pages deploy)"
# The notes are the tag's message; the Release page workflow shows them on GitHub.
git -C "$ROOT" tag -a --cleanup=whitespace -F - "$TAG" "$COMMIT" <<<"$NOTES"
if ! git -C "$ROOT" push --quiet origin "refs/tags/$TAG"; then
  log "$TAG" "push-failed"
  fail "the backend is live, but pushing $TAG failed; push it to deploy the frontend: git push origin $TAG"
fi
log "$TAG" "backend-live"

say "Frontend: waiting for the deploy"
for _ in $(seq 90); do
  sleep 10
  runs="$(github "actions/workflows/deploy.yml/runs?event=push&branch=$TAG")" || continue
  state="$(json "(lambda r: r['status'] + ' ' + str(r['conclusion']) + ' ' + r['html_url'])(d['workflow_runs'][0]) if d['workflow_runs'] else ''" <<<"$runs")"
  case "$state" in
    "completed success "*)
      log "$TAG" "done"
      owner="${REPO%%/*}"
      site="https://${owner,,}.github.io/${REPO#*/}/"
      # Where it ends up: the owner's Pages may redirect to a custom domain.
      site="$(curl -fsSL -o /dev/null -w '%{url_effective}' "$site" || echo "$site")"
      say "Released $TAG: $site"
      exit 0
      ;;
    completed*)
      log "$TAG" "frontend-failed"
      fail "the frontend deploy failed: ${state##* } (the backend is live; fix and release again)."
      ;;
  esac
done
fail "the frontend deploy is still running after 15 minutes; see https://github.com/$REPO/actions"
