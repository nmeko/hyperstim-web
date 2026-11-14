#!/usr/bin/env bash
# Set up (or update) the prod instance on this server (plan 010).
#
#   sudo deploy/setup.sh
#
# Reads deploy/server.env (copy deploy/server.env.example and fill it in). Safe to run
# again at any time: it changes only what differs, and says what it changed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
CONFIG="$HERE/server.env"
RELEASE_COMMAND=/usr/local/bin/hyperstim-release

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() {
  echo "setup: $*" >&2
  exit 1
}

[ "$(id -u)" = 0 ] || fail "run it with sudo: sudo deploy/setup.sh"
[ -f "$CONFIG" ] || fail "no deploy/server.env: copy deploy/server.env.example and fill it in."
. "$CONFIG"
VARS="PROD_DIR SERVICE SERVICE_USER PORT RELEASE_GROUP RELEASERS NGINX_SITE CORS_ORIGIN
  YOUTUBE_API_KEY ANALYSIS_LIMIT_PER_IP ANALYSIS_LIMIT_PER_DAY COLLECTOR_CLIPS_DIR COLLECT_PER_DAY
  DATA_USER"
for name in $VARS; do
  value="${!name:-}"
  [ -n "$value" ] || fail "$name is empty in deploy/server.env."
  case "$value" in *"<"*) fail "$name still has a placeholder in deploy/server.env." ;; esac
  export "${name?}"
