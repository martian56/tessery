#!/usr/bin/env bash
set -euo pipefail

DIR="${TESSERY_DIR:-/opt/tessery}"
KEEP="${TESSERY_BACKUP_KEEP:-7}"
OUT="${TESSERY_BACKUP_DIR:-$DIR/backups}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf 'backup.sh: %s\n' "$*" >&2; exit 1; }

cd "$DIR" || fail "no Tessery install in $DIR; set TESSERY_DIR"
[ -f .env ] || fail "$DIR/.env is missing"
set -a
. ./.env
set +a

stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$OUT"

say "Dumping the database"
docker compose exec -T postgres pg_dump -U tessery -d tessery --clean --if-exists --no-owner | gzip -c > "$work/database.sql.gz"

say "Copying project repositories and data"
docker compose exec -T server tar -C /var/lib/tessery -czf - . > "$work/data.tar.gz"

say "Copying uploaded assets"
docker compose exec -T seaweedfs tar -C /data -czf - . > "$work/objects.tar.gz"

cp .env "$work/env"
printf 'created=%s\nimage_tag=%s\ndomain=%s\n' "$stamp" "${TESSERY_IMAGE_TAG:-latest}" "${TESSERY_DOMAIN:-}" > "$work/manifest"

archive="$OUT/tessery-$stamp.tar.gz"
tar -C "$work" -czf "$archive" manifest env database.sql.gz data.tar.gz objects.tar.gz
chmod 600 "$archive"
say "Wrote $archive ($(du -h "$archive" | cut -f1))"

if [ -n "${TESSERY_BACKUP_S3_BUCKET:-}" ]; then
  say "Uploading to s3://$TESSERY_BACKUP_S3_BUCKET"
  docker run --rm \
    -e AWS_ACCESS_KEY_ID="${TESSERY_BACKUP_S3_ACCESS_KEY:?set TESSERY_BACKUP_S3_ACCESS_KEY}" \
    -e AWS_SECRET_ACCESS_KEY="${TESSERY_BACKUP_S3_SECRET_KEY:?set TESSERY_BACKUP_S3_SECRET_KEY}" \
    -e AWS_DEFAULT_REGION="${TESSERY_BACKUP_S3_REGION:-auto}" \
    -v "$OUT:/backups:ro" amazon/aws-cli:2.27.50 \
    ${TESSERY_BACKUP_S3_ENDPOINT:+--endpoint-url "$TESSERY_BACKUP_S3_ENDPOINT"} \
    s3 cp "/backups/$(basename "$archive")" "s3://$TESSERY_BACKUP_S3_BUCKET/$(basename "$archive")" --only-show-errors
fi

ls -1t "$OUT"/tessery-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
say "Done. The archive holds TESSERY_SECRET_KEY; keep it somewhere safe."
