#!/usr/bin/env bash
# =============================================================================
# BACKUP AUTOMÁTICO DA BORAFEST — serviço `pg-backup` do docker-compose.yml da
# raiz (o que o EasyPanel sobe). Revisão 2026-10-12.
#
# O que mudou em relação ao laço antigo (que ficava escrito dentro do compose):
#   1. Também guarda os banners/flyers (volume borafest_uploads), que antes não
#      tinham backup nenhum.
#   2. Criptografa os arquivos (AES-256, openssl -pbkdf2) quando existe
#      BACKUP_ENCRYPTION_PASSPHRASE. O dump tem dados pessoais (CPF, e-mail)
#      e as chaves dos eventos que assinam os QR. Sem a variável: avisa no
#      log e segue sem criptografia, como era antes.
#   3. Manda uma cópia para fora do servidor (S3, Backblaze B2, Cloudflare R2,
#      Wasabi...) quando as variáveis BACKUP_S3_* existem. Só envia arquivo
#      criptografado: sem senha, não envia.
#   4. Confere se o dump terminou inteiro (o laço antigo dizia "ok" mesmo com
#      o pg_dump falhando, porque só olhava o gzip).
#   5. Avisa num webhook (Slack/Discord) quando qualquer passo falha, se
#      BACKUP_ALERT_WEBHOOK_URL existir.
#   6. Respeita 1 backup a cada 24 h mesmo com vários deploys no dia (antes
#      cada deploy gerava um dump a mais).
#
# -----------------------------------------------------------------------------
# O QUE O ARTHUR CONFIGURA (Environment do serviço Compose no EasyPanel)
# -----------------------------------------------------------------------------
#   BACKUP_ENCRYPTION_PASSPHRASE  senha longa (40+ letras e números, sem $ nem
#                                 aspas). GUARDE FORA DO SERVIDOR (gerenciador
#                                 de senhas). Sem ela nenhum backup abre.
#   BACKUP_S3_BUCKET              nome do bucket (liga o envio para fora)
#   BACKUP_S3_ACCESS_KEY_ID       chave de acesso (de preferência só escrita)
#   BACKUP_S3_SECRET_ACCESS_KEY   segredo da chave
#   BACKUP_S3_ENDPOINT            endpoint S3 do provedor. Vazio = AWS.
#                                 B2: https://s3.<regiao>.backblazeb2.com
#                                 R2: https://<conta>.r2.cloudflarestorage.com
#   BACKUP_S3_REGION              região (AWS/B2 exigem; R2 usa "auto")
#   BACKUP_S3_PROVIDER            Other (padrão) | AWS | Cloudflare | Wasabi
#   BACKUP_S3_PREFIX              pasta dentro do bucket (padrão: borafest)
#   BACKUP_ALERT_WEBHOOK_URL      webhook Slack/Discord para avisar falha
#   BACKUP_RETENTION_DAYS         dias guardados NO SERVIDOR (padrão 14)
#
# No bucket, crie uma regra de ciclo de vida (ex.: apagar após 30 dias). O
# script não apaga nada lá fora de propósito: assim a chave pode ser "só
# escrita" e quem invadir o servidor não consegue apagar as cópias externas.
#
# -----------------------------------------------------------------------------
# FERRAMENTAS
# -----------------------------------------------------------------------------
# A imagem postgres:16-alpine traz pg_dump, gzip, tar, find e wget, mas não
# traz openssl nem rclone. Quando a configuração pede, o script instala com
# `apk add` (precisa de internet no servidor). Se a instalação falhar:
#   - sem openssl: o backup local continua (sem criptografia) e NÃO é enviado
#     para fora; o aviso vai pro log e pro webhook;
#   - sem rclone: o backup local continua; o envio falha com aviso.
# A instalação é tentada de novo a cada ciclo.
#
# -----------------------------------------------------------------------------
# USO
# -----------------------------------------------------------------------------
#   (automático) o compose roda: bash /opt/borafest/scripts/pg-backup.sh
#   backup na hora, antes de uma mudança arriscada (console do pg-backup):
#     bash /opt/borafest/scripts/pg-backup.sh --uma-vez
#   ensaiar a restauração: bash /opt/borafest/scripts/restore-drill.sh
#   abrir um arquivo criptografado em qualquer máquina com OpenSSL 1.1.1+:
#     openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in ARQ.sql.gz.enc -out ARQ.sql.gz
#   Detalhes: infra/scripts/README.md
# =============================================================================

