#!/usr/bin/env bash
# Checks that every `data:` commit in a range changes only the collected dataset files
# (plan 013): the server's key can push to main, so a commit claiming to be data mustn't
# carry anything else. Used by CI and release.sh.
#
#   scripts/check-data-commits.sh <from>..<to>
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

ALLOWED="backend/data/collected/"
bad=0
while IFS= read -r hash; do
  [[ "$(git log -1 --format=%s "$hash")" =~ ^data!?: ]] || continue
  while IFS= read -r path; do
    if [[ $path != "$ALLOWED"* ]]; then
      echo "$(git log -1 --format='%h %s' "$hash"): changes $path, outside $ALLOWED" >&2
      bad=1
    fi
  done < <(git diff-tree --no-commit-id --name-only -r "$hash")
done < <(git log --no-merges --format=%H "$range")
exit "$bad"
