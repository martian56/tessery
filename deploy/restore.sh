#!/usr/bin/env bash
set -euo pipefail

DIR="${TESSERY_DIR:-/opt/tessery}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf 'restore.sh: %s\n' "$*" >&2; exit 1; }

archive="${1:-}"
[ -n "$archive" ] && [ -f "$archive" ] || fail "usage: restore.sh /path/to/tessery-<date>.tar.gz"
archive=$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")
cd "$DIR" || fail "no Tessery install in $DIR; run install.sh first or set TESSERY_DIR"
[ -f compose.yml ] || fail "$DIR/compose.yml is missing; run install.sh first"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tar -C "$work" -xzf "$archive"
chmod 755 "$work"
chmod 644 "$work"/*
for f in manifest env database.sql.gz data.tar.gz; do
  [ -f "$work/$f" ] || fail "$archive is not a Tessery backup ($f is missing)"
done
grep '^created=' "$work/manifest" | sed 's/^created=/Backup from /'

if [ "${TESSERY_RESTORE_YES:-}" != "1" ]; then
  read -rp "This replaces everything in $DIR with the backup. Type restore to continue: " answer </dev/tty
  [ "$answer" = restore ] || fail "nothing was changed"
fi

if [ -f .env ]; then
  cp .env ".env.before-restore"
fi
cp "$work/env" .env
chmod 600 .env

say "Stopping Tessery"
docker compose stop server worker >/dev/null 2>&1 || true
docker network inspect tessery-proxy >/dev/null 2>&1 || docker network create tessery-proxy >/dev/null
docker compose up -d --wait postgres redis rabbitmq

say "Restoring the database"
gunzip -c "$work/database.sql.gz" | docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U tessery -d tessery >/dev/null

say "Restoring project repositories and data"
docker compose run --rm --no-deps -T --entrypoint sh -v "$work:/restore:ro" server -c 'tar -tzf /restore/data.tar.gz >/dev/null && find /var/lib/tessery -mindepth 1 -delete && tar -C /var/lib/tessery -xzf /restore/data.tar.gz'

say "Starting Tessery"
docker compose up -d
for _ in $(seq 1 90); do
  if docker compose exec -T server curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
    say "Restored. Tessery is running at https://$(sed -n 's/^TESSERY_DOMAIN=//p' .env)"
    exit 0
  fi
  sleep 2
done
fail "the server did not become healthy; check: docker compose -f $DIR/compose.yml logs server"
