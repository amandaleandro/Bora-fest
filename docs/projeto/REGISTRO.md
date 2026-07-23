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
| **Fase em andamento** | Fase 8 (frontend) — painel do produtor (`apps/producer`) |
| **Status da fase** | 🟢 Implementado e testado de ponta a ponta contra a API real |
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
- Completando o §17 (revisão pós-primeira entrega): `POST
  /v1/admin/tickets/:id/block` (bloqueio de ingresso individual — status
  `CANCELED`, idempotente contra ingresso já cancelado/reembolsado) e
  `GET /v1/admin/audit-logs` (visualizar auditoria, filtro por
  entityType/entityId/organizationId).
- Testado de ponta a ponta: dashboard/participantes/CSV com pedido real
  `FULFILLED` (reserva → pedido → Pix mock → webhook assinado → ticket
  emitido); backoffice com usuário `platformRole=ADMIN`: taxa configurada,
  evento/pedido listados, reenvio, estorno controlado (pedido foi a
  `REFUNDED`, pagamento `REFUNDED` via gateway mock — e o worker já revoga o
  ingresso sozinho nesse caso, achado ao testar: `payment_reversed` cancela o
  ticket, mas não devolve estoque), webhook e filas visíveis, bloqueio de
  ingresso ativo (segunda compra completa só para este teste) e consulta de
  auditoria filtrada por `entityType=ticket`.
- Fora do escopo (nota já em MEMORIA.md): estorno/revogação ainda não devolve
  estoque ao lote para revenda — fica para a Fase 9.

### Fase 9 (núcleo) — CONCLUÍDA ✅

- Schema: `ledger_accounts` (1:1 com organização), `ledger_entries`
  (append-only, `amountCents` assinado: positivo=crédito/negativo=débito;
  tipos `SALE_CREDIT`/`PLATFORM_FEE`/`REFUND_DEBIT`/`PAYOUT_DEBIT`) e
  `payouts` (`PENDING`/`PAID`/`FAILED`) — migration
  `20260723125445_ledger_and_payouts`.
- `packages/payments/src/fees.ts`: `computePlatformFeeCents(method,
  amountCents, org)` — usa os overrides de `Organization` (Fase 8) e cai no
  padrão da plataforma (env `PLATFORM_PIX_FEE_BPS`/`_FLOOR_CENTS`/
  `PLATFORM_CARD_FEE_BPS`, default 499/249/699 = decisão de 2026-07-23).
- **Ganchos direto no `applyGatewayStatus`** (único caminho, nunca duplicado):
  `PAID` → `creditOrganizationLedger` (SALE_CREDIT bruto + PLATFORM_FEE da
  comissão, na mesma transação que confirma o estoque vendido);
  `REFUNDED`/`CHARGEBACK` → `reverseOrganizationLedgerAndStock` (REFUND_DEBIT
  que zera os dois lançamentos anteriores + `returnSaleInventory` devolve
  `sold_count` ao lote — fecha a lacuna que ficou registrada desde a Fase 4).
- API produtor: `GET /v1/organizations/:id/balance` e `/ledger`
  (`PERMISSIONS.FINANCE_VIEW`, mesmo padrão do dashboard).
- Backoffice: `GET /v1/admin/organizations/:id/ledger`, `GET
  /v1/admin/payouts`, `POST /v1/admin/organizations/:id/payouts` (cria
  repasse do saldo disponível — **bloqueado se `Organization.status !==
  'ACTIVE'`**, ou seja, sem KYC aprovado não sai repasse) e `POST
  /v1/admin/payouts/:id/mark-paid` (confirma transferência bancária manual,
  lança `PAYOUT_DEBIT`). Execução bancária real (split/recebedores Pagar.me)
  continua fora do escopo — depende de KYC comercial, por isso o repasse é
  confirmado manualmente por enquanto.
- Testado de ponta a ponta: venda nova → `SALE_CREDIT` 5500 + `PLATFORM_FEE`
  -274 (4,99% de R$55,00) → saldo R$52,26; **payout bloqueado com KYC
  pendente** (org `PENDING_VERIFICATION`); org aprovada (`ACTIVE`) → payout
  criado → marcado pago → saldo zera; estorno do mesmo pedido DEPOIS do
  payout → estoque devolvido (disponibilidade voltou a 1) e saldo foi a
  -5226 (`availableForPayoutCents` corretamente travado em 0, não negativo).

### Fase 6 (app RN de check-in) — CÓDIGO ESCRITO 🟡, não testado em aparelho

Criado `apps/mobile-checkin` (Expo + React Native + TypeScript):

- Login por PIN (`POST /v1/validator/sessions`) — registra o aparelho e
  guarda `deviceId`/`deviceToken` em `expo-secure-store`.