done
export YTDLP_COOKIES="${YTDLP_COOKIES:-}"
export ALERT_GITHUB_TOKEN="${ALERT_GITHUB_TOKEN:-}"
case "$ALERT_GITHUB_TOKEN" in *"<"*) fail "ALERT_GITHUB_TOKEN still has a placeholder in deploy/server.env (leave it empty for none)." ;; esac
# The repo the alert issues go to: this checkout's origin, as <owner>/<name>.
ALERT_REPO="$(git -C "$ROOT" remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"
export ALERT_REPO
[ -f "$NGINX_SITE" ] || fail "NGINX_SITE: no such file: $NGINX_SITE"
case "$COLLECTOR_CLIPS_DIR" in
  /home/* | /root/* | /run/user/*) fail "COLLECTOR_CLIPS_DIR can't be in a home folder: the collector's sandbox hides them." ;;
  /*) ;;
  *) fail "COLLECTOR_CLIPS_DIR must be an absolute path." ;;
esac
[ -d "$(dirname "$COLLECTOR_CLIPS_DIR")" ] || fail "COLLECTOR_CLIPS_DIR: no such folder: $(dirname "$COLLECTOR_CLIPS_DIR")"

CHANGED=() # what this run changed, for the summary
as_service() { sudo -u "$SERVICE_USER" env HOME="$PROD_DIR/data" PATH="$PROD_DIR/bin:/usr/bin:/bin" "$@"; }
BOT_HOME="$PROD_DIR/data-bot"
as_bot() { sudo -u "$DATA_USER" env HOME="$BOT_HOME" PATH=/usr/bin:/bin "$@"; }

# install_file <template> <target> <mode> <owner:group>: render, and install only if it differs.
install_file() {
  local tmp
  tmp="$(mktemp)"
  envsubst "$(printf '${%s} ' $VARS YTDLP_COOKIES ALERT_GITHUB_TOKEN ALERT_REPO)" <"$HERE/$1" >"$tmp"
  if [ -f "$2" ] && cmp -s "$tmp" "$2"; then
    chmod "$3" "$2" && chown "$4" "$2"
    rm "$tmp"
    return 1
  fi
  install -m "$3" -o "${4%%:*}" -g "${4##*:}" "$tmp" "$2"
  rm "$tmp"
  CHANGED+=("$2")
}

# --- Tools ------------------------------------------------------------------------------

say "Tools (tools.env)"
install -d -m 755 "$PROD_DIR" "$PROD_DIR/bin"
"$ROOT/scripts/install-tools.sh" server "$PROD_DIR/bin"

# --- User, group, folders ---------------------------------------------------------------

say "User, group, folders"
if ! getent passwd "$SERVICE_USER" >/dev/null; then
  useradd --system --home-dir "$PROD_DIR/data" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  CHANGED+=("user $SERVICE_USER")
fi
if ! getent group "$RELEASE_GROUP" >/dev/null; then
  groupadd --system "$RELEASE_GROUP"
  CHANGED+=("group $RELEASE_GROUP")
fi
for login in $RELEASERS; do
  id "$login" >/dev/null 2>&1 || fail "RELEASERS: no user $login on this server."
  if ! id -nG "$login" | tr ' ' '\n' | grep -qx "$RELEASE_GROUP"; then
    usermod -aG "$RELEASE_GROUP" "$login"
    CHANGED+=("$login added to $RELEASE_GROUP (log in again to use it)")
  fi
done
install -d -m 755 -o "$SERVICE_USER" -g "$SERVICE_USER" \
  "$PROD_DIR/repo" "$PROD_DIR/releases" "$PROD_DIR/uv" "$PROD_DIR/data"
install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$PROD_DIR/data/analysis" "$PROD_DIR/data/thumbnails" \
  "$PROD_DIR/data/usage" "$PROD_DIR/data/collector" "$PROD_DIR/data/collector/collected"
install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$COLLECTOR_CLIPS_DIR"
[ -e "$PROD_DIR/releases.log" ] || install -m 644 -o "$SERVICE_USER" -g "$SERVICE_USER" /dev/null "$PROD_DIR/releases.log"

# --- The data bot (plan 013) -------------------------------------------------------------
# Commits the collected dataset to GitHub daily, with a deploy key of the repo. Its own user, so
# the services, which parse downloaded videos, never see the key.

say "Data bot"
if ! getent passwd "$DATA_USER" >/dev/null; then
  useradd --system --home-dir "$BOT_HOME" --no-create-home --shell /usr/sbin/nologin "$DATA_USER"
  CHANGED+=("user $DATA_USER")
fi
[ "$(getent passwd "$DATA_USER" | cut -d: -f6)" = "$BOT_HOME" ] || usermod --home "$BOT_HOME" "$DATA_USER"
install -d -m 700 -o "$DATA_USER" -g "$DATA_USER" "$BOT_HOME" "$BOT_HOME/.ssh"
if [ ! -f "$BOT_HOME/.ssh/id_ed25519" ]; then
  as_bot ssh-keygen -q -t ed25519 -N "" -C "hyperstim data bot" -f "$BOT_HOME/.ssh/id_ed25519"
  CHANGED+=("data bot's SSH key")
fi
# GitHub's published host key (docs.github.com, "GitHub's SSH key fingerprints"):
# SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU
echo "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" |
  install -m 644 -o "$DATA_USER" -g "$DATA_USER" /dev/stdin "$BOT_HOME/.ssh/known_hosts"
DATA_REPO="$PROD_DIR/data-repo"
ssh_url="git@github.com:$(git -C "$ROOT" remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##').git"
if [ ! -e "$DATA_REPO/.git" ]; then
  install -d -m 755 -o "$DATA_USER" -g "$DATA_USER" "$DATA_REPO"
  if as_bot git clone --quiet "$ssh_url" "$DATA_REPO"; then
    CHANGED+=("data bot's clone of $ssh_url")
  else
    BOT_KEY_NEEDED=1
  fi
elif [ "$(as_bot git -C "$DATA_REPO" remote get-url origin)" != "$ssh_url" ]; then
  as_bot git -C "$DATA_REPO" remote set-url origin "$ssh_url"
  CHANGED+=("data bot's origin set to $ssh_url")
fi

# --- Who reads what -----------------------------------------------------------------------
# The release group reads the service's results, usage counts and the collector's state (plan
# 014); the bot reads only the collector's exported files. ACLs, so nobody else gets in; the
# default (d:) entries cover files made later.

say "Read access"
for dir in "$PROD_DIR/data/analysis" "$PROD_DIR/data/usage" "$PROD_DIR/data/collector"; do
  setfacl -R -m "g:$RELEASE_GROUP:rX,d:g:$RELEASE_GROUP:rX" "$dir"
done
setfacl -m "u:$DATA_USER:x" "$PROD_DIR/data/collector"
setfacl -R -m "u:$DATA_USER:rX,d:u:$DATA_USER:rX" "$PROD_DIR/data/collector/collected"

# --- The clone --------------------------------------------------------------------------

say "Clone"
url="https://github.com/$(git -C "$ROOT" remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##').git"
if [ ! -e "$PROD_DIR/repo/.git" ]; then
  as_service git clone --quiet --no-checkout "$url" "$PROD_DIR/repo" ||
    fail "couldn't clone $url (the repo must be public)."
  CHANGED+=("clone of $url")
elif [ "$(as_service git -C "$PROD_DIR/repo" remote get-url origin)" != "$url" ]; then
  as_service git -C "$PROD_DIR/repo" remote set-url origin "$url"
  CHANGED+=("clone's origin set to $url")
fi

# --- Settings and the service -----------------------------------------------------------

say "Settings and systemd"
restart=0
install_file env.template "$PROD_DIR/env" 640 "root:$SERVICE_USER" && restart=1
install_file instance.env.template "$PROD_DIR/instance.env" 644 root:root || true
if install_file service.template "$PROD_DIR/$SERVICE.service" 644 root:root; then
  systemctl daemon-reload
  restart=1
fi
[ -L "/etc/systemd/system/$SERVICE.service" ] || systemctl link --quiet "$PROD_DIR/$SERVICE.service"
systemctl is-enabled --quiet "$SERVICE" || systemctl enable --quiet "$SERVICE"
if [ "$restart" = 1 ] && systemctl is-active --quiet "$SERVICE"; then
  systemctl restart "$SERVICE"
  CHANGED+=("restarted $SERVICE")
fi

# The collector (plan 013): enabled here, started by release.sh (the running release may not
# have it yet). Restarted here only if it's running and its settings changed.
COLLECTOR="$SERVICE-collector"
install_file collector.service.template "$PROD_DIR/$COLLECTOR.service" 644 root:root && restart=1
[ -L "/etc/systemd/system/$COLLECTOR.service" ] || systemctl link --quiet "$PROD_DIR/$COLLECTOR.service"
systemctl daemon-reload
systemctl is-enabled --quiet "$COLLECTOR" || systemctl enable --quiet "$COLLECTOR"
if [ "$restart" = 1 ] && systemctl is-active --quiet "$COLLECTOR"; then
  systemctl restart "$COLLECTOR"
  CHANGED+=("restarted $COLLECTOR")
fi

# The data bot's daily commit: on once its clone exists (that needs the deploy key on GitHub).
for unit in data.service data.timer; do
  install_file "$unit.template" "$PROD_DIR/$SERVICE-$unit" 644 root:root || true
  [ -L "/etc/systemd/system/$SERVICE-$unit" ] || systemctl link --quiet "$PROD_DIR/$SERVICE-$unit"
done
systemctl daemon-reload
if [ -e "$DATA_REPO/.git" ] && ! systemctl is-enabled --quiet "$SERVICE-data.timer"; then
  systemctl enable --now --quiet "$SERVICE-data.timer"
  CHANGED+=("daily commit timer on")
fi

# The hourly alert check (plan 013, decision 12): its token in a root-only file.
install_file alerts.env.template "$PROD_DIR/alerts.env" 600 root:root || true
for unit in alerts.service alerts.timer; do
  install_file "$unit.template" "$PROD_DIR/$SERVICE-$unit" 644 root:root || true
  [ -L "/etc/systemd/system/$SERVICE-$unit" ] || systemctl link --quiet "$PROD_DIR/$SERVICE-$unit"
done
systemctl daemon-reload
if ! systemctl is-enabled --quiet "$SERVICE-alerts.timer"; then
  systemctl enable --now --quiet "$SERVICE-alerts.timer"
  CHANGED+=("alert check timer on")
fi
[ -n "$ALERT_GITHUB_TOKEN" ] || say "No ALERT_GITHUB_TOKEN: the alert check only logs what it would post."

# --- Releasing --------------------------------------------------------------------------

say "Release command and sudo rule"
install_file release-command.template "$RELEASE_COMMAND" 755 root:root || true
tmp="$(mktemp)"
envsubst "$(printf '${%s} ' $VARS)" <"$HERE/sudoers.template" >"$tmp"
visudo -cqf "$tmp" || fail "the rendered sudoers rule doesn't parse."
if ! cmp -s "$tmp" "/etc/sudoers.d/$SERVICE"; then
  install -m 440 -o root -g root "$tmp" "/etc/sudoers.d/$SERVICE"
  CHANGED+=("/etc/sudoers.d/$SERVICE")
fi
rm "$tmp"

# --- nginx ------------------------------------------------------------------------------

say "nginx"
nginx_changed=0
for f in nginx-http nginx-locations nginx-proxy; do
  install_file "$f.conf.template" "$PROD_DIR/$f.conf" 644 root:root && nginx_changed=1
done
if [ ! -L "/etc/nginx/conf.d/$SERVICE.conf" ]; then
  ln -s "$PROD_DIR/nginx-http.conf" "/etc/nginx/conf.d/$SERVICE.conf"
  nginx_changed=1
fi
include="include $PROD_DIR/nginx-locations.conf;"
backup=""
if ! grep -qF "$include" "$NGINX_SITE"; then
  # Into the TLS server block: just before its `listen 443` line.
  grep -q "listen 443" "$NGINX_SITE" || fail "NGINX_SITE has no 'listen 443' line to add the API next to."
  backup="$PROD_DIR/$(basename "$NGINX_SITE").before-setup"
  cp -p "$NGINX_SITE" "$backup"
  sed -i "0,/listen 443/s||# The website's API under /v2/ (deploy/setup.sh)\n    $include\n\n    &|" "$NGINX_SITE"
  CHANGED+=("$NGINX_SITE (backup: $backup)")
  nginx_changed=1
fi
if [ "$nginx_changed" = 1 ]; then
  if ! nginx -t -q; then
    [ -n "$backup" ] && cp -p "$backup" "$NGINX_SITE"
    fail "nginx -t failed; the site file is restored. Fix the templates and run again."
  fi
  systemctl reload nginx
fi

# --- Summary ----------------------------------------------------------------------------

if [ "${#CHANGED[@]}" = 0 ]; then
  say "Nothing to change: the server matches deploy/server.env."
else
  say "Changed:"
  printf '  %s\n' "${CHANGED[@]}"
fi
if [ -n "${BOT_KEY_NEEDED:-}" ]; then
  say "Next: a repo admin adds the data bot's key on GitHub (Settings -> Deploy keys -> Add deploy key,"
  say "\"Allow write access\" on), then run sudo deploy/setup.sh again. The key:"
  cat "$BOT_HOME/.ssh/id_ed25519.pub"
fi
[ -e "$PROD_DIR/releases/current" ] || say "Next: the first release, with hyperstim-release (see the root README)."
