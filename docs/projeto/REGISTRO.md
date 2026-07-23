# REGISTRO — Estado do projeto BoraFest

> **Este arquivo é a fonte de verdade de onde estamos e onde paramos.**
> Toda sessão de trabalho (alteração, correção ou similar) DEVE terminar com uma
> atualização deste arquivo antes do commit. Quem chega (pessoa ou Claude, em
> qualquer máquina) lê este arquivo primeiro e continua do ponto correto.
>
> Regras:
> 1. Leia `docs/projeto/MEMORIA.md` (convenções e decisões) antes de codar.
> 2. A referência das fases é `docs/arquitetura/arquitetura-borafest.md`, seção 21.
> 3. Ao terminar qualquer trabalho: atualize "Estado atual", marque a fase,
>    preencha "Onde paramos" e "Próximo passo", adicione uma linha no Diário.

---

## Estado atual

| Campo | Valor |
|---|---|
| **Fase em andamento** | Fase 8 — painel do produtor + backoffice mínimo |
| **Status da fase** | 🟢 Concluída e testada de ponta a ponta |
| **Última atualização** | 2026-07-23 |
| **Atualizado por** | Amanda + Claude |
| **Branch** | `main` |

### Onde paramos

- **Núcleo da Fase 4 pronto e testado a nível de código** (tudo backend):
  - Schema: `payments`, `payment_events`, `webhook_deliveries`, `tickets`,
    `event_signing_keys` + janela de pagamento no pedido
    (migration `20260723054509_payments_tickets_webhooks`).
  - `packages/payments`: interface `PaymentGateway` (§11) + `MockGateway`
    (webhook HMAC) + registry + `applyGatewayStatus` (transições idempotentes,
    compartilhado por API e worker).
  - `packages/tickets`: QR Ed25519 (`BF1.<payload>.<assinatura>`) + código humano.
  - API: `POST /v1/orders/:id/payments/pix|card` (Idempotency-Key),
    `POST /v1/webhooks/payments/:provider` (assinatura verificada, payload bruto
    salvo, dedupe por evento), `GET /v1/orders/:token/tickets`, `GET /v1/me/tickets`.
  - Worker: outbox (emissão exatamente-uma-vez, estorno automático de pagamento
    órfão, revogação por estorno/chargeback), reconciliação de pagamentos,
    expiração de pedidos (libera estoque reservado).
  - **Mudança de semântica**: pedido não confirma mais venda na criação; estoque
    fica em `reserved_count` até o pagamento aprovar (webhook) — `sold_count` só
    no PAID. Janela de pagamento: 15 min.
- **Testes executados e passando** (ver §22 da arquitetura):
  fluxo Pix completo até FULFILLED com 2 tickets; webhook duplicado (no-op);
  assinatura inválida (401); cartão aprovado/recusado; replay de Idempotency-Key
  (mesma resposta, 1 pagamento só) e key reusada com payload diferente (422);
  pagamento aprovado APÓS pedido expirar → estorno automático (bug real
  encontrado e corrigido no teste); QR verificado criptograficamente e
  adulteração rejeitada; 10 compradores concorrentes em lote de 3 → exatamente
  3 reservas, zero overselling.
- **Pesquisa de gateways concluída** — ver
  [`pesquisa-gateways-2026-07.md`](pesquisa-gateways-2026-07.md).
  Recomendação: **Pagar.me primário** (split nativo com hold-até-KYC via status
  do recebedor; Pix 1,19%; crédito 4,39%) + **Asaas fallback** (Pix fixo R$1,99,
  cartão 2,99%+R$0,49; limites de onboarding no começo). Taxa BoraFest sugerida:
  **Pix 4,99% (piso R$2,49) / cartão 6,99%**, blended ~5,6% — abaixo de Sympla
  (~12%), Even3/Ingresse (10%) e challengers (7,99%).
  **⏳ Aguardando o OK do Arthur para fechar o provedor e escrever o adapter real.**

### Decisões tomadas (2026-07-23)

- ✅ **Taxa BoraFest ao produtor CONFIRMADA pelo Arthur**: Pix **4,99%**
  (piso R$2,49/ingresso), cartão **6,99%**, juros de parcelamento repassados ao
  COMPRADOR, boleto R$3,49 repassado ao comprador. Headline: "a partir de 4,99%
  no Pix, teto de 6,99%". Estrutura híbrida (%+piso fixo) também por prudência
  jurídica (entendimento Procon-SP vs. taxa percentual pura).
