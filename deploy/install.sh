#!/usr/bin/env bash
set -euo pipefail

DIR="${TESSERY_DIR:-/opt/tessery}"
REF="${TESSERY_REF:-main}"
SOURCE="https://raw.githubusercontent.com/martian56/tessery/${REF}/deploy"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run as root, for example: sudo bash install.sh"
command -v curl >/dev/null || fail "curl is required"

if ! command -v docker >/dev/null; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || fail "the Docker Compose plugin is missing"
systemctl enable --now docker >/dev/null 2>&1 || true

mkdir -p "$DIR"
cd "$DIR"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
for f in compose.yml .env.example; do
  if [ -n "$HERE" ] && [ "$HERE" != "$DIR" ] && [ -f "$HERE/$f" ]; then
    cp "$HERE/$f" "$f"
  elif [ ! -f "$f" ]; then
    curl -fsSL "$SOURCE/$f" -o "$f"
  fi
done

if [ -f .env ]; then
  say "Keeping the existing $DIR/.env"
else
  domain="${TESSERY_DOMAIN:-}"
  while [ -z "$domain" ]; do
    read -rp "Domain for Tessery (its DNS must point at this machine): " domain </dev/tty
  done
  hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
  sed \
    -e "s|^TESSERY_DOMAIN=.*|TESSERY_DOMAIN=${domain}|" \
    -e "s|^TESSERY_SECRET_KEY=.*|TESSERY_SECRET_KEY=$(hex 32)|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(hex 24)|" \
    -e "s|^RABBITMQ_PASSWORD=.*|RABBITMQ_PASSWORD=$(hex 24)|" \
    -e "s|^DOCKER_GID=.*|DOCKER_GID=$(stat -c %g /var/run/docker.sock)|" \
    -e "s|^TESSERY_COMPOSE_DIR=.*|TESSERY_COMPOSE_DIR=${DIR}|" \
    .env.example > .env
  chmod 600 .env
  say "Wrote $DIR/.env. Back it up: TESSERY_SECRET_KEY cannot be recovered."
fi

say "Starting Tessery"
docker network inspect tessery-proxy >/dev/null 2>&1 || docker network create tessery-proxy >/dev/null
docker compose pull
docker compose up -d

say "Waiting for the server"
for _ in $(seq 1 90); do
  if docker compose exec -T server curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
    domain="$(sed -n 's/^TESSERY_DOMAIN=//p' .env)"
    say "Tessery is running at https://${domain}"
    echo "Open it to create the first admin account."
    exit 0
  fi
  sleep 2
done
docker compose ps
fail "the server did not become healthy; check: docker compose -f $DIR/compose.yml logs server"
