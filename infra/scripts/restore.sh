#!/usr/bin/env bash
# Restauração do Postgres de produção a partir de um backup gerado por backup.sh.
# Uso: infra/scripts/restore.sh backups/borafest-2026-07-23_030000.sql.gz
#
# ATENÇÃO: isso APAGA o banco atual (dropdb + createdb) antes de restaurar.
# Rode primeiro contra um ambiente de teste (ver restore-drill abaixo) antes
# de confiar cegamente num backup em produção.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
COMPOSE_FILE="$REPO_ROOT/infra/docker/docker-compose.prod.yml"

BACKUP_FILE="${1:?Uso: $0 <arquivo.sql.gz>}"
if [ ! -f "$BACKUP_FILE" ]; then
  echo "[restore] arquivo não encontrado: $BACKUP_FILE" >&2
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${POSTGRES_USER:?POSTGRES_USER não definido (verifique $ENV_FILE)}"
: "${POSTGRES_DB:=borafest}"

read -r -p "Isso vai APAGAR o banco '$POSTGRES_DB' e restaurar de $BACKUP_FILE. Confirma? (digite 'sim'): " CONFIRM
if [ "$CONFIRM" != "sim" ]; then
  echo "[restore] cancelado."
  exit 1
fi

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop api worker

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\";"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE \"$POSTGRES_DB\";"

gunzip -c "$BACKUP_FILE" | docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "[restore] OK, banco restaurado de $BACKUP_FILE."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" start api worker
