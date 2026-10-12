#!/usr/bin/env bash
# =============================================================================
# ENSAIO DE RESTAURAÇÃO (2026-10-12) — prova que o backup abre de verdade,
# SEM TOCAR no banco real.
#
# Onde rodar: no console do serviço `pg-backup` no EasyPanel (ou, no host,
#   docker compose exec pg-backup bash /opt/borafest/scripts/restore-drill.sh)
#
#   bash /opt/borafest/scripts/restore-drill.sh            # último dump
#   bash /opt/borafest/scripts/restore-drill.sh /backups/borafest-db-AAAAMMDD-HHMMSS.sql.gz.enc
#
# O que faz:
#   1. escolhe o dump (o mais recente de /backups se nenhum for passado);
#   2. cria um banco TEMPORÁRIO borafest_ensaio_<data> no mesmo Postgres;
#   3. restaura o dump nele (decifrando se for .enc — precisa da mesma
#      BACKUP_ENCRYPTION_PASSPHRASE);
#   4. conta as linhas das tabelas principais no backup e no banco real (só
#      leitura) lado a lado;
#   5. confere o pacote de uploads (banners/flyers) do mesmo ciclo;
#   6. APAGA o banco temporário no fim, mesmo se algo der errado.
#
# Cuidados: precisa de espaço livre em disco do tamanho do banco (o banco
# temporário é uma cópia inteira) e pesa um pouco no Postgres — rode fora do
# horário de venda forte. Nunca restaura em cima do banco real: o nome do
# banco de destino é sempre borafest_ensaio_*.
#
# Restauração DE VERDADE (só com perda comprovada pela checagem banco-intacto,
# nunca por tela vazia): ver infra/scripts/README.md.
# =============================================================================

set -uo pipefail
shopt -s nullglob

BACKUP_DIR="${BACKUP_DIR:-/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"
PG_HOST="${PGHOST:-postgres}"
PG_USER="${PGUSER:-borafest}"
PG_DB="${PGDATABASE:-borafest}"
# MESMO número do pg-backup.sh
PBKDF2_ITER=200000

say() { echo "[ensaio] $*"; }
falha() { echo "[ensaio] ERRO: $*" >&2; }

# psql sem .psqlrc, sem senha interativa (usa PGPASSWORD do contêiner)
psql_em() {
  local banco="$1"
  shift
  psql -X --no-password -h "$PG_HOST" -U "$PG_USER" -d "$banco" "$@"
}

garantir_openssl() {
  command -v openssl >/dev/null 2>&1 && return 0
  say "instalando openssl (a imagem não traz)…"
  apk add --no-cache openssl >/dev/null 2>&1 || true
  command -v openssl >/dev/null 2>&1
}

# conteúdo gzip "cru" (decifra se .enc)
abrir_gz() {
  case "$1" in
    *.enc)
      openssl enc -d -aes-256-cbc -pbkdf2 -iter "$PBKDF2_ITER" -pass env:BACKUP_ENCRYPTION_PASSPHRASE < "$1"
      ;;
    *) cat "$1" ;;
  esac
}

# --- 1. qual dump --------------------------------------------------------------
ARQUIVO="${1:-}"
if [ -z "$ARQUIVO" ]; then
  candidatos=("$BACKUP_DIR"/borafest-db-* "$BACKUP_DIR"/borafest-2*.sql.gz)
  if [ "${#candidatos[@]}" -eq 0 ]; then
    falha "nenhum dump em $BACKUP_DIR"
    exit 1
  fi
  ARQUIVO="$(ls -1t "${candidatos[@]}" | head -n 1)"
fi
if [ ! -f "$ARQUIVO" ]; then
  falha "arquivo não encontrado: $ARQUIVO"
  exit 1
fi
say "dump: $ARQUIVO ($(du -h "$ARQUIVO" | cut -f1 | tr -d ' '), gravado em $(date -d "@$(stat -c %Y "$ARQUIVO" 2>/dev/null)" '+%Y-%m-%d %H:%M' 2>/dev/null || echo '?'))"