- Manifesto sincronizado (completo na 1ª vez, delta depois) e cacheado em
  SQLite local (`expo-sqlite`) — tabelas `tickets`, `pending_checkins`,
  `confirmed_checkins`, `meta`.
- Scanner de QR (`expo-camera`) → `POST /v1/checkins` online por padrão;
  se a rede falhar, cai para pré-check local contra o manifesto cacheado
  (`src/checkin/attemptCheckin.ts`) e enfileira o check-in.
- Busca manual por código (o manifesto não traz nome/CPF — só o caminho
  online devolve isso, então a busca offline é só por código).
- Fila offline com sincronização em lote (`POST /v1/checkins/sync`,
  `batchKey` novo por tentativa, idempotente do lado do servidor).
- Contador local (confirmados/pendentes) — **não é o contador oficial do
  produtor**: descobrimos ao mapear os contratos que
  `GET /v1/events/:id/checkin-live` e `POST /v1/checkins/:id/reverse`
  exigem `SessionGuard` (sessão de usuário do produtor), não
  `ValidatorDeviceGuard` (token de aparelho) — o app de portaria não
  consegue chamar essas duas rotas. Isso é esperado (reversão é ação do
  painel, não do celular na portaria), então o app mantém seu próprio
  contador a partir do que ele mesmo confirmou/sincronizou.
- **Simplificação assumida e documentada** (`apps/mobile-checkin/README.md`):
  o parser local do QR (`src/qr/parseTicketToken.ts`) decodifica o payload
  mas **não verifica a assinatura Ed25519** — isso exigiria uma lib de
  crypto compatível com React Native (`node:crypto` não roda lá), fora do
  escopo desta entrega. A verificação de assinatura de verdade continua
  sendo sempre do servidor, tanto no scan online quanto na sincronização do
  lote; o pré-check offline é só uma conveniência de UX/gating local.
- `pnpm --filter @borafest/mobile-checkin typecheck` limpo. **Não rodado em
  emulador/celular real** — este ambiente de trabalho não tem Android
  Studio/Xcode nem um dispositivo físico conectado. Falta validar na prática
  (Expo Go) antes de confiar no app em produção.

Criado também `docs/projeto/API-REFERENCE.md`: tabela de toda rota da API
(verbo, path, guard, schema do corpo), organizada por módulo — não existia
um lugar único para consultar isso antes (só dava pra achar lendo
controller por controller).

### Checkout web (Fase 3, frontend) — CONCLUÍDO ✅

Criado `apps/checkout` (Next.js 14 App Router + TypeScript + Tailwind),
consumindo direto a API que já existia desde a Fase 3 (backend) — nenhuma
rota nova precisou ser criada. Três páginas:

- `/evento/[slug]` — página pública (server component, busca
  `GET /v1/public/events/:slug` + `/availability`), seletor de quantidade
  por lote e botão "Continuar" que cria a reserva (`POST /v1/reservations`).
- `/checkout/[reservationId]` — formulário de contato (e-mail obrigatório,
  nome e WhatsApp opcionais, sem exigir conta) → cria o pedido
  (`POST /v1/orders`) → gera cobrança Pix (`POST /v1/orders/:id/payments/pix`)
  → mostra QR code (via `react-qr-code`) + código copia-e-cola → faz polling
  do status do pedido a cada 3s e redireciona pra carteira quando `FULFILLED`.
- `/pedido/[publicToken]` — carteira: lista os ingressos com QR (o token
  assinado, não o código curto) e botão de reenvio
  (`POST /v1/orders/:publicToken/resend`).

**Bug real encontrado testando contra a API de verdade** (não só typecheck):
`GET /v1/orders/:publicToken/tickets` NÃO devolve um array direto — devolve
`{ orderId, orderStatus, event, tickets: [...] }`. O cliente HTTP do app
(`lib/api.ts`) assumia array; corrigido antes de commitar. Isso reforça por
que testar contra a API real importa mesmo com typecheck limpo (o tipo era
só uma suposição minha até eu testar).

Testado de ponta a ponta com o event/lote de teste já usado nas fases
anteriores: página do evento renderiza preço+taxa corretos via SSR, reserva
→ pedido → Pix mock → webhook assinado → `FULFILLED` com ticket emitido,
tudo com os MESMOS contratos que o app usa (validado via curl simulando as
chamadas que o frontend faz). `next build` e `tsc --noEmit` limpos.

**Não testado visualmente num navegador** — este ambiente de trabalho não
tem ferramenta de browser/screenshot; a validação foi por contrato de API
(request/response reais) e build/typecheck, não por "clicar e ver". Antes
de confiar 100%, abrir `pnpm --filter @borafest/checkout dev` e navegar o
fluxo manualmente uma vez.

### Painel do produtor (Fase 8, frontend) — CONCLUÍDO ✅

