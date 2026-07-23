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
| **Status da fase** | 🟡 Em preparação (pesquisa de gateway em andamento; código ainda não iniciado) |
| **Última atualização** | 2026-07-23 |
| **Atualizado por** | Arthur + Claude |
| **Branch** | `main` |

### Onde paramos

- Fases 1–3 concluídas e commitadas (ver tabela abaixo).
- Pesquisa comparativa de gateways/adquirentes BR (Pix, cartão, split/marketplace)
  em execução para escolher o provedor primário + fallback com a melhor taxa.
- Decisão pendente: **qual gateway será o primário** (critério: split/marketplace
  com liberação condicional de repasse, menor custo de Pix, cartão competitivo,
  DX/webhooks, negociabilidade). A taxa BoraFest ao produtor deve ficar **abaixo**
  das ticketeiras concorrentes (Sympla, Ingresse etc.).

### Próximo passo

1. Definir gateway primário e fallback (com Arthur).
2. Implementar Fase 4 (backend only — sem frontend por enquanto):
   - Tabelas: `payments`, `payment_attempts`, `payment_events`, `tickets`,
     `webhook_deliveries` (schema já tem `outbox_events` e `idempotency_keys`).
   - Interface `PaymentGateway` + adapter do provedor escolhido + adapter mock p/ testes.
   - `POST /v1/orders/:id/payments/pix` e `/card` com idempotency key.
   - `POST /v1/webhooks/payments/:provider` — assinatura verificada, payload bruto
     salvo, idempotente, tolerante a eventos fora de ordem.
   - Order → `PAID` → outbox → worker emite tickets exatamente-uma-vez (QR Ed25519).
   - Fila `payment-reconciliation`.
3. Testar a nível de código (build, typecheck, fluxo completo, webhook duplicado).
4. Atualizar este REGISTRO + commit, e só então seguir para a Fase 5.

---

## Fases (arquitetura §21)

| # | Fase | Status | Commit(s) |
|---|---|---|---|
| 1 | Monorepo, autenticação, organizações, RBAC, banco e observabilidade | ✅ Concluída | `1f46fa0`, `7ea634d` |
| 2 | Eventos, tipos, lotes, estoque e publicação | ✅ Concluída | `05ff2f3` |
| 3 | Checkout web, reserva e pedidos (checkout mínimo via API) | ✅ Concluída | `277e684` |
| 4 | Gateway, webhooks, pagamentos e emissão de ingressos | 🟡 Em preparação | — |
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
| 2026-07-23 | Arthur + Claude | Criada estrutura de docs (`docs/projeto` com memória/registro, `docs/arquitetura`), scripts de conveniência na raiz, README corrigido. Pesquisa de gateways disparada. | Aguardando definição do gateway para iniciar o código da Fase 4. |
| 2026-07-23 | Amanda + Claude | Fase 3: reservas com TTL, checkout mínimo e worker de expiração (`277e684`). | Fase 3 concluída. |
| 2026-07-23 | Amanda + Claude | Fase 2: eventos, catálogo e estoque atômico (`05ff2f3`). | Fase 2 concluída. |
| 2026-07-23 | Amanda + Claude | Fase 1: fundação do monorepo (auth, organizações/RBAC, banco) + fix de build/portas (`1f46fa0`, `7ea634d`). | Fase 1 concluída. |