set -uo pipefail
# sem `set -e` de propósito: um ciclo com falha não pode matar o laço

BACKUP_DIR="${BACKUP_DIR:-/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"
RETENCAO_DIAS="${BACKUP_RETENTION_DAYS:-14}"
INTERVALO_SEGUNDOS="${BACKUP_INTERVAL_SECONDS:-86400}"
S3_PREFIXO="${BACKUP_S3_PREFIX:-borafest}"
PG_HOST="${PGHOST:-postgres}"
PG_USER="${PGUSER:-borafest}"
PG_DB="${PGDATABASE:-borafest}"
# MESMO número no restore-drill.sh e no README — mudou aqui, muda lá
PBKDF2_ITER=200000

log() { echo "[pg-backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
erro() { echo "[pg-backup] $(date '+%Y-%m-%d %H:%M:%S') ERRO: $*" >&2; }

alertar() {
  local mensagem="$1"
  [ -n "${BACKUP_ALERT_WEBHOOK_URL:-}" ] || return 0
  # sem aspas nem barras na mensagem para não quebrar o JSON
  mensagem="$(printf '%s' "$mensagem" | tr -d '"\\' | tr '\n\r\t' '   ')"
  wget -q -T 15 -O /dev/null \
    --header 'Content-Type: application/json' \
    --post-data "{\"text\": \"BoraFest backup: ${mensagem}\", \"content\": \"BoraFest backup: ${mensagem}\"}" \
    "$BACKUP_ALERT_WEBHOOK_URL" 2>/dev/null \
    || erro "não consegui avisar no webhook (confira BACKUP_ALERT_WEBHOOK_URL)"
}

# instala $1 (comando) via apk (pacote $2) se ainda não existir
garantir_ferramenta() {
  command -v "$1" >/dev/null 2>&1 && return 0
  log "instalando $2 (a imagem não traz $1)…"
  apk add --no-cache "$2" >/dev/null 2>&1 || true
  command -v "$1" >/dev/null 2>&1
}

cifrar() {
  openssl enc -aes-256-cbc -pbkdf2 -iter "$PBKDF2_ITER" -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE
}

decifrar() {
  openssl enc -d -aes-256-cbc -pbkdf2 -iter "$PBKDF2_ITER" -pass env:BACKUP_ENCRYPTION_PASSPHRASE
}

# imprime o conteúdo gzip "cru" de um arquivo (decifra se terminar em .enc)
abrir_gz() {
  case "$1" in
    *.enc) decifrar < "$1" ;;
    *) cat "$1" ;;
  esac
}

CRIPTOGRAFAR=0
ENVIAR=0

