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
  events, catalog, inventory, reservations, orders, payments, webhooks,
  tickets, notifications, validator, checkins, dashboard (Fase 8 — painel do
  produtor), admin (Fase 8 — backoffice BoraFest), finance (Fase 9 — saldo/
  ledger do produtor). Rotas completas: `docs/projeto/API-REFERENCE.md`.
- `apps/worker` — processos BullMQ (tsx em dev, tsc em build). Hoje: expiração
  de reservas, outbox (emissão de ingressos), reconciliação de pagamentos,
  expiração de pedidos, entrega de notificações.
- `apps/mobile-checkin` — app de portaria (Fase 6), Expo + React Native +
  TypeScript. Sem framework de navegação (troca de tela por estado simples
  em `App.tsx` — só 3 telas, não precisava de mais). SQLite local
  (`expo-sqlite`) cacheia o manifesto e a fila offline; `expo-secure-store`
  guarda o token do aparelho. **Não tem app.build no turbo, só `typecheck`**
  (roda via `expo start`, não `tsc`/`nest build`).
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
- Autorização de equipe BoraFest (backoffice, sem escopo de organização):
  `PlatformAccessService.assertStaff(userId)` / `.assertAdmin(userId)`, lendo
  `User.platformRole` (`SUPPORT`/`ADMIN`, null = usuário comum). Mesma ideia do
  `OrgAccessService`, chamado dentro do service, não guard.
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

## Pagar.me v5 — fatos verificados na doc oficial (2026-07-23)

- Auth: Basic com `sk_...:` (senha vazia). Idempotência: header literal
  `Idempotency-key` (case-sensitive), dedupe 24h em produção / 5min sandbox.
- Pix: `POST /core/v5/orders` com `payments[].payment_method="pix"` +
  `pix.expires_in`; QR copia-e-cola em `charges[0].last_transaction.qr_code`.
  Pix pede `customer` completo (nome, e-mail, documento, **telefone**) — por
  isso o checkout aceita `payerPhone`.
- Cartão: token client-side (`tokenizecard.js` / `POST /tokens?appId=pk_...`,
  expira em 60s) → campo `credit_card.card_token`. `statement_descriptor`
  máx. 13 chars p/ PSP ("BORAFEST" ok).
- Estorno: `DELETE /charges/{id}` (body `amount` p/ parcial); charge vai para
  `canceled` (não existe status `refunded` na charge, só na transação).
- **Webhook v5 NÃO tem HMAC/X-Hub-Signature** (isso era v4): o oficial é
  autenticação Basic opcional configurada no dashboard →
  `PAGARME_WEBHOOK_BASIC_USER/PASSWORD`. Adapter falha-fechado sem config.
  Defesa em profundidade: reconciliação consulta `GET /charges/{id}`.
- Evento `charge.chargedback` será substituído por `chargeback.received`
  (migração até 30/09/2026) — adapter mapeia os dois.
- **TODO antes de produção**: configurar a autenticação do webhook no dashboard,
  validar débito/Apple Pay com o comercial, e negociar Plano Customizado.

## Regras da Fase 8 (dashboard + backoffice) — aprendidas na implementação

- Dashboard do produtor é autorizado por `PERMISSIONS.FINANCE_VIEW` (owner,
  admin e finance têm; operator não) — mesma permissão usada no resto da API
  para dados financeiros, não criamos uma nova.
- Backoffice NUNCA muta status de pagamento/pedido diretamente — o estorno
  controlado chama `getGateway(payment.provider).refund()` e depois
  `applyGatewayStatus()`, o MESMO caminho do webhook (ver regra da Fase 4
  acima: único caminho para aplicar status de gateway). Antes de chamar o
  gateway, o pagamento é marcado `REFUND_PENDING` via `updateMany` com guarda
  de status `PAID` — evita disparo duplo se o estorno for clicado 2x rápido.
- Reenvio de ingresso pelo backoffice reaproveita
  `NotificationsService.resendTickets(publicToken)` — mesmo limite de 3/hora
  do reenvio pelo comprador; não duplicamos a lógica.
- Toda ação do backoffice (taxa, bloqueio, reenvio, estorno) grava `AuditLog`
  com `actorUserId` e metadata da ação.
- Taxa por organização é override opcional (`pixFeeBps`/`pixFeeFloorCents`/
  `cardFeeBps` em `Organization`, todos nullable = usa o padrão da
  plataforma). Ainda não há um lugar que LEIA esse override para calcular
  `feeCents` de fato — isso é trabalho da Fase 9 (ledger/taxas); a Fase 8 só
  criou onde guardar e como configurar.
- "Bloquear evento" pelo backoffice reaproveita `EventStatus.CANCELED` (não
  existe um status `BLOCKED` dedicado) — o motivo vai só no `AuditLog`.
- Bloquear ingresso individual (`POST /v1/admin/tickets/:id/block`) marca
  `TicketStatus.CANCELED`; idempotente (rejeita se já CANCELED/REFUNDED).
  Descoberto ao testar: o worker já revoga ingresso automaticamente quando o
  pagamento é estornado/chargeback (`order.payment_reversed` no outbox) — o
  bloqueio manual é só para o caso de fraude/decisão humana, não duplica essa
  lógica.