Criado `apps/producer` (Next.js 14 + TypeScript + Tailwind). Diferente do
checkout (que não precisa de login), aqui todo mundo autentica por OTP e o
token de sessão fica em `localStorage` (`lib/auth.tsx`, `AuthProvider` +
`AuthGuard` client-side — sem middleware/servidor, é tudo SPA-like dentro
do App Router). Páginas:

- `/login` — OTP por e-mail (reaproveita `POST /v1/identity/otp/*`).
- `/organizacoes` — lista as organizações do usuário e cria novas.
- `/organizacoes/:id` — lista/cria eventos da organização; link pro financeiro.
- `/organizacoes/:id/financeiro` — saldo e extrato do ledger (Fase 9).
- `/eventos/:id` — publica o evento, cria tipo de ingresso e lote (ativa
  automaticamente), lista os lotes com vendido/disponível.
- `/eventos/:id/dashboard` — receita, pedidos/ingressos por status, lotes.
- `/eventos/:id/participantes` — lista + export CSV (via fetch+blob, não
  `<a href>` — o endpoint exige `Authorization`, um link puro não manda o
  header).
- `/eventos/:id/portaria` — cria portão, gera PIN de validador (mostrado
  uma vez), lista/bloqueia dispositivos.

**Duas lacunas reais de backend encontradas e corrigidas ao construir o
painel** (não só suposição — vieram de tentar montar a tela e faltar dado):

1. **Não existia `GET /v1/organizations`** para listar as organizações do
   usuário logado (só `POST` de criar existia). Adicionado
   `OrganizationsService.listForUser` + rota, testado retornando a org
   existente com `roleKey`.
2. **`GET /v1/events/:id/dashboard` não expunha o `ticketTypeId` de cada
   lote** (só `typeName`) — sem isso, a tela não tinha como saber em qual
   tipo de ingresso criar um lote novo sem o produtor digitar um UUID à
   mão. Adicionado `ticketTypeId` no mapeamento do dashboard.

Ambas registradas em `docs/projeto/API-REFERENCE.md`.

**Limitação assumida**: tipos de ingresso sem nenhum lote ainda não aparecem
em lugar nenhum da API (só o dashboard, que só devolve lotes) — o painel
contorna isso guardando os tipos criados na sessão atual em memória; se a
página for recarregada antes de criar o lote, o tipo "some" da tela (ele
continua existindo no banco, só não tem como listar). Documentado no
código (`knownTypes` em `eventos/[eventId]/page.tsx`).

Testado de ponta a ponta contra a API real: login por OTP → listar
organização → dashboard do evento com `ticketTypeId` novo → criar tipo de
ingresso → criar portão → gerar PIN de validador (PIN de verdade
devolvido) → exportar CSV de participantes com o header `Authorization`
correto. `next build`/`tsc --noEmit` limpos. **Não aberto num navegador de
verdade** — mesma ressalva do checkout, sem ferramenta de browser neste
ambiente.

### Próximo passo

1. **Abrir checkout e painel do produtor num navegador de verdade** e
   navegar os fluxos manualmente (este ambiente não tem ferramenta de
   screenshot/browser).
2. **Backoffice web** (`apps/admin`) — mesma ideia: consumir a API que já
   existe (`/v1/admin/*`).
3. **Testar o app de check-in em dispositivo real** (Expo Go, depois
   development build) — validar câmera, fluxo offline/online de verdade,
   antes de qualquer publicação em loja.
4. **Split real com Pagar.me** (comercial + código): recebedores/KYC por
   organização, hold-até-aprovação de fato (hoje é só o gate de
   `Organization.status`), execução automática do repasse via API do
   gateway em vez de confirmação manual.
5. Comercial (não bloqueia código): conta PSP Pagar.me + Plano Customizado;
   autenticação do webhook no dashboard; provedor real de e-mail e BSP de
   WhatsApp (cada um vira adapter).
6. Fase 10: publicação do BoraFest Check-in nas lojas (só depois do app
   testado em aparelho). Fase 11/12: evento-piloto com testes de carga/
   hardening, app público do comprador (`apps/mobile-public`, ainda vazio).

---

## Fases (arquitetura §21)