case "$ARQUIVO" in
  *.enc)
    if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
      falha "o dump é criptografado e BACKUP_ENCRYPTION_PASSPHRASE não está definida neste contêiner"
      exit 1
    fi
    if ! garantir_openssl; then
      falha "openssl indisponível — não dá para decifrar"
      exit 1
    fi
    ;;
esac

# --- 2. trava de segurança: o dump não pode trocar de banco ---------------------
# pg_dump sem -C não troca de banco; um arquivo com \connect (ex.: pg_dumpall)
# poderia sair do banco temporário e escrever no real. Recusa.
say "conferindo o arquivo (decifra + descompacta uma vez)…"
# awk (e não grep -c) porque sempre sai 0: com pipefail, status diferente de
# zero aqui só pode ser falha ao decifrar/descompactar
leitura="$(abrir_gz "$ARQUIVO" | gunzip -c | awk '
  /^\\(c|connect)([[:space:]]|$)/ { n++ }
  /^-- PostgreSQL database dump complete/ { fim = 1 }
  END { print n + 0, fim + 0 }')"
status_leitura=$?
read -r trocas completo <<< "$leitura"
if [ "$status_leitura" -ne 0 ] || [ -z "${trocas:-}" ]; then
  falha "não consegui ler o arquivo (senha errada ou arquivo corrompido?)"
  exit 1
fi
if [ "$trocas" != "0" ]; then
  falha "o arquivo tem $trocas comando(s) \\connect — não é um dump de um banco só; recusado por segurança"
  exit 1
fi
if [ "${completo:-0}" != "1" ]; then
  falha "o dump não tem a linha final 'dump complete' — arquivo truncado"
  exit 1
fi

# --- 3. banco temporário ---------------------------------------------------------
TEMP_DB="borafest_ensaio_$(date +%Y%m%d%H%M%S)"
case "$TEMP_DB" in
  borafest_ensaio_*) ;;
  *) falha "nome de banco temporário inesperado: $TEMP_DB"; exit 1 ;;
esac
if [ "$TEMP_DB" = "$PG_DB" ]; then
  falha "banco temporário igual ao real — abortado"
  exit 1
fi

CRIADO=0
ERROS_LOG="$(mktemp)"
limpar() {
  if [ "$CRIADO" = 1 ]; then
    psql_em postgres -q -c "DROP DATABASE IF EXISTS \"$TEMP_DB\";" >/dev/null 2>&1 \
      && say "banco temporário $TEMP_DB apagado" \
      || falha "não consegui apagar $TEMP_DB — apague à mão: DROP DATABASE \"$TEMP_DB\";"
  fi
  rm -f "$ERROS_LOG"
}
trap limpar EXIT
trap 'exit 130' INT TERM

if ! psql_em postgres -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TEMP_DB\";" >/dev/null; then
  falha "não consegui criar o banco temporário (o usuário $PG_USER precisa poder CREATE DATABASE)"
  exit 1
fi
CRIADO=1
say "banco temporário criado: $TEMP_DB"

# --- 4. restauração ----------------------------------------------------------------
say "restaurando… (pode levar alguns minutos)"
inicio=$(date +%s)
abrir_gz "$ARQUIVO" | gunzip -c | psql_em "$TEMP_DB" -q -o /dev/null >/dev/null 2>"$ERROS_LOG"
status_restore=$?
duracao=$(( $(date +%s) - inicio ))
n_erros="$(grep -c 'ERROR' "$ERROS_LOG" || true)"
say "restauração terminou em ${duracao}s com $n_erros erro(s) do psql"
if [ "$n_erros" != "0" ]; then
  say "primeiros erros:"
  grep 'ERROR' "$ERROS_LOG" | head -n 10 | sed 's/^/    /'
fi

# --- 5. contagem lado a lado ---------------------------------------------------------
contar() {
  psql_em "$1" -A -t -c "SELECT count(*) FROM \"$2\";" 2>/dev/null | tr -d ' ' || true
}

TABELAS="organizations events users orders payments tickets checkins ledger_entries payouts event_signing_keys notifications"
NUCLEO="organizations events users orders"
problemas=0