- ✅ **Gateway primário CONFIRMADO pelo Arthur: Pagar.me** (2026-07-23), com a
  condição de ficar **fácil de trocar** — atendida pela interface
  `PaymentGateway` + registry (`PAYMENTS_PROVIDER` escolhe o adapter; mock,
  pagarme, e futuros asaas/celcoin convivem). Alternativas descartadas na
  discussão: Mercado Pago (sem custódia própria — repasse direto ao vendedor;
  workaround de "cair na nossa conta" reprovado por risco regulatório e imposto
  sobre faturamento bruto) e Celcoin (não é mais barato em ticket baixo — Pix
  fixo R$1,50 vs 1,19% — e exige orquestrar a trava de KYC na mão).

### Fase 4 — CONCLUÍDA ✅

`PagarmeGateway` real implementado com fatos verificados na doc oficial v5
(auth Basic, `Idempotency-key` literal, QR em `last_transaction.qr_code`,
`card_token`, `DELETE /charges` p/ estorno, webhook SEM HMAC — autenticação
Basic do dashboard, fail-closed). 10 testes unitários com fetch stubado.
Troca de provedor = env `PAYMENTS_PROVIDER`.

### Fase 5 (backend) — CONCLUÍDA ✅

- `packages/notifications`: interfaces `EmailSender`/`WhatsAppSender` +
  adapters devlog + registry por env (mesmo padrão dos gateways) + templates
  puros pt-BR testados.
- Tabela `notifications` = fila persistente (PENDING→SENT/FAILED, retry com
  backoff, migration `20260723061545_notifications_contact_phone`).
- Emissão → notificações na MESMA transação do FULFILLED (entrega
  exatamente-uma-vez; e-mail sempre, WhatsApp se houver `contactPhone`).
- Link profundo `WEB_BASE_URL/pedido/:publicToken` (carteira sem conta/app).
- `POST /v1/orders/:publicToken/resend` com limite de 3 notificações/hora.
- Testado de ponta a ponta: fluxo Pix → SENT nos 2 canais no log do adapter,
  link presente, reenvio bloqueado após limite.

### Fases 6/7 (backend do check-in) — CONCLUÍDAS ✅ (lado servidor)

- Schema: `checkin_points`, `validator_credentials` (PIN hasheado),
  `validator_devices` (token hasheado + bloqueio remoto), `checkins`
  (CONFIRMED/CONFLICT/REVERSED, unique device+localSeq), `checkin_sync_batches`
  (idempotência por lote); `Ticket.updatedAt` p/ manifesto delta
  (migration `checkin_validators`).
- Produtor (RBAC): criar/listar portões, gerar credencial PIN (PIN mostrado
  uma única vez, só hash no banco), listar/bloquear dispositivos.
- App validador: `POST /v1/validator/sessions` (PIN → registra aparelho e
  devolve token de dispositivo), refresh de token, manifesto completo e delta
  (`?since=`) com a chave pública Ed25519 do evento.
- `POST /v1/checkins`: QR verificado criptograficamente no servidor, transição
  atômica "primeiro vence" (VALID/ALREADY_USED/INVALID/CANCELED + quem validou
  antes); `POST /v1/checkins/sync` idempotente por (device, batchKey) com
  CONFLICT auditável; reversão com permissão + audit_log; `checkin-live`.
- Testado de ponta a ponta (8 cenários §22): PIN errado 401, QR válido,
  duplicado com identificação do 1º aparelho, QR adulterado, sync com
  conflito, reenvio de lote idêntico sem duplicar, reversão devolvendo o
  ingresso a ACTIVE com auditoria, bloqueio remoto cortando o scan (401).

### Fase 8 — CONCLUÍDA ✅

- Schema: `User.platformRole` (`SUPPORT`/`ADMIN` — equipe interna BoraFest,
  independente das roles de organização) e overrides de taxa por organização
  (`Organization.pixFeeBps/pixFeeFloorCents/cardFeeBps`, null = padrão da
  plataforma) — migration `20260723122219_platform_role_and_org_fees`.