| # | Fase | Status | Commit(s) |
|---|---|---|---|
| 1 | Monorepo, autenticação, organizações, RBAC, banco e observabilidade | ✅ Concluída | `1f46fa0`, `7ea634d` |
| 2 | Eventos, tipos, lotes, estoque e publicação | ✅ Concluída | `05ff2f3` |
| 3 | Checkout web, reserva e pedidos | ✅ Concluída (backend + frontend `apps/checkout`) | `277e684` (backend), `7724d55`, `9c3e02c` (frontend) |
| 4 | Gateway, webhooks, pagamentos e emissão de ingressos | ✅ Concluída | `9f362ff`, `ab18e51` |
| 5 | Carteira web, e-mail, WhatsApp e links profundos | 🟢 Backend concluído (UI fica p/ etapa de front) | `ed79eb6` |
| 6 | App React Native de check-in online | 🟡 Código escrito, não testado em aparelho real | `578a20a` |
| 7 | Manifesto, SQLite, assinatura local e sincronização offline | 🟢 Backend concluído (manifesto/delta, sync idempotente); cliente RN em `578a20a` | `59fe647`, `578a20a` |
| 8 | Painel de vendas, pedidos, participantes e backoffice mínimo | ✅ Concluída (backend + painel do produtor `apps/producer`; backoffice web ainda falta) | `7288370`, `cabfb6f` |
| 9 | Ledger, taxas, estornos e repasses | 🟢 Núcleo concluído (split real com Pagar.me fica p/ quando o KYC comercial estiver pronto) | `c3cd744` |
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
| 2026-07-23 | Amanda + Claude | **Painel do produtor** (`apps/producer`, Next.js/TS/Tailwind, login por OTP com token em localStorage): organizações, eventos (criar/publicar), catálogo (tipo+lote com ativação), dashboard, participantes+export CSV (via fetch+blob por causa do header Authorization), financeiro (saldo/ledger) e portaria (portões, PIN de validador, dispositivos). Achadas e corrigidas 2 lacunas reais no backend testando de verdade: faltava `GET /v1/organizations` (listar orgs do usuário) e o dashboard não expunha `ticketTypeId` por lote (impossível criar lote sem digitar UUID à mão). `next build`/`tsc` limpos, fluxo validado via curl com os mesmos contratos do frontend. **Não aberto num navegador de verdade** (mesma ressalva do checkout). | Painel do produtor pronto. Próximo: backoffice web (`apps/admin`), depois testar tudo (checkout+painel+app RN) numa sessão com navegador/aparelho de verdade. |
| 2026-07-23 | Amanda + Claude | **Checkout web** (`apps/checkout`, Next.js/TS/Tailwind): página do evento, checkout com Pix (QR via `react-qr-code`) e carteira com os ingressos, tudo consumindo a API que já existia. Achado um bug real testando contra a API de verdade (não só typecheck): `GET /v1/orders/:publicToken/tickets` devolve um objeto `{event, tickets}`, não um array — o cliente HTTP assumia array errado, corrigido antes de commitar. `next build`/`tsc` limpos; fluxo validado via curl simulando as chamadas do frontend (reserva → pedido → Pix mock → webhook → `FULFILLED`), mas **não aberto num navegador de verdade** (sem ferramenta de browser neste ambiente). | Checkout web pronto, falta alguém abrir no navegador uma vez. Próximo: painel do produtor/backoffice web (mesma ideia, consumir API existente) ou testar o app de check-in em aparelho. |
| 2026-07-23 | Amanda + Claude | **Fase 6 (app RN de check-in)** + **doc de referência da API**: `apps/mobile-checkin` (Expo/RN/TS) com login por PIN, manifesto em SQLite local, scanner de QR com fallback offline (fila + sync em lote), busca manual por código e contador local. Mapeamos os contratos exatos de validator/checkins antes de codar e achamos duas pegadinhas: `checkin-live`/`reverse` exigem sessão de usuário (não token de aparelho — o app não pode chamá-las), e `syncCheckinsSchema` só aceita `ticketId` (não `qrToken`), então o parser local do QR (sem verificar assinatura Ed25519 — isso ficou documentado como limitação assumida) é obrigatório para o caminho offline. `pnpm typecheck` limpo em tudo, mas **não testado em aparelho real** (sem emulador/celular neste ambiente). Criado também `docs/projeto/API-REFERENCE.md` com todas as rotas da API por módulo — lacuna que não existia antes. | Fase 6 com código pronto, falta testar em Expo Go antes de qualquer publicação em loja (Fase 10). |
| 2026-07-23 | Amanda + Claude | **Fase 9 (núcleo)**: ledger append-only (`ledger_accounts`/`ledger_entries`) e `payouts`, cálculo de comissão configurável por organização (`computePlatformFeeCents`), tudo pendurado direto no `applyGatewayStatus` (PAID credita venda+comissão e confirma estoque; estorno/chargeback reverte o ledger a zero E devolve o estoque vendido — fechando a lacuna aberta desde a Fase 4). API de saldo/ledger para o produtor e backoffice de repasse (bloqueado sem KYC aprovado, confirmação manual da transferência até o split real do Pagar.me). Testado de ponta a ponta: venda → saldo líquido correto → payout bloqueado sem KYC → aprovado → payout pago → saldo zera → estorno pós-payout devolve estoque e deixa saldo negativo (repasse futuro descontado), disponível-para-repasse travado em zero. | Fase 9 (núcleo) concluída. Split real com Pagar.me (recebedores/KYC) fica para quando o comercial fechar a conta PSP. |
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
