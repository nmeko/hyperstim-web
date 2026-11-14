#!/usr/bin/env bash
# The daily commit of the collected dataset (plan 013), run by the server's timer as the data
# bot's user. Copies the collector's exported files into a clone of this repo, commits them
# as a `data:` commit and pushes to main. The site doesn't wait for this: the API reads the
# collector's files directly. This is the public record and a second copy.
#
#   scripts/commit-data.sh <clone> <collected-dir>
#
# <clone> is the bot's own clone (never a dev checkout); its origin must accept the bot's
# deploy key. <collected-dir> is the collector's day-end copy: the files as they stood at the
# end of the last day it closed. The message counts the changelog's days new since the last
# commit, so it equals their rows; with no new day, nothing is committed.
set -euo pipefail

[ $# = 2 ] || {
  echo "usage: $0 <clone> <collected-dir>" >&2
  exit 2
}
CLONE="$1" SOURCE="$2"
DEST="backend/data/collected"
git=(git -C "$CLONE" -c user.name="HyperStim data bot" -c user.email="hyperstim-data-bot@users.noreply.github.com")

files=()
for f in "$SOURCE"/[0-9][0-9][0-9][0-9].tsv "$SOURCE"/{removed.tsv,excluded-channels.tsv,CHANGELOG.tsv,meta.json}; do
  [ -f "$f" ] && files+=("$f")
done
[ ${#files[@]} -gt 0 ] || exit 0
snapshot="$(mktemp -d)"
trap 'rm -rf "$snapshot"' EXIT
cp "${files[@]}" "$snapshot/"

"${git[@]}" fetch --quiet origin main
"${git[@]}" checkout --quiet -B main origin/main

# The changelog's days after the newest one committed: their added and removed videos and new
# channels, and the first and last of them (columns found by name).
newest="$("${git[@]}" show "HEAD:$DEST/CHANGELOG.tsv" 2>/dev/null |
  awk -F'\t' 'NR > 1 && $1 > day { day = $1 } END { print day }')" || true
read -r days added removed new_channels first last < <(
  awk -F'\t' -v after="$newest" '
    NR == 1 { for (i = 1; i <= NF; i++) col[$i] = i; next }
    $1 > after {
      n++; a += $col["added_v"]; r += $col["removed_v"]; c += $col["new_ch"]
      if (first == "" || $1 < first) first = $1
      if ($1 > last) last = $1
    }
    END { print n + 0, a + 0, r + 0, c + 0, first, last }' "$snapshot/CHANGELOG.tsv" 2>/dev/null ||
    echo 0
)
[ "${days:-0}" -gt 0 ] || exit 0

mkdir -p "$CLONE/$DEST"
cp "$snapshot"/* "$CLONE/$DEST/"
# The README's growth chart (plan 013), drawn from the changelog just copied, with the release's
# own Python. If it fails, the data still goes in, with yesterday's chart.
here="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$CLONE/$DEST" && "$here/backend/.venv/bin/python" "$here/backend/scripts/growth_chart.py") ||
  echo "commit-data: couldn't draw the growth chart" >&2
"${git[@]}" add -- "$DEST"
"${git[@]}" diff --cached --quiet && exit 0

plural() { [ "$1" = 1 ] && echo "$1 $2" || echo "$1 ${2}s"; }
subject="data: Add $(plural "$added" video)"
[ "$new_channels" -gt 0 ] && subject+=" and $(plural "$new_channels" channel)"
[ "$removed" -gt 0 ] && subject+=", remove $removed"
if [ "$first" = "$last" ]; then subject+=" ($last)"; else subject+=" ($first to $last)"; fi
"${git[@]}" commit --quiet -m "$subject"

for attempt in 1 2 3; do
  if "${git[@]}" push --quiet origin main; then
    echo "$subject"
    exit 0
  fi
  # Someone pushed meanwhile: only the bot writes these files, so the rebase never conflicts.
  "${git[@]}" fetch --quiet origin main
  "${git[@]}" rebase --quiet origin/main
  sleep $((attempt * 10))
done
echo "commit-data: couldn't push" >&2
exit 1