echo
printf '  %-22s %12s %16s\n' "tabela" "no backup" "no banco real"
printf '  %-22s %12s %16s\n' "----------------------" "------------" "----------------"
for t in $TABELAS; do
  no_backup="$(contar "$TEMP_DB" "$t")"
  no_real="$(contar "$PG_DB" "$t")"
  printf '  %-22s %12s %16s\n' "$t" "${no_backup:-—}" "${no_real:-—}"
  case " $NUCLEO " in
    *" $t "*)
      # núcleo: se o real tem dado e o backup não tem (ou não tem a tabela), falhou
      if [ -n "$no_real" ] && [ "$no_real" != "0" ] && { [ -z "$no_backup" ] || [ "$no_backup" = "0" ]; }; then
        falha "tabela-núcleo $t vazia/ausente no backup, mas com $no_real linhas no banco real"
        problemas=$((problemas + 1))
      fi
      ;;
  esac
done

mig_backup="$(psql_em "$TEMP_DB" -A -t -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;" 2>/dev/null | tr -d ' ')"
mig_real="$(psql_em "$PG_DB" -A -t -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;" 2>/dev/null | tr -d ' ')"
ult_backup="$(psql_em "$TEMP_DB" -A -t -c "SELECT to_char(max(created_at), 'YYYY-MM-DD HH24:MI') FROM orders;" 2>/dev/null | head -n 1)"
# %-24s: "ç" e "õ" ocupam 2 bytes cada no printf
printf '  %-24s %12s %16s\n' "migrações aplicadas" "${mig_backup:-—}" "${mig_real:-—}"
echo "  último pedido no backup: ${ult_backup:-—}"
echo
if [ -z "$mig_backup" ]; then
  falha "tabela _prisma_migrations não veio no backup"
  problemas=$((problemas + 1))
fi

# --- 6. uploads do mesmo ciclo -------------------------------------------------------
base="$(basename "$ARQUIVO")"
case "$base" in
  borafest-db-*)
    ts="${base#borafest-db-}"
    ts="${ts%%.*}"
    pacote=("$BACKUP_DIR"/borafest-uploads-"$ts".tar.gz*)
    if [ "${#pacote[@]}" -gt 0 ]; then
      lista="$(abrir_gz "${pacote[0]}" | tar -tzf - 2>/dev/null)"
      status_pacote=$?
      n_real="—"
      [ -d "$UPLOADS_DIR" ] && n_real="$(find "$UPLOADS_DIR" -type f | wc -l | tr -d ' ')"
      if [ "$status_pacote" -ne 0 ]; then
        falha "pacote de uploads $(basename "${pacote[0]}") ilegível (senha errada ou arquivo corrompido?)"
        problemas=$((problemas + 1))
      else
        # conta só arquivos (no tar, pasta termina em /)
        n_pacote="$(printf '%s\n' "$lista" | grep -v '/$' | grep -c . || true)"
        say "uploads: $n_pacote arquivo(s) no pacote $(basename "${pacote[0]}"), $n_real hoje no volume"
        if [ "$n_pacote" = "0" ] && [ "$n_real" != "—" ] && [ "$n_real" != "0" ]; then
          falha "pacote de uploads vazio, mas o volume tem $n_real arquivo(s)"
          problemas=$((problemas + 1))
        fi
      fi
    else
      falha "não achei o pacote de uploads do mesmo ciclo (borafest-uploads-$ts.tar.gz*)"
      problemas=$((problemas + 1))
    fi
    ;;
  *)
    say "dump no formato antigo (antes de 2026-10-12): não havia backup de uploads"
    ;;
esac

# --- veredito -------------------------------------------------------------------------
if [ "$status_restore" -ne 0 ] || [ "$n_erros" != "0" ] || [ "$problemas" -gt 0 ]; then
  echo
  falha "ENSAIO FALHOU — psql saiu com $status_restore, $n_erros erro(s), $problemas problema(s). Não confie neste backup até entender o motivo."
  exit 1
fi
echo
say "ENSAIO OK — o backup restaura e tem os dados esperados. Anote a data em docs/projeto/PLANO-DE-TESTES.md (5.2)."
exit 0
