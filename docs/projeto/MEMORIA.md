# MEMÓRIA — BoraFest

> Memória local e compartilhada do projeto. Commitada no repositório para que
> qualquer pessoa (ou Claude, em qualquer máquina) trabalhe na mesma página.
> **Ordem de leitura ao entrar no projeto:**
> 1. `docs/projeto/REGISTRO.md` — em que fase estamos e onde paramos.
> 2. Este arquivo — convenções e decisões.
> 3. `docs/arquitetura/arquitetura-borafest.md` — arquitetura completa e fases (§21).
> 4. `docs/projeto/COMO-RODAR.md` — subir o ambiente local.

---

## O que é o produto

Plataforma de venda de ingressos (ticketeria) brasileira: página pública +
checkout web, painel do produtor, backoffice, app público e app de check-in
offline. **Marketplace**: a BoraFest recebe o pagamento do comprador e repassa
ao produtor descontando a taxa da plataforma; o repasse fica bloqueado até o
KYC do produtor ser aprovado.

## Decisões de arquitetura (não renegociar sem registrar aqui)

- **Monólito modular**, não microserviços. Fronteiras de módulo claras (§7 da arquitetura).
- **PostgreSQL é a fonte de verdade.** Redis só para TTL/cache/filas — nunca fonte de verdade.
- **Estoque atômico no Postgres**: `UPDATE ... WHERE sold + reserved + qtd <= capacity`
  (ver `apps/api/src/inventory/inventory.service.ts`). Nunca checar disponibilidade só em memória/Redis.
- **Outbox Pattern** para eventos internos (`outbox_events` no schema).
- **Idempotência** em pagamento, webhook, estorno e emissão (`idempotency_keys` no schema).
- **Dinheiro em centavos inteiros** (`priceCents`, `feeCents`, `totalCents`).
- IDs UUID; datas com timezone; entidades multi-tenant carregam `organization_id`.
- Máquinas de estado dos domínios: seção 9 da arquitetura (Evento, Lote, Reserva, Pedido, Ingresso).
- **Backend primeiro**: o front já foi prototipado e entra depois, por cima da API pronta.
- Fase 4: pagamentos atrás de uma **interface `PaymentGateway`** com adapters
  (permite trocar/combinar provedores sem tocar em pedidos/reservas).
- Gateway primário: **decisão em andamento** (ver REGISTRO.md). Requisito
  inegociável: split/marketplace com liberação condicional de repasse; Pix barato;
  taxa BoraFest ao produtor menor que Sympla/Ingresse/etc.

## Stack e layout do monorepo

- pnpm workspaces + Turborepo. Node >= 20. TypeScript em tudo.
- `apps/api` — NestJS + adaptador Fastify. Módulos: identity, organizations,
  events, catalog, inventory, reservations, orders (+ payments/tickets na Fase 4).
- `apps/worker` — processos BullMQ (tsx em dev, tsc em build). Hoje: expiração de
  reservas + reconciliação a cada 60s.
- `packages/database` — Prisma (client singleton em `src/index.ts`, re-exporta `@prisma/client`).
  Migrations em `prisma/migrations`. Seed de roles em `src/seed.ts`.
- `packages/contracts` — schemas Zod + tipos compartilhados (1 arquivo por domínio,
  re-exportado em `src/index.ts`).
- `packages/auth` — OTP, sessão JWT (jose, HS256, `SESSION_JWT_SECRET`), RBAC estático
  (`ROLE_PERMISSIONS` em `rbac.ts`; roles: owner, admin, finance, operator).
- `packages/queues` — 1 arquivo por fila com `create<Nome>Queue()` / `create<Nome>Worker()`
  sobre conexão ioredis compartilhada (`connection.ts`).
- `packages/config` — env tipado com Zod. `packages/observability` — pino (`withContext`).
- `infra/docker/docker-compose.yml` — Postgres em `localhost:5443`, Redis em `localhost:6380`.

## Convenções de código

- Mensagens de erro/log em **português**; código (identificadores) em inglês.
- Controllers finos: validação com `ZodBody(schema)` + service com a regra.
- Autenticação: `SessionGuard` + `@CurrentUserId()` quando obrigatória;
  `@OptionalUserId()` em rotas públicas/convidado.
- Autorização por organização: `OrgAccessService.assertPermission(orgId, userId, PERMISSIONS.X)`.
- Operações críticas de estoque/contadores: SQL bruto atômico via `Prisma.sql`,
  aceitando `TransactionClient` para compor transações.
- Rotas REST com prefixo `v1/` (ex.: `@Controller("v1/orders")`), nomes da seção 13 da arquitetura.
- Commits: convencionais em português (`feat: ...`, `fix: ...`), um commit por fase/entrega coesa.

## Fluxo de trabalho combinado

- Trabalho colaborativo: Amanda e Arthur, cada um com Claude, no mesmo repositório
  (`amandaleandro/Bora-fest`, branch `main`). A sincronização é via commits.
- **Sempre** `git pull` antes de começar e ler o `REGISTRO.md`.
- **Sempre** atualizar o `REGISTRO.md` (estado + diário) no fim da sessão e commitar
  junto com o código.
- Cada fase concluída deve ser testada a nível de código antes de avançar
  (build + typecheck + teste do fluxo; testes bloqueantes: seção 22 da arquitetura).

## Regras da Fase 4 (pagamentos) — aprendidas nos testes

- `applyGatewayStatus` (`packages/payments/src/apply-status.ts`) é o ÚNICO caminho
  para aplicar status de gateway (webhook, cartão síncrono e reconciliação usam o
  mesmo código). Nunca criar caminho paralelo.
- **PAID do gateway vence estados locais não-monetários** (EXPIRED/FAILED/CANCELED):
  o dinheiro se moveu; se o pedido não puder ser honrado, gera `payment.orphaned`
  e o worker estorna automaticamente. Só estados monetários (PAID/REFUND_*/
  CHARGEBACK) não regridem. Bug real corrigido em 2026-07-23.
- Transições de pedido/pagamento sempre com `updateMany` + guarda de status
  (nunca `update` cego) — é o que serializa corridas webhook × worker.
- Emissão exatamente-uma-vez = guarda de status (`PAID`→`FULFILLED`) + unique
  `(order_item_id, seq)` no banco. Reprocessar outbox é sempre no-op.
- Operações de estoque: usar `reserveInventory`/`releaseInventory`/
  `confirmSaleInventory` de `@borafest/database` (compartilhadas API+worker).
- Webhook: payload bruto SEMPRE persistido em `webhook_deliveries` (mesmo
  rejeitado); dedupe por unique `(provider, external_event_id)` em `payment_events`.
- Chave Ed25519 por evento em `event_signing_keys` (privada no banco por ora —
  **TODO produção: KMS**). QR: `BF1.<payload b64url>.<assinatura b64url>`.

## Pendências e cuidados conhecidos

- `.env` local a partir de `.env.example` (`SESSION_JWT_SECRET` precisa ser definido;
  `PAYMENTS_PROVIDER=mock` até o adapter real).
- Reservas: TTL de 10 min (`reservations.service.ts`); janela de pagamento do
  pedido: 15 min (`orders.service.ts`).
- Gateway real: recomendação Pagar.me (primário) + Asaas (fallback) em
  `docs/projeto/pesquisa-gateways-2026-07.md` — aguardando confirmação do Arthur.
- Estorno/chargeback ainda NÃO devolve estoque ao lote (revenda) — tratar na
  Fase 9 (ledger/estornos) junto com estorno parcial.
- Seed de desenvolvimento: `pnpm --filter @borafest/database seed:dev` cria
  evento demo publicado com lote ativo.
