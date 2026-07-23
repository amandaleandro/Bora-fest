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
| **Fase em andamento** | Fase 4 — Gateway, webhooks, pagamentos e emissão de ingressos |
| **Status da fase** | 🟢 Núcleo implementado e testado com gateway mock; falta o adapter do provedor real |
| **Última atualização** | 2026-07-23 |
| **Atualizado por** | Arthur + Claude |
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

### Próximo passo

1. Escrever o `PagarmeAdapter` real atrás da interface — o mock continua nos
   testes (`PAYMENTS_PROVIDER=mock` em dev).
2. Comercial: abrir conta PSP Pagar.me + negociar Plano Customizado por volume.
3. Seguir para a Fase 5 — **somente backend** (entrega de ingresso por e-mail/
   WhatsApp, notificações, links profundos); carteira web/UI fica para a etapa
   de front.

---

## Fases (arquitetura §21)

| # | Fase | Status | Commit(s) |
|---|---|---|---|
| 1 | Monorepo, autenticação, organizações, RBAC, banco e observabilidade | ✅ Concluída | `1f46fa0`, `7ea634d` |
| 2 | Eventos, tipos, lotes, estoque e publicação | ✅ Concluída | `05ff2f3` |
| 3 | Checkout web, reserva e pedidos (checkout mínimo via API) | ✅ Concluída | `277e684` |
| 4 | Gateway, webhooks, pagamentos e emissão de ingressos | 🟢 Núcleo testado; falta adapter real | (este commit) |
| 5 | Carteira web, e-mail, WhatsApp e links profundos | ⬜ Não iniciada | — |
| 6 | App React Native de check-in online | ⬜ Não iniciada | — |
| 7 | Manifesto, SQLite, assinatura local e sincronização offline | ⬜ Não iniciada | — |
| 8 | Painel de vendas, pedidos, participantes e backoffice mínimo | ⬜ Não iniciada | — |
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
| 2026-07-23 | Arthur + Claude | **Fase 4 (núcleo)**: pagamentos Pix/cartão atrás da interface `PaymentGateway` (mock por ora), webhooks idempotentes com payload bruto e assinatura, outbox → emissão exatamente-uma-vez com QR Ed25519, estorno automático de pagamento órfão, expiração de pedidos, reconciliação. Testes §22 executados (concorrência, duplicado, atrasado, adulteração) — 1 bug real achado e corrigido (PAID pós-expiração não estornava). Pesquisa de 13 gateways concluída e salva em `pesquisa-gateways-2026-07.md`. | Falta: Arthur confirmar Pagar.me+Asaas e taxa; escrever adapter real; depois Fase 5. |
| 2026-07-23 | Arthur + Claude | Criada estrutura de docs (`docs/projeto` com memória/registro, `docs/arquitetura`), scripts de conveniência na raiz, README corrigido. Pesquisa de gateways disparada. | Aguardando definição do gateway para iniciar o código da Fase 4. |
| 2026-07-23 | Amanda + Claude | Fase 3: reservas com TTL, checkout mínimo e worker de expiração (`277e684`). | Fase 3 concluída. |
| 2026-07-23 | Amanda + Claude | Fase 2: eventos, catálogo e estoque atômico (`05ff2f3`). | Fase 2 concluída. |
| 2026-07-23 | Amanda + Claude | Fase 1: fundação do monorepo (auth, organizações/RBAC, banco) + fix de build/portas (`1f46fa0`, `7ea634d`). | Fase 1 concluída. |