# decide, a cada ciclo, se dá para criptografar e enviar
preparar_ciclo() {
  CRIPTOGRAFAR=0
  ENVIAR=0

  if [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
    if garantir_ferramenta openssl openssl; then
      CRIPTOGRAFAR=1
    else
      erro "BACKUP_ENCRYPTION_PASSPHRASE definida, mas o openssl não pôde ser instalado — backup local SEM criptografia e SEM envio para fora neste ciclo"
      alertar "openssl indisponível no pg-backup: backup ficou sem criptografia e não foi enviado para fora do servidor"
    fi
  else
    log "AVISO: BACKUP_ENCRYPTION_PASSPHRASE não definida — backup SEM criptografia (como antes). O dump tem dados pessoais (CPF, e-mail) e as chaves dos eventos."
  fi

  if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
    if [ -z "${BACKUP_S3_ACCESS_KEY_ID:-}" ] || [ -z "${BACKUP_S3_SECRET_ACCESS_KEY:-}" ]; then
      erro "BACKUP_S3_BUCKET definido sem BACKUP_S3_ACCESS_KEY_ID/BACKUP_S3_SECRET_ACCESS_KEY — envio para fora desligado"
      alertar "variáveis do bucket incompletas: cópia para fora do servidor desligada"
    elif [ "$CRIPTOGRAFAR" != 1 ]; then
      erro "envio para fora desligado: só mando backup criptografado (defina BACKUP_ENCRYPTION_PASSPHRASE)"
      alertar "cópia para fora do servidor desligada porque o backup não está criptografado"
    elif garantir_ferramenta rclone rclone; then
      ENVIAR=1
    else
      erro "rclone não pôde ser instalado — backup ficou só no servidor neste ciclo"
      alertar "rclone indisponível: backup ficou só no servidor"
    fi
  fi
}

# envia $1 para o bucket; segredos vão por variável de ambiente (não aparecem no ps)
enviar_para_fora() {
  local arquivo="$1" nome
  nome="$(basename "$arquivo")"
  RCLONE_S3_PROVIDER="${BACKUP_S3_PROVIDER:-Other}" \
  RCLONE_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}" \
  RCLONE_S3_REGION="${BACKUP_S3_REGION:-}" \
  RCLONE_S3_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
  RCLONE_S3_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
  RCLONE_S3_ENV_AUTH=false \
  RCLONE_S3_NO_CHECK_BUCKET=true \
    rclone copyto --retries 3 --low-level-retries 5 --stats 0 \
      "$arquivo" ":s3:${BACKUP_S3_BUCKET}/${S3_PREFIXO}/${nome}"
}

