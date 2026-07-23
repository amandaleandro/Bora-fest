# COMO RODAR — BoraFest (ambiente local)

Pré-requisitos: **Node >= 20**, **pnpm 9** (`corepack enable`), **Docker**.

## Setup do zero (primeira vez)

```bash
# 1. Clonar e entrar
git clone https://github.com/amandaleandro/Bora-fest.git bora-fest
cd bora-fest

# 2. Variáveis de ambiente
cp .env.example .env
# edite .env e defina SESSION_JWT_SECRET (qualquer string longa aleatória)

# 3. Instalar dependências
pnpm install

# 4. Subir Postgres (localhost:5443) e Redis (localhost:6380)
pnpm infra:up

# 5. Gerar client, aplicar migrations e seed (roles base)
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 6. Build dos packages compartilhados
pnpm build
```

## Dia a dia

```bash
pnpm infra:up      # sobe Postgres + Redis (docker compose)
pnpm dev           # API (porta 3333) + worker em watch, via turbo
pnpm infra:down    # derruba os containers (dados persistem em volumes)
```

Rodar só um app:

```bash
pnpm --filter @borafest/api dev
pnpm --filter @borafest/worker dev
```

## Comandos úteis

| Comando | O que faz |
|---|---|
| `pnpm build` | build de todos os packages/apps (turbo, ordem correta) |
| `pnpm typecheck` | checagem de tipos em tudo |
| `pnpm test` | testes |
| `pnpm db:migrate` | `prisma migrate dev` (cria/aplica migration local) |
| `pnpm db:deploy` | `prisma migrate deploy` (aplica sem criar — CI/prod) |
| `pnpm db:studio` | Prisma Studio (GUI do banco) |
| `pnpm db:seed` | seed das roles base (owner/admin/operator/finance) |

## Smoke test rápido da API

```bash
curl http://localhost:3333/health
# fluxo: POST /v1/reservations → POST /v1/orders → GET /v1/orders/:publicToken/status
```

## Testes automatizados

```bash
pnpm --filter @borafest/api test
```

Roda os testes de integração em `apps/api/src/__tests__` (Node test
runner, `tsx --test`) contra o Postgres/Redis de dev — não precisa da API
rodando, os services são instanciados direto. Cobre os 3 pontos mais
críticos: concorrência de estoque, fluxo pedido→pagamento→ledger com
webhook duplicado, e corrida de check-in.

## Teste de carga (arquitetura §22)

Com a API rodando (`pnpm --filter @borafest/api dev` ou `dist/main.js`):

```bash
pnpm --filter @borafest/api load-test
# ou escolher a escala:
LOAD_TEST_CAPACITY=20 LOAD_TEST_ATTEMPTS=500 pnpm --filter @borafest/api load-test
```

Dispara N reservas HTTP concorrentes contra um lote recém-criado de
capacidade C e falha (`exit 1`) se vender mais que C. Valida o caminho
inteiro (Fastify → Nest → Postgres), não só o service.

## Problemas comuns

- **`REDIS_URL is not set` / `SESSION_JWT_SECRET is not set`** → faltou `.env` (a API e o worker leem do ambiente; use `dotenv` do shell ou exporte antes de rodar).
- **Porta ocupada** → Postgres local usa `5443` e Redis `6380` justamente para não colidir com instalações padrão (5432/6379).
- **Erro de tipos em `@borafest/*`** → rode `pnpm build` na raiz: os packages compartilhados são consumidos compilados (`dist/`).
- **Migrations divergentes** → nunca edite migration aplicada; crie nova com `pnpm db:migrate`.
