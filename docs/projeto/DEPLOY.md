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
- **Backup do Postgres** (obrigatório antes do piloto — §15):
  `docker compose -f ... exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB | gzip > backup-$(date +%F).sql.gz`
  Agendar no cron do host + copiar para fora do servidor. Testar restauração.

## Pendências conhecidas desta configuração

- Sem observabilidade externa ainda (Sentry/Prometheus — §16); os logs são JSON no stdout.
- Chave privada Ed25519 dos eventos vive no banco (TODO produção: KMS).
- Rate limiting de borda (WAF/bots — §15) não configurado; avaliar Cloudflare na frente.
