#!/usr/bin/env bash
# Backup do Postgres de produção (arquitetura §15).
# Uso (no host, via cron): infra/scripts/backup.sh
# Lê as mesmas envs do docker-compose.prod.yml (.env.production).
#
# Cron sugerido (diário às 3h, retendo 14 dias):
#   0 3 * * * cd /caminho/do/repo && infra/scripts/backup.sh >> /var/log/borafest-backup.log 2>&1

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="$REPO_ROOT/infra/docker/docker-compose.prod.yml"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${POSTGRES_USER:?POSTGRES_USER não definido (verifique $ENV_FILE)}"
: "${POSTGRES_DB:=borafest}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%F_%H%M%S)"
OUT_FILE="$BACKUP_DIR/borafest-$STAMP.sql.gz"
TMP_FILE="$OUT_FILE.part"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$TMP_FILE"

# só promove pro nome final se o dump saiu inteiro (evita backup truncado por falha no meio)
mv "$TMP_FILE" "$OUT_FILE"
echo "[backup] OK: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

find "$BACKUP_DIR" -name 'borafest-*.sql.gz' -mtime "+$RETENTION_DAYS" -print -delete
