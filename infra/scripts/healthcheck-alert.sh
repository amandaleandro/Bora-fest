#!/usr/bin/env bash
# Alerta de disponibilidade (arquitetura §16 — sem Sentry/Prometheus ainda,
# isso cobre o mínimo: "a API caiu e alguém precisa saber").
#
# Consulta $HEALTH_URL (default: https://$API_DOMAIN/health) e dispara um
# POST em $WEBHOOK_URL (compatível com Slack/Discord incoming webhook — o
# payload {"text": "..."} funciona nos dois) quando:
#   - a requisição falha (API fora do ar / timeout), ou
#   - o corpo não tem "status":"ok", ou
#   - "db":"up" não aparece na resposta (banco fora do ar por trás da API).
#
# Não alerta de novo a cada execução enquanto o problema persiste: só quando
# o estado muda (down->up ou up->down), via um arquivo de estado local
# ($STATE_FILE) — evita spam de alerta a cada 1-2min de cron.
#
# Cron sugerido (a cada 2 min):
#   */2 * * * * cd /caminho/do/repo && WEBHOOK_URL=... infra/scripts/healthcheck-alert.sh >> /var/log/borafest-healthcheck.log 2>&1

set -euo pipefail

HEALTH_URL="${HEALTH_URL:-https://${API_DOMAIN:-localhost:3333}/health}"
STATE_FILE="${STATE_FILE:-/tmp/borafest-healthcheck.state}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-5}"

BODY="$(curl -fsS --max-time "$TIMEOUT_SECONDS" "$HEALTH_URL" 2>/dev/null || true)"

if echo "$BODY" | grep -q '"status":"ok"' && echo "$BODY" | grep -q '"db":"up"'; then
  NEW_STATE="up"
else
  NEW_STATE="down"
fi

PREV_STATE="$(cat "$STATE_FILE" 2>/dev/null || echo "unknown")"

if [ "$NEW_STATE" = "$PREV_STATE" ]; then
  echo "[healthcheck] $HEALTH_URL segue $NEW_STATE — sem mudança, sem alerta."
  exit 0
fi

echo "$NEW_STATE" > "$STATE_FILE"

if [ "$NEW_STATE" = "down" ]; then
  MESSAGE="🔴 BoraFest: $HEALTH_URL fora do ar ou com erro (resposta: ${BODY:-<sem resposta>})"
else
  MESSAGE="🟢 BoraFest: $HEALTH_URL voltou a responder normalmente"
fi

echo "[healthcheck] mudança de estado: $PREV_STATE -> $NEW_STATE"

if [ -n "${WEBHOOK_URL:-}" ]; then
  curl -fsS --max-time "$TIMEOUT_SECONDS" -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"$MESSAGE\"}" \
    || echo "[healthcheck] falha ao enviar o alerta pro webhook (verifique WEBHOOK_URL)"
else
  echo "[healthcheck] WEBHOOK_URL não configurado — só logando: $MESSAGE"
fi
