# DEPLOY — BoraFest em produção/homologação

> Arquitetura alvo do piloto (§5): um único host com Docker Compose —
> Postgres, Redis, API, worker, 3 frontends e Caddy (HTTPS automático).
> Para eventos grandes, migrar para banco/Redis gerenciados e redundância
> (anotado como evolução; não improvisar no piloto sem backup e monitoração).

## Pré-requisitos

1. Servidor Linux (Ubuntu 22.04+) com Docker + Docker Compose plugin.
2. DNS dos 4 domínios apontando para o IP do servidor:
   - loja/checkout → `CHECKOUT_DOMAIN` (ex.: `borafest.com.br`)
   - painel do produtor → `PRODUCER_DOMAIN` (ex.: `painel.borafest.com.br`)
   - backoffice → `ADMIN_DOMAIN` (ex.: `admin.borafest.com.br`)
   - API → `API_DOMAIN` (ex.: `api.borafest.com.br`)
3. Portas 80 e 443 liberadas (o Caddy emite os certificados sozinho).

## Subindo

```bash
git clone https://github.com/amandaleandro/Bora-fest.git && cd Bora-fest
cp .env.production.example .env.production
# preencha: senhas, SESSION_JWT_SECRET (openssl rand -hex 32),
# domínios, chaves do Pagar.me
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

O serviço `migrate` roda `prisma migrate deploy` e sai; `api`/`worker` só
sobem depois dele. Seed inicial de roles (uma vez):

```bash
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production \
  exec api sh -c "cd packages/database && npx tsx src/seed.ts"
```

## Atualizando (deploy de nova versão)

```bash
git pull
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

(As migrations rodam de novo pelo `migrate`; `--build` reconstrói o que mudou.)

## Configurações externas obrigatórias antes de vender de verdade

| Item | Onde |
|---|---|
| Webhook do Pagar.me → `https://API_DOMAIN/v1/webhooks/payments/pagarme` com autenticação Basic (mesmo user/senha do `.env.production`) | Dashboard Pagar.me → Configurações → Webhooks |
| Chave `pk_` (tokenizecard.js) no checkout quando o pagamento por cartão for exposto na UI | Dashboard Pagar.me |
| Provedor real de e-mail/WhatsApp (`EMAIL_PROVIDER`/`WHATSAPP_PROVIDER`) | Quando os adapters reais existirem |

## Operação

- Logs: `docker compose -f ... logs -f api worker`
- Saúde: `https://API_DOMAIN/health`; filas/webhooks no backoffice (`/filas`, `/webhooks`)

### Backup e restauração (obrigatório antes do piloto — §15)

- `infra/scripts/backup.sh`: `pg_dump` + gzip pra `backups/borafest-<data>.sql.gz`,
  com retenção configurável (`RETENTION_DAYS`, padrão 14 dias). Lê `.env.production`
  (ou `ENV_FILE`/`BACKUP_DIR` customizados). Cron sugerido (diário às 3h):

  ```cron
  0 3 * * * cd /caminho/do/repo && infra/scripts/backup.sh >> /var/log/borafest-backup.log 2>&1
  ```

  **Copie os arquivos gerados pra fora do servidor** (ex.: rsync/S3) — um backup que só
  existe no mesmo disco não protege contra a falha mais comum (disco corrompido/apagado).
- `infra/scripts/restore.sh <arquivo.sql.gz>`: derruba o banco atual (dropdb/createdb) e
  restaura do backup indicado, pedindo confirmação explícita antes. **Testado** (2026-07-23):
  round-trip completo contra o Postgres de dev — `pg_dump` → gzip → `dropdb`/`createdb` →
  restore, contagem de linhas de `events`/`orders` idêntica antes e depois. Recomendado
  repetir esse "restore drill" periodicamente contra um banco de teste (nunca a primeira
  vez direto em produção).

### Alerta de disponibilidade

- `infra/scripts/healthcheck-alert.sh`: consulta `$HEALTH_URL` (default
  `https://$API_DOMAIN/health`) e dispara um POST em `$WEBHOOK_URL` (compatível com
  Slack/Discord incoming webhook) só quando o estado muda (up→down ou down→up) — não
  reenvia alerta a cada execução enquanto o problema persiste. Cron sugerido (a cada 2 min):

  ```cron
  */2 * * * * cd /caminho/do/repo && WEBHOOK_URL=https://... HEALTH_URL=https://API_DOMAIN/health infra/scripts/healthcheck-alert.sh >> /var/log/borafest-healthcheck.log 2>&1
  ```

  **Testado** (2026-07-23) contra a API local: subida→queda→subida de verdade (API
  derrubada/religada), confirmado que o alerta dispara exatamente nas transições de
  estado e fica em silêncio enquanto o estado não muda. Sem `WEBHOOK_URL`, só loga.

## Pendências conhecidas desta configuração

- Sem observabilidade externa tipo Sentry/Prometheus ainda (§16) — os logs continuam
  JSON no stdout; o `healthcheck-alert.sh` acima é o mínimo de alerta de disponibilidade,
  não substitui uma solução de observabilidade de verdade pra escala maior.
- Chave privada Ed25519 dos eventos vive no banco (TODO produção: KMS).
- Rate limiting de borda (WAF/bots — §15) não configurado; avaliar Cloudflare na frente.