- `GET /v1/admin/audit-logs` (filtros opcionais entityType/entityId/
  organizationId) fecha o item "visualizar auditoria" do §17.

## Regras da Fase 9 (ledger e repasses) — aprendidas na implementação

- Ledger é append-only de verdade: nunca há `UPDATE` num `LedgerEntry`, só
  novos lançamentos. Saldo é SEMPRE `SUM(amountCents)` calculado na hora
  (`apps/api/src/common/ledger.ts`), nunca um campo de saldo mutável.
- Os lançamentos de venda/comissão e a reversão vivem dentro de
  `applyGatewayStatus`/`apply-status.ts` (PAID → `creditOrganizationLedger`;
  REFUNDED/CHARGEBACK → `reverseOrganizationLedgerAndStock`) — é o único
  lugar que mexe em pagamento/pedido, então é o único lugar que pode mexer
  em ledger/estoque decorrente disso. Não criar um segundo caminho.
- Reversão de estorno é sempre "tudo ou nada": debita o líquido exato do que
  foi creditado (SALE_CREDIT + PLATFORM_FEE daquele pagamento específico,
  buscados por `referenceType/referenceId`), nunca um valor recalculado na
  hora — evita divergência se a taxa da organização mudar entre a venda e o
  estorno.
- Estorno DEVOLVE estoque (`returnSaleInventory` decrementa `sold_count`) —
  fecha a lacuna que ficava documentada aqui desde a Fase 4. Isso pode deixar
  o saldo da organização negativo se o repasse já tiver sido pago antes do
  estorno — é o comportamento correto (desconta do próximo repasse);
  `availableForPayoutCents` trava em zero (nunca pede repasse negativo).
- Repasse (`Payout`) é uma promessa (`PENDING`) até alguém confirmar a
  transferência bancária manualmente (`mark-paid`) — só aí nasce o
  `PAYOUT_DEBIT` no ledger. Pedir repasse não debita nada sozinho, só reserva
  o valor (`getAvailableForPayoutCents` desconta payouts `PENDING`+`PAID`).
- Repasse é bloqueado por `Organization.status !== 'ACTIVE'` (KYC pendente)
  — é o hold-até-aprovação do diferencial de produto (§19 da arquitetura).
  Ainda não há split/recebedor real no Pagar.me; isso é a Fase 9.1 quando o
  comercial fechar a conta PSP.
- Taxa efetiva: `computePlatformFeeCents` (`packages/payments/src/fees.ts`)
  usa os overrides de `Organization` (Fase 8) e cai no padrão via env
  (`PLATFORM_PIX_FEE_BPS`/`_FLOOR_CENTS`/`PLATFORM_CARD_FEE_BPS` — default
  499/249/699, a decisão de 2026-07-23).

## Pendências e cuidados conhecidos

- `.env` local a partir de `.env.example` (`SESSION_JWT_SECRET` precisa ser definido;
  `PAYMENTS_PROVIDER=mock` até o adapter real).
- Reservas: TTL de 10 min (`reservations.service.ts`); janela de pagamento do
  pedido: 15 min (`orders.service.ts`).
- Gateway real: recomendação Pagar.me (primário) + Asaas (fallback) em
  `docs/projeto/pesquisa-gateways-2026-07.md` — aguardando confirmação do Arthur.
- ~~Estorno/chargeback ainda NÃO devolve estoque ao lote~~ — **resolvido na
  Fase 9** (`returnSaleInventory`, ver regras da Fase 9 acima). O que falta
  é só o estorno PARCIAL (hoje `refundOrderSchema.amountCents` existe no
  contrato mas `reverseOrganizationLedgerAndStock` sempre reverte o
  pagamento inteiro, não uma fração — se for cobrar isso, tratar na Fase 9.1
  junto com o split real do Pagar.me).
- Seed de desenvolvimento: `pnpm --filter @borafest/database seed:dev` cria
  evento demo publicado com lote ativo.
- Backoffice (Fase 8): nenhum usuário tem `platformRole` por padrão (nem o
  seed). Para testar localmente, promova via Prisma Studio/SQL:
  `UPDATE users SET platform_role = 'ADMIN' WHERE email = '...'`.
- App de check-in (Fase 6): código em `apps/mobile-checkin` nunca rodou de
  fato — este ambiente de trabalho não tem emulador Android/iOS nem celular
  físico. Antes de confiar nele, testar via Expo Go
  (`docs/projeto/API-REFERENCE.md` + `apps/mobile-checkin/README.md` têm o
  que já é sabido/faltando). Verificação de assinatura do QR no aparelho
  (offline) não foi implementada de propósito — ver README do app.
- `docs/projeto/API-REFERENCE.md` é gerado a partir do código; ao adicionar/
  mudar uma rota, atualize essa tabela na mesma sessão (mesma regra do
  REGISTRO.md) — senão ela fica desatualizada rápido, como o restante deste
  arquivo às vezes fica (ver a correção do estorno acima, que só foi
  atualizada agora, uma fase depois).