- **Dashboard do produtor** (`apps/api/src/dashboard`, autorizado por
  `PERMISSIONS.FINANCE_VIEW` via `OrgAccessService`, igual ao resto da API):
  `GET /v1/events/:id/dashboard` (receita, pedidos por status, ingressos por
  status, lotes com capacidade/vendido/reservado), `GET /v1/events/:id/orders`
  (paginado), `GET /v1/events/:id/participants` e
  `GET /v1/events/:id/participants/export` (CSV).
- **Backoffice mínimo** (`apps/api/src/admin`, novo `PlatformAccessService`
  em `common/` — `assertStaff`/`assertAdmin`, mesmo padrão do
  `OrgAccessService` mas sem escopo de organização): `GET/POST
  /v1/admin/organizations(/:id/fee|/block|/unblock)`, `GET /v1/admin/events`
  e `POST /v1/admin/events/:id/block`, `GET /v1/admin/orders` (busca por
  publicToken/email/evento), `POST /v1/admin/orders/:publicToken/resend`
  (reaproveita `NotificationsService.resendTickets`), `POST
  /v1/admin/orders/:publicToken/refund` (estorno controlado — reaproveita
  `getGateway().refund()` + `applyGatewayStatus`, o MESMO caminho idempotente
  do webhook, nunca muta status à parte), `GET /v1/admin/webhooks`
  (`WebhookDelivery`) e `GET /v1/admin/queues` (job counts das 5 filas BullMQ
  e contagem do `outbox_events`). Toda ação sensível grava `AuditLog`.
- Testado de ponta a ponta: dashboard/participantes/CSV com pedido real
  `FULFILLED` (reserva → pedido → Pix mock → webhook assinado → ticket
  emitido); backoffice com usuário `platformRole=ADMIN`: taxa configurada,
  evento/pedido listados, reenvio, estorno controlado (pedido foi a
  `REFUNDED`, pagamento `REFUNDED` via gateway mock), webhook e filas visíveis.
- Fora do escopo (nota já em MEMORIA.md): estorno ainda não devolve estoque
  ao lote para revenda — fica para a Fase 9.

### Próximo passo

1. **Fase 9**: ledger, taxas (aplicar os overrides já configuráveis desde a
   Fase 8), estornos com devolução de estoque e repasses — aí entra o split
   Pagar.me com recebedores/KYC e a taxa decidida (4,99%/6,99%).
2. Comercial (não bloqueia código): conta PSP Pagar.me + Plano Customizado;
   autenticação do webhook no dashboard; provedor real de e-mail e BSP de
   WhatsApp (cada um vira adapter).

---

## Fases (arquitetura §21)

| # | Fase | Status | Commit(s) |
|---|---|---|---|
| 1 | Monorepo, autenticação, organizações, RBAC, banco e observabilidade | ✅ Concluída | `1f46fa0`, `7ea634d` |
| 2 | Eventos, tipos, lotes, estoque e publicação | ✅ Concluída | `05ff2f3` |
| 3 | Checkout web, reserva e pedidos (checkout mínimo via API) | ✅ Concluída | `277e684` |
| 4 | Gateway, webhooks, pagamentos e emissão de ingressos | ✅ Concluída | `9f362ff`, `ab18e51` |
| 5 | Carteira web, e-mail, WhatsApp e links profundos | 🟢 Backend concluído (UI fica p/ etapa de front) | `ed79eb6` |
| 6 | App React Native de check-in online | 🟢 Backend concluído (app RN fica p/ etapa mobile) | (este commit) |
| 7 | Manifesto, SQLite, assinatura local e sincronização offline | 🟢 Backend concluído (manifesto/delta, sync idempotente) | (este commit) |
| 8 | Painel de vendas, pedidos, participantes e backoffice mínimo | ✅ Concluída | (este commit) |
| 9 | Ledger, taxas, estornos e repasses | ⬜ Não iniciada | — |
| 10 | Publicação do BoraFest Check-in nas lojas | ⬜ Não iniciada | — |
| 11 | Evento-piloto, testes de carga e hardening | ⬜ Não iniciada | — |
| 12 | App público BoraFest (carteira, descoberta, notificações) | ⬜ Não iniciada | — |

> Decisão de produto: **backend primeiro**. O frontend já foi prototipado e será
> encaixado por cima depois que toda a base de backend estiver estruturada.