# um ciclo completo; devolve 0 se tudo deu certo
fazer_backup() {
  local ts sufixo falhas=0 destino parcial
  ts="$(date +%Y%m%d-%H%M%S)"
  preparar_ciclo
  sufixo=""
  [ "$CRIPTOGRAFAR" = 1 ] && sufixo=".enc"
  mkdir -p "$BACKUP_DIR"

  # --- banco -----------------------------------------------------------------
  destino="$BACKUP_DIR/borafest-db-$ts.sql.gz$sufixo"
  parcial="$BACKUP_DIR/parcial-borafest-db-$ts.sql.gz$sufixo"
  local dump_ok=0
  if [ "$CRIPTOGRAFAR" = 1 ]; then
    pg_dump -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" --no-password | gzip | cifrar > "$parcial" && dump_ok=1
  else
    pg_dump -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" --no-password | gzip > "$parcial" && dump_ok=1
  fi
  # confere o FIM do dump (o pg_dump escreve "dump complete" só se terminou);
  # grep sem -q de propósito: lê tudo e não provoca SIGPIPE no pipefail
  if [ "$dump_ok" = 1 ] && abrir_gz "$parcial" | gunzip -c | tail -n 20 | grep 'PostgreSQL database dump complete' > /dev/null; then
    mv "$parcial" "$destino"
    log "banco ok: $(basename "$destino") ($(du -h "$destino" | cut -f1))"
    if [ "$ENVIAR" = 1 ]; then
      if enviar_para_fora "$destino"; then
        log "banco enviado para fora: ${BACKUP_S3_BUCKET}/${S3_PREFIXO}/$(basename "$destino")"
      else
        erro "envio do dump para fora FALHOU"
        falhas=$((falhas + 1))
      fi
    fi
  else
    erro "DUMP DO BANCO FALHOU ($ts) — investigar!"
    rm -f "$parcial"
    falhas=$((falhas + 1))
  fi

  # --- uploads (banners/flyers) -------------------------------------------------
  if [ -d "$UPLOADS_DIR" ]; then
    local n_arquivos
    n_arquivos="$(find "$UPLOADS_DIR" -type f | wc -l | tr -d ' ')"
    destino="$BACKUP_DIR/borafest-uploads-$ts.tar.gz$sufixo"
    parcial="$BACKUP_DIR/parcial-borafest-uploads-$ts.tar.gz$sufixo"
    local up_ok=0
    if [ "$CRIPTOGRAFAR" = 1 ]; then
      tar -C "$UPLOADS_DIR" -czf - . | cifrar > "$parcial" && up_ok=1
    else
      tar -C "$UPLOADS_DIR" -czf - . > "$parcial" && up_ok=1
    fi
    if [ "$up_ok" = 1 ] && abrir_gz "$parcial" | tar -tzf - > /dev/null; then
      mv "$parcial" "$destino"
      log "uploads ok: $(basename "$destino") ($n_arquivos arquivos, $(du -h "$destino" | cut -f1))"
      if [ "$ENVIAR" = 1 ]; then
        if enviar_para_fora "$destino"; then
          log "uploads enviados para fora: ${BACKUP_S3_BUCKET}/${S3_PREFIXO}/$(basename "$destino")"
        else
          erro "envio dos uploads para fora FALHOU"
          falhas=$((falhas + 1))
        fi
      fi
    else
      erro "BACKUP DOS UPLOADS FALHOU ($ts)"
      rm -f "$parcial"
      falhas=$((falhas + 1))
    fi
  else
    erro "pasta de uploads $UPLOADS_DIR não está montada — banners/flyers SEM backup (confira o volume borafest_uploads no pg-backup)"
    falhas=$((falhas + 1))
  fi

  # --- retenção no servidor ------------------------------------------------------
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'borafest-*' -mtime "+$RETENCAO_DIAS" -print -delete \
    | sed 's/^/[pg-backup] removido por idade: /'
  # sobras de ciclo interrompido (deploy no meio do dump)
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'parcial-*' -mmin +1440 -delete

  if [ "$falhas" -gt 0 ]; then
    alertar "$falhas passo(s) falharam no ciclo $ts — veja o log do serviço pg-backup no EasyPanel"
    return 1
  fi
  return 0
}

# segundos desde o último dump do banco que deu certo (vazio se não há)
idade_do_ultimo_dump() {
  local ultimo
  ultimo="$(ls -1t "$BACKUP_DIR"/borafest-db-* 2>/dev/null | head -n 1)"
  [ -n "$ultimo" ] || return 0
  echo $(( $(date +%s) - $(stat -c %Y "$ultimo") ))
}

if [ "${1:-}" = "--uma-vez" ]; then
  fazer_backup
  exit $?
fi

# PID 1 do contêiner: sem trap, o SIGTERM do deploy é ignorado e o Docker
# espera 10 s para matar; o `sleep & wait` deixa o trap agir na hora
trap 'log "encerrando (sinal recebido)"; exit 0' TERM INT

log "iniciado: banco $PG_DB@$PG_HOST, uploads em $UPLOADS_DIR, guarda $RETENCAO_DIAS dias, a cada $INTERVALO_SEGUNDOS s"

idade="$(idade_do_ultimo_dump)"
if [ -n "$idade" ] && [ "$idade" -lt "$INTERVALO_SEGUNDOS" ]; then
  espera=$((INTERVALO_SEGUNDOS - idade))
  log "último dump tem $((idade / 3600)) h $((idade % 3600 / 60)) min — próximo em $((espera / 3600)) h $((espera % 3600 / 60)) min (use --uma-vez para forçar agora)"
  sleep "$espera" &
  wait $!
fi

while true; do
  fazer_backup || true
  sleep "$INTERVALO_SEGUNDOS" &
  wait $!
done
