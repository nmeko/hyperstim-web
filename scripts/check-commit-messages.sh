#!/usr/bin/env bash
# Checks every commit message in a range with the commit-msg hook (plan 016): PRs are merged
# with "Rebase and merge", so each commit lands as written, and the hook only runs in clones
# where ./dev.sh turned it on. Used by CI.
#
#   scripts/check-commit-messages.sh <from>..<to>
#
# A <from> that isn't a commit (e.g. git's all-zero "no previous commit") checks <to> alone.
set -euo pipefail

[ $# = 1 ] || {
  echo "usage: $0 <from>..<to>" >&2
  exit 2
}
from="${1%%..*}" to="${1#*..}"
range="$from..$to"
git rev-parse --verify --quiet "$from^{commit}" >/dev/null || range="$to^!"

hook="$(dirname "$0")/../.githooks/commit-msg"
message="$(mktemp)"
trap 'rm -f "$message"' EXIT
bad=0
while IFS= read -r hash; do
  git log -1 --format=%B "$hash" >"$message"
  if ! "$hook" "$message" 2>/dev/null; then
    echo "$(git log -1 --format='%h %s' "$hash"): not \"<type>[!]: <subject>\"" >&2
    bad=1
  fi
done < <(git log --no-merges --format=%H "$range")
if [ "$bad" = 1 ]; then
  echo "Commit messages: see \"Commit messages\" in DEVELOPMENT.md; fix them with git rebase." >&2
fi
exit "$bad"