---

## Diário de bordo

Formato: `AAAA-MM-DD — quem — o que foi feito — onde parou`.
Adicionar sempre a linha nova NO TOPO.

| Data | Quem | O que foi feito | Onde parou |
|---|---|---|---|
| 2026-07-23 | Amanda + Claude | **Fase 8**: dashboard do produtor (receita, pedidos, participantes, export CSV) e backoffice mínimo (organizações, taxa configurável por org, eventos, busca de pedidos, reenvio, estorno controlado via gateway, webhooks, saúde das filas), com `PlatformRole` (SUPPORT/ADMIN) novo no schema e auditoria em toda ação sensível. Testado de ponta a ponta com um pedido real pago via mock gateway até `FULFILLED` e depois estornado pelo backoffice. | Fase 8 concluída. Próximo: Fase 9 (ledger, taxas, estornos com devolução de estoque e repasses). |
| 2026-07-23 | Arthur + Claude | **Fases 6/7 (backend do check-in)**: portões e PIN pelo produtor, sessão do validador por PIN + registro/refresh/bloqueio de dispositivo, manifesto completo/delta com chave pública Ed25519, check-in atômico "primeiro vence" com verificação criptográfica do QR, sync offline idempotente por lote com trilha de conflito, reversão auditada e painel ao vivo. 8 cenários E2E passando. | Backend do check-in pronto. Próximo: Fase 8 (dashboard produtor + backoffice mínimo). |
| 2026-07-23 | Arthur + Claude | **Fase 5 (backend)**: package notifications (e-mail/WhatsApp por adapter + templates pt-BR), fila persistente `notifications` com retry, entrega disparada na mesma transação do FULFILLED, link profundo da carteira, endpoint de reenvio com limite. Testado de ponta a ponta (SENT nos 2 canais, link ok, limite ok). | Backend da F5 pronto. Próximo: backend do check-in (Fases 6/7 — sessões de validador, manifesto, checkins/sync). |
| 2026-07-23 | Arthur | **Decisões**: taxa BoraFest confirmada (Pix 4,99% piso R$2,49 / cartão 6,99%, parcelamento no comprador) e **Pagar.me confirmado como gateway primário** (fácil de trocar via adapter/env). MP descartado (sem custódia própria) e Celcoin (não é mais barato em ticket baixo + escrow manual). | — |
| 2026-07-23 | Arthur + Claude | **Fase 4 (fechamento)**: `PagarmeGateway` real com fatos verificados na doc oficial v5 (webhook v5 sem HMAC → Basic; header `Idempotency-key`; customer completo p/ Pix) + 13 testes unitários. | Fase 4 concluída. |
| 2026-07-23 | Arthur + Claude | **Fase 4 (núcleo)**: pagamentos Pix/cartão atrás da interface `PaymentGateway` (mock por ora), webhooks idempotentes com payload bruto e assinatura, outbox → emissão exatamente-uma-vez com QR Ed25519, estorno automático de pagamento órfão, expiração de pedidos, reconciliação. Testes §22 executados (concorrência, duplicado, atrasado, adulteração) — 1 bug real achado e corrigido (PAID pós-expiração não estornava). Pesquisa de 13 gateways concluída e salva em `pesquisa-gateways-2026-07.md`. | Falta: Arthur confirmar Pagar.me+Asaas e taxa; escrever adapter real; depois Fase 5. |
| 2026-07-23 | Arthur + Claude | Criada estrutura de docs (`docs/projeto` com memória/registro, `docs/arquitetura`), scripts de conveniência na raiz, README corrigido. Pesquisa de gateways disparada. | Aguardando definição do gateway para iniciar o código da Fase 4. |
| 2026-07-23 | Amanda + Claude | Fase 3: reservas com TTL, checkout mínimo e worker de expiração (`277e684`). | Fase 3 concluída. |
| 2026-07-23 | Amanda + Claude | Fase 2: eventos, catálogo e estoque atômico (`05ff2f3`). | Fase 2 concluída. |
| 2026-07-23 | Amanda + Claude | Fase 1: fundação do monorepo (auth, organizações/RBAC, banco) + fix de build/portas (`1f46fa0`, `7ea634d`). | Fase 1 concluída. |
