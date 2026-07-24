# AUDITORIA — Código real vs Arquitetura (2026-07-24)

> 10 agentes auditaram o repositório item a item contra `docs/arquitetura/arquitetura-borafest.md`.
> Regra: só COMPLETO com evidência em código (arquivo:linha). Itens V1/V2 (§19) não contam como dívida do piloto.

## Veredito

O núcleo transacional do backend é real e sólido — não é esqueleto: compra via Pix fim-a-fim (reserva com anti-oversell testado sob concorrência, pedido, pagamento idempotente, emissão de QR Ed25519 exatamente-uma-vez), webhook de pagamento maduro (raw body, assinatura fail-closed, idempotência), app de check-in offline-first completo e backoffice 8/8 do §17. Porém a plataforma HOJE não consegue rodar um piloto real por um motivo brutal: nenhuma mensagem sai em produção — o OTP nunca é enviado (TODO explícito no código, login quebra fora de dev) e os senders de e-mail/WhatsApp são stubs dev-log (ingresso não chega ao comprador). Da API, ~80% da superfície do MVP existe com código de verdade, mas faltam itens explícitos do §17: cartão no checkout (backend pronto, zero UI), consentimento LGPD, recuperação de ingresso, e no painel do produtor faltam editar/despublicar evento, banner e link público. Segurança e observabilidade são os pontos mais fracos (sem MFA, sem Sentry/métricas, CORS aberto, chave privada Ed25519 em texto plano, restore de backup nunca testado), e há um bug financeiro real: estorno parcial é aplicado como total. O que é cupom, assentos, split, wallet, KYC completo e webhooks de saída está ausente mas era V1/V2 por design (§19) — não conta como dívida do piloto.

## Percentuais por área

APIs comprador 10/11 rotas (falta só PATCH reservations); APIs produtor 9/13 (cupons/cortesias são V1 por design — do escopo-piloto, ~9/10); validação/check-in ~85% (núcleo completo e testado; 2 das 4 rotas ausentes são V2); dados 28/40 tabelas do §8 (a maioria das 12 ausentes é V1/V2, mas 5 das 7 regras do banco estão parciais/violadas); filas/workers 8/12 funcionalmente cobertos (2 dos 4 ausentes são V2); pagamentos §11 ~90% com 1 bug real (estorno parcial); segurança §15: 1 completo, 6 parciais, 5 faltando de 12; MVP §17: validação 10/10, backoffice 8/8, comprador 7/12, produtor 4/9; observabilidade §16 ~15% (só pino parcial + healthcheck shell).

## As 10 lacunas que importam para o PILOTO (em ordem)

- 1. Plugar envio real do OTP por e-mail (TODO em identity.service.ts:32 + sender real em packages/notifications) — sem isso ninguém loga em produção; é o bloqueador número 1
- 2. Sender real de e-mail (e idealmente WhatsApp) para entrega do ingresso — o pipeline já existe, falta só o adapter; sem isso o comprador não recebe o que pagou
- 3. Consentimento LGPD no checkout: checkbox + link de política + registro de aceite versionado — item explícito do §17 e risco legal de vender sem
- 4. UI de cartão com tokenização Pagar.me no checkout — §17 pede Pix e cartão; a API está pronta e sem uso
- 5. Recuperação de ingresso sem app: tela 'meus ingressos' via OTP consumindo GET /v1/me/tickets — §17 explícito; hoje quem perde o link perde o ingresso
- 6. Corrigir o bug do estorno parcial (applyReversal trata parcial como total: reverte todo o ledger, estoque e ingressos) — ou bloquear amountCents parcial até o fix
- 7. Completar o painel do produtor: editar evento, despublicar (criar a rota), banner e exibição do link público — 4 itens do §17 de uma vez
- 8. Endurecer o perímetro para o dia do evento: rate limit dedicado no PIN do validador e no scanner, fechar CORS (origin:true+credentials hoje) e garantir x-forwarded-for confiável no Caddy
- 9. Observabilidade mínima de piloto: Sentry (API+web+app) e alertas de falha de pagamento/emissão/fila — hoje o único alerta é 'API caiu'
- 10. Drill de restauração de backup + cópia off-site antes do evento — backup existe mas nunca foi restaurado por processo, e fica no mesmo host

## Completo (amostra do que foi confirmado no código)

- ✅ Fluxo de compra Pix fim-a-fim: reserva com TTL e anti-oversell (testado sob concorrência), pedido, pagamento idempotente, confirmação por polling e emissão exatamente-uma-vez de QR assinado Ed25519 com chave por evento
- ✅ Webhook de pagamentos: raw body sempre persistido, verificação de assinatura fail-closed, idempotência por (provider, externalEventId), caminho único applyGatewayStatus usado por webhook/cartão/reconciliação/estorno — com testes
- ✅ App de check-in React Native completo (§17 validação 10/10): login por PIN, scanner, offline com SQLite, manifesto + delta, fila persistente de sync idempotente por batch, first-wins atômico testado com 8 devices, bloqueio remoto de dispositivo
- ✅ Backoffice §17 8/8: organizadores/eventos, taxa, pedidos/pagamentos, reenvio, estorno controlado, webhooks/filas (BullMQ real), bloqueios e auditoria — com páginas no admin-web
- ✅ Ledger de dupla entrada com balance/extrato do produtor, comissão Pix/cartão com overrides por organização, e outbox pattern com retry/dead-letter
- ✅ 5 filas BullMQ reais com workers (expiração de reserva e pedido, outbox, reconciliação de pagamentos abertos, entrega de notificações com backoff)
- ✅ Anti-enumeração: publicToken UUID, códigos de ingresso aleatórios 31^8, QR com nonce — único item do §15 integralmente completo
- ✅ 28 das 40 tabelas do §8 com os uniques críticos (emissão, sync offline, webhook, pagamento) de verdade no banco
- ✅ Dashboard do produtor, participantes com export CSV, portaria (portões, PIN exibido uma vez, bloqueio de device) e transferência de ingresso com reassinatura de QR e auditoria
- ✅ OTP em si (hash, TTL, 5 tentativas, rate limit, consumo único) e rotas admin/finance com guarda de permissão

## Parcial

- 🟡 Notificações: pipeline completo (fila, retry, templates EMAIL/WHATSAPP/PUSH) mas TODOS os senders são dev-log — em produção nada é enviado, nem OTP nem ingresso
- 🟡 Checkout comprador: só Pix tem UI; cartão existe apenas na API (sem formulário/tokenização); sem fluxo de recuperação de ingresso (GET /v1/me/tickets existe sem tela)
- 🟡 Producer-web: cria e publica evento, mas não edita, não despublica (rota nem existe), não configura banner, não exibe link público, não lista pedidos individuais e não expõe maxPerOrder
- 🟡 Estorno: idempotente e com guardas, mas estorno PARCIAL é bug real — applyReversal trata como total (reverte todo o ledger, estoque e ingressos); refund admin roda síncrono sem retry em fila
- 🟡 Máquinas de estado §9 pela metade: SALES_PAUSED/SALES_CLOSED/COMPLETED, SOLD_OUT/CLOSED, CANCELED (reserva/pedido), PARTIALLY_REFUNDED, ISSUED/TRANSFERRED/REFUNDED existem só nos enums, sem transição em código
- 🟡 Chargeback: só o caminho de derrota (sem disputa, reversão de vitória ou taxa própria); reconciliação não detecta refund/chargeback perdido sobre pagamento já PAID
- 🟡 RBAC: real mas só por organização (sem escopo por evento) e hardcoded no TS — as tabelas roles/permissions do banco não são consultadas
- 🟡 Rate limit: cobre OTP/login/checkout, mas scanner e PIN do validador caem só no default global 120/min, e o contador confia em x-forwarded-for
- 🟡 Criptografia: TLS via Caddy ok; em repouso nada — chave privada Ed25519 em texto plano no banco, backups sem criptografia e sem off-site
- 🟡 Auditoria: cobre reembolso/saque/reversão/transferência, mas NÃO publicação de evento nem mudança de preço (dois dos cinco exigidos pelo §15)
- 🟡 Backup/restore: scripts reais, mas restauração nunca testada por código (sem drill) e sem plano de desastre
- 🟡 Observabilidade §16: pino em parte do código (HTTP log desligado) + healthcheck up/down com alerta webhook; sem Sentry, OTel, Prometheus ou métricas de negócio
- 🟡 Sessão: JWT único de 7 dias sem refresh rotativo, revogação ou logout (só o device de validador rotaciona token)
- 🟡 Manifesto offline: entrega pubkey/versão/delta mas não é assinado em si, sem regra de reentrada nem escopo por portão
- 🟡 KYC: organizer_verifications nunca é lida/escrita — o gate real é unblock manual do admin no status da org (aceitável como interruptor de piloto, não é o fluxo)
- 🟡 Regras do banco §8: centavos OK, mas TIMESTAMP sem timezone, UUIDv4 em vez de v7/ULID, zero CHECK constraints e append-only sem enforcement

## Faltando

- ❌ Envio real do OTP (TODO em identity.service.ts:32) — login de produtor/admin quebrado em produção
- ❌ Provedores reais de e-mail e WhatsApp (SMTP/Resend/etc. — só existe DevLogEmailSender) — entrega de ingresso não acontece
- ❌ UI de cartão com tokenização no checkout (§17 pede Pix E cartão; backend pronto)
- ❌ Consentimento LGPD: checkbox, política versionada e registro de aceite — zero em todos os frontends e no schema (§17 explícito)
- ❌ Recuperação de ingresso sem aplicativo na UI (§17): fluxo OTP → meus ingressos
- ❌ Despublicar evento (§17): nem rota nem UI existem
- ❌ Edição de evento no producer-web (§17): PATCH existe na API, nenhuma tela usa
- ❌ Banner funcional (§17): sem upload/storage, sem campo na UI, checkout não renderiza
- ❌ Link público do evento no painel (§17)
- ❌ MFA para admin e ações financeiras (§15) — refund/payout exigem só a sessão comum
- ❌ Proteção de CPF/documentos (§15): colunas em texto plano, sem mascaramento nem controle de acesso; verifyOtp devolve o user inteiro
- ❌ Retenção/anonimização de dados e exclusão de conta (§15/LGPD): nenhum job, nenhum endpoint
- ❌ WAF/anti-bot na frente do checkout (§15) + CORS aberto (origin:true com credentials)
- ❌ Sentry, OpenTelemetry e Prometheus/métricas (§16): zero referências no repo
- ❌ OpenAPI/Swagger (§5): só schemas Zod
- ❌ PATCH /v1/reservations/:id (alterar carrinho) e reembolso iniciado pelo produtor (hoje só admin)
- ❌ Auditoria de publicação e de mudança de preço
- ❌ PLANEJADO V1/V2 (§19 — não é dívida do piloto): cupons/cortesias, KYC completo, payout automático/split de recebedores, antecipação, assentos/setores, multi-sessão, produtos extras, wallet passes, webhooks de saída/integrações, login social, transferência oficial com histórico, relatórios em background

---

## Detalhe por área (evidências)

### api-comprador

10 das 11 rotas da seção 13 (Público e comprador) estão implementadas com código real nos controllers de apps/api — services completos, sem stubs/TODOs, com validação Zod, idempotência nos pagamentos e testes cobrindo pedido/pagamento, transferência e reembolso. A única ausência é PATCH /v1/reservations/:id (alterar reserva), que não existe em nenhum controller. Divergências de caminho (não de funcionalidade) frente ao doc: catálogo público vive em /v1/public/events/:slug (inclusive availability, por slug e não por id) e refund-requests usa :publicToken em vez do id interno do pedido.

- ✅ **GET /v1/events/:slug** — apps/api/src/catalog/public-catalog.controller.ts:16-19 (@Controller("v1/public/events") + @Get(":slug")) -> catalog.service.ts:122-141 (getPublicEvent: busca evento PUBLISHED com venue, ticketTypes e lots ativos)
  - falta: Nada funcional. Observação: o caminho real é GET /v1/public/events/:slug (prefixo /public a mais em relação ao doc). Existe também GET /v1/public/events (listagem) como extra.
- ✅ **GET /v1/events/:id/availability** — apps/api/src/catalog/public-catalog.controller.ts:21-24 (@Get(":slug/availability")) -> catalog.service.ts:143-162 (getPublicAvailability consulta InventoryService.getAvailability por lote)
  - falta: Nada funcional. Observação: caminho real é GET /v1/public/events/:slug/availability — usa slug, não id, e tem o prefixo /public.
- ✅ **POST /v1/reservations** — apps/api/src/reservations/reservations.controller.ts:12-19 (@Controller("v1/reservations") + @Post, com RateLimit e Zod) -> reservations.service.ts:15-76 (valida lote/maxPerOrder, transação com InventoryService.tryReserve, TTL 10min, job de expiração na fila). Teste de concorrência em apps/api/src/__tests__/inventory-concurrency.test.ts
- ❌ **PATCH /v1/reservations/:id** — não encontrado — grep por Patch em apps/api/src/reservations/ e apps/api/src/orders/ retorna vazio; o controller só tem @Post() e @Get(":id") (reservations.controller.ts:12-24)
  - falta: Não existe nenhum handler PATCH para alterar itens/quantidades de uma reserva ativa. O fluxo atual força criar uma nova reserva para mudar o carrinho.
- ✅ **POST /v1/orders** — apps/api/src/orders/orders.controller.ts:11-17 (@Controller("v1/orders") + @Post) -> orders.service.ts:17-78 (createFromReservation: converte reserva ACTIVE->CONVERTED com guarda de corrida via updateMany, cria order PAYMENT_PENDING com janela de 15min, remove job de expiração). Coberto por apps/api/src/__tests__/order-payment-flow.test.ts
- ✅ **POST /v1/orders/:id/payments/pix** — apps/api/src/payments/payments.controller.ts:10-17 (@Controller("v1/orders/:orderId/payments") + @Post("pix")) -> payments.service.ts:11-77 (idempotência via header, reuso de cobrança Pix pendente, gateway.createPixCharge real, persiste QR e expiresAt)
- ✅ **POST /v1/orders/:id/payments/card** — apps/api/src/payments/payments.controller.ts:19-26 (@Post("card")) -> payments.service.ts:79-132 (gateway.createCardPayment com cardToken/installments, aplica resultado via applyGatewayStatus — mesmo caminho idempotente dos webhooks)
- ✅ **GET /v1/orders/:publicToken/status** — apps/api/src/orders/orders.controller.ts:19-22 (@Get(":publicToken/status")) -> orders.service.ts:80-104 (findByPublicToken retorna order + items + payments com campos públicos selecionados + tickets)
- ✅ **GET /v1/me/tickets** — apps/api/src/tickets/tickets.controller.ts:17-21 (@Get("me/tickets") com @UseGuards(SessionGuard) e @CurrentUserId) -> tickets.service.ts:34-48 (findByUser: tickets ISSUED/ACTIVE/CHECKED_IN do usuário com lote/tipo/evento)
- ✅ **POST /v1/tickets/:id/transfer** — apps/api/src/tickets/tickets.controller.ts:23-26 (@Post("tickets/:id/transfer")) -> tickets.service.ts:57-108 (transferTicket: prova de posse via orderPublicToken, valida status, reassina QR Ed25519 com nonce novo invalidando o QR antigo, grava auditLog). Teste dedicado em apps/api/src/__tests__/ticket-transfer.test.ts
- ✅ **POST /v1/orders/:id/refund-requests** — apps/api/src/refund-requests/refund-requests.controller.ts:10-17 (@Controller("v1/orders") + @Post(":publicToken/refund-requests")) -> refund-requests.service.ts:12-29 (exige order PAID/FULFILLED, bloqueia duplicidade de PENDING, cria RefundRequest; execução do estorno fica no admin). Teste em apps/api/src/__tests__/refund-request.test.ts
  - falta: Nada funcional. Observação: o parâmetro real é :publicToken (token público do pedido), não o id interno — coerente com o fluxo de compra sem conta.

### api-produtor

Das 13 rotas de produtor da seção 13, 9 estão implementadas de verdade (controllers com SessionGuard, validação Zod, checagem de permissão por organização e queries Prisma reais — nada de stub) e são consumidas pelo frontend apps/producer. Ausências confirmadas: cupons e cortesias NÃO existem em camada nenhuma (sem rota, sem contract, sem tabela no schema.prisma); reembolso iniciado pelo produtor não existe (refund é só admin da plataforma + refund-request do comprador); financial-summary por evento não existe (só balance/ledger por organização). Ressalva de teste: nenhum teste automatizado em apps/api/src/__tests__ exercita as rotas de produtor via HTTP (helpers seedam direto via prisma) — a validação foi manual/no navegador.

- ✅ **POST /v1/organizations** — apps/api/src/organizations/organizations.controller.ts:13 (@Post sob @Controller("v1/organizations"), SessionGuard); service real em organizations.service.ts:20-42 (cria org + membro owner via prisma)
- ✅ **POST /v1/events (criar evento)** — apps/api/src/events/events.controller.ts:13 — implementado como POST /v1/organizations/:organizationId/events; service em events.service.ts:20-37 com assertPermission(EVENT_CREATE) e prisma.event.create
  - falta: Nada funcional; apenas o path difere do doc (aninhado sob organization em vez de POST /v1/events plano). Frontend producer consome essa rota.
- ✅ **PATCH /v1/events/:id** — apps/api/src/events/events.controller.ts:27; service events.service.ts:48-66 (NotFound + assertPermission + prisma.event.update)
- ✅ **POST /v1/events/:id/publish** — apps/api/src/events/events.controller.ts:36; service events.service.ts:68-82 (permissão EVENT_PUBLISH, transição DRAFT→PUBLISHED com publishedAt)
- ✅ **POST /v1/events/:id/ticket-types** — apps/api/src/catalog/catalog.controller.ts:13 (ZodBody(createTicketTypeSchema), SessionGuard); catalog.service.ts implementa createTicketType
- ✅ **POST /v1/ticket-types/:id/lots** — apps/api/src/catalog/catalog.controller.ts:22; há ainda POST /v1/ticket-lots/:lotId/activate (catalog.controller.ts:31) para ativação de lote
- ✅ **GET /v1/events/:id/dashboard** — apps/api/src/dashboard/dashboard.controller.ts:11; service dashboard.service.ts:19-80 (agregações reais: orders groupBy, tickets groupBy, lotes com sold/reserved/available, revenueCents)
- ✅ **GET /v1/events/:id/orders** — apps/api/src/dashboard/dashboard.controller.ts:16; service dashboard.service.ts:82-116 com filtro por status e paginação (pageSize cap 100)
- ✅ **GET /v1/events/:id/participants** — apps/api/src/dashboard/dashboard.controller.ts:31; extra: GET participants/export em CSV (dashboard.controller.ts:36, service :123-143)
- ❌ **POST /v1/events/:id/coupons** — não encontrado — grep por coupon/desconto/discount em apps/api/src e packages retorna zero; schema.prisma (packages/database/prisma/schema.prisma) não tem model Coupon
  - falta: Tudo: não existe rota, service, contract nem tabela no banco. Cupons NÃO existem no código, em nenhuma camada.
- ❌ **POST /v1/events/:id/complimentary-tickets** — não encontrado — grep por complimentary/cortesia/courtesy em apps/api/src e packages retorna zero; nenhum model relacionado no schema.prisma
  - falta: Tudo: rota, service, contract e modelo de dados. Cortesias NÃO existem no código, em nenhuma camada.
- ❌ **POST /v1/orders/:id/refunds (reembolso iniciado pelo produtor)** — não encontrado como rota de produtor. O que existe: POST /v1/orders/:publicToken/refund-requests (comprador, refund-requests.controller.ts:10) e POST /v1/admin/orders/:publicToken/refund + approve/reject de refund-requests (admin.controller.ts:87,101,110), todos guardados por assertAdmin (admin.service.ts)
  - falta: Rota para o PRODUTOR reembolsar pedido do seu evento. Hoje só o admin da plataforma executa refund; produtor não tem endpoint nem permissão para isso.
- 🟡 **GET /v1/events/:id/financial-summary** — rota por evento não existe; substitutos parciais: GET /v1/organizations/:id/balance e /ledger (finance.controller.ts:11,16, com FINANCE_VIEW e ledger real) e revenueCents no dashboard do evento (dashboard.service.ts:51-57)
  - falta: Endpoint de resumo financeiro POR EVENTO (bruto, taxas, líquido, reembolsos por evento). O financeiro atual é agregado por organização (balance/ledger) e o dashboard só traz revenueCents bruto.

### api-validacao-integ

Núcleo de validação está sólido e verificado no código: login por PIN + registro de device (fundidos numa chamada), refresh de token, manifesto completo e delta, check-in online com verificação Ed25519 server-side e first-wins atômico (testado sob corrida com 8 devices), sync offline idempotente por (device,batchKey) com constraints reais no Prisma, reversão com auditoria, painel ao vivo e bloqueio remoto. Webhook de pagamentos é o mais maduro do lote (raw body persistido, assinatura fail-closed, idempotência por evento externo, bem testado). Lacunas contra o doc: 4 rotas FALTANDO (GET /v1/validator/events, webhooks de mensagens e todo o módulo /v1/integrations/webhooks GET+POST); PARCIAL relevante: o manifesto não é assinado em si (só transporta a pubkey) e não tem regras de reentrada nem escopo por portão; sync, reverse e checkin-live não têm teste automatizado do caminho, e reverse/checkin-live não têm consumidor em nenhum frontend web. Divergência aceitável documentável: devices/register foi fundido em /sessions.

- ✅ **POST /v1/validator/sessions (login por PIN do validador)** — apps/api/src/validator/validator.controller.ts:81-85 + validator.service.ts:111-158
  - falta: Nada essencial. Implementação real: verifica PIN (hash por evento via verifyValidatorPin), checa expiração, gera device token (só hash persistido), devolve evento + checkinPoints. Sem teste automatizado do login, mas caminho é usado pelo app de check-in.
- 🟡 **POST /v1/validator/devices/register** — apps/api/src/validator/validator.controller.ts:80-85 (fundido em POST /v1/validator/sessions)
  - falta: A rota separada do doc não existe. O registro do aparelho foi deliberadamente fundido no /sessions (body {session, device} — sessionWithDeviceSchema em validator.controller.ts:24-27). A funcionalidade existe por inteiro; o endpoint standalone especificado no §13, não.
- ✅ **POST /v1/validator/devices/:id/refresh** — apps/api/src/validator/validator.controller.ts:87-91 + validator.service.ts:161-171
  - falta: Nada: rotaciona token com ValidatorDeviceGuard e recusa renovar aparelho alheio (device.id !== deviceId → 400). Sem teste automatizado.
- ❌ **GET /v1/validator/events (listar eventos do validador)** — não encontrado (grep por 'validator/events' sem rota GET simples; ValidatorController só tem sessions, refresh, manifest, manifest/delta)
  - falta: Rota inexistente. Mitigação de fato: o device é escopado a 1 evento e os dados do evento voltam na resposta do /sessions (validator.service.ts:140-157), então o app nunca precisa listar eventos — mas a rota do §13 não existe.
- ✅ **GET /v1/validator/events/:id/manifest** — apps/api/src/validator/validator.controller.ts:93-97 + validator.service.ts:174-211
  - falta: Rota real e funcional: devolve chave pública Ed25519 (eventSigningKey), lista de tickets com status (revogados aparecem via status), manifestVersion e evento. Ressalvas: o :eventId da URL é ignorado (usa device.eventId do guard — seguro, mas a URL é cosmética) e não há paginação para eventos grandes. Sem teste automatizado.
- ✅ **GET /v1/validator/events/:id/manifest/delta** — apps/api/src/validator/validator.controller.ts:99-107 + validator.service.ts:187-191 (filtro updatedAt > since)
  - falta: Funciona via ?since=; ressalva: data inválida em `since` silenciosamente devolve manifesto completo em vez de 400. Sem teste automatizado do delta.
- ✅ **POST /v1/checkins (check-in online)** — apps/api/src/checkins/checkins.controller.ts:13-17 + checkins.service.ts:27-59 e attemptCheckin :261-334; teste de corrida em apps/api/src/__tests__/checkin-race.test.ts:9
  - falta: Nada: verifica assinatura Ed25519 do qrToken no servidor (resolveTicket :339-353, confere eid do payload), aceita fallback por code, transição atômica via updateMany com guarda de status (exatamente 1 vence — testado com 8 devices concorrentes), classifica ALREADY_USED/CANCELED/INVALID e registra CONFLICT com firstCheckin (quando/qual aparelho).
- 🟡 **POST /v1/checkins/sync (lote offline idempotente)** — apps/api/src/checkins/checkins.controller.ts:19-23 + checkins.service.ts:67-168; unique(deviceId,batchKey) schema.prisma:720 e unique(deviceId,localSeq) schema.prisma:701
  - falta: Implementação completa e correta (reenvio do batchKey devolve o MESMO resultado; recuperação de lote interrompido via P2002 por localSeq; primeiro vence e demais viram CONFLICT; corrida na gravação do batch tratada; lastSyncAt atualizado). O que falta: NENHUM teste automatizado do caminho de sync/idempotência do lote (checkin-race.test.ts só cobre o create concorrente) — para um caminho crítico de correção offline, isso impede marcar COMPLETO.
- 🟡 **POST /v1/checkins/:id/reverse** — apps/api/src/checkins/checkins.controller.ts:25-29 + checkins.service.ts:171-213
  - falta: Código completo (permissão CHECKIN_PERFORM, transação com guarda de status contra dupla reversão, volta ticket a ACTIVE, grava auditLog). Falta: nenhum consumidor real — producer-web não chama a rota (grep em apps/producer sem hits) — e nenhum teste automatizado.
- 🟡 **GET /v1/events/:id/checkin-live** — apps/api/src/checkins/checkins.controller.ts:31-35 + checkins.service.ts:216-253
  - falta: Rota implementada (totais, checked-in, ritmo/minuto, agrupamento por portão, com permissão). Falta: nenhum frontend consome (producer-web não tem tela ao vivo — página portaria só gerencia pontos/credenciais/devices) e nenhum teste automatizado.
- ✅ **POST /v1/webhooks/payments/:provider** — apps/api/src/webhooks/webhooks.controller.ts:10-19 + webhooks.service.ts:24-132; rawBody habilitado em main.ts:11; testes em packages/payments/src/pagarme.test.ts:139-181, mock.test.ts:6 e __tests__/order-payment-flow.test.ts:20 (duplicado é no-op)
  - falta: Nada: payload bruto sempre persistido (WebhookDelivery, mesmo rejeitado), assinatura verificada fail-closed antes de qualquer efeito (Pagar.me com Basic/HMAC — pagarme.ts:208+), idempotência por unique(provider, externalEventId) (schema.prisma:533), headers Authorization/Cookie nunca persistidos.
- ❌ **POST /v1/webhooks/messages/:provider (inbound de mensageria/WhatsApp)** — não encontrado (WebhooksController só tem payments/:provider; NotificationsController só tem :publicToken/resend e :publicToken/push-token)
  - falta: Nenhuma rota para receber callbacks de provedores de mensagem (status de entrega de WhatsApp/e-mail, respostas). Envio existe; recepção de webhook de mensagens, não.
- ❌ **GET /v1/integrations/webhooks (listar webhooks de produtores)** — não encontrado (grep por 'integrations' em apps/api/src sem nenhum hit)
  - falta: Todo o módulo de webhooks de saída para produtores/integradores inexiste — sem modelo, sem rota, sem worker de entrega.
- ❌ **POST /v1/integrations/webhooks (cadastrar webhook de produtor)** — não encontrado (mesmo grep; nenhum controller/módulo 'integrations')
  - falta: Idem: cadastro de endpoints de webhook por organização não existe.
- ✅ **§12 QR assinado Ed25519 (version, event, ticket, setor, nonce, issued_at, signature)** — packages/tickets/src/qr-token.ts:12-49 (payload v/eid/tid/lid/n/iat + assinatura, formato BF1.<payload>.<sig>); assinado na emissão em apps/worker/src/issue-tickets.ts:35 com chave por evento (:163-171); verificado no servidor em checkins.service.ts:346; teste packages/tickets/src/qr-token.test.ts:11
  - falta: Nada: todos os campos do §12 presentes (setor = lid/ticketLotId), chave Ed25519 gerada por evento, privada só no servidor (EventSigningKey), pública distribuída via manifesto.
- 🟡 **§12 Manifesto assinado (pubkey, revogados, reentrada, versão, escopo)** — apps/api/src/validator/validator.service.ts:174-211
  - falta: Entrega pubkey, tickets com status (revogação visível), manifestVersion, delta e escopo implícito por device autenticado. Falta do que o §12 pede: (1) o manifesto em si NÃO é assinado — só transporta a chave pública, então sua integridade depende só do TLS; (2) nenhuma regra de reentrada no payload; (3) sem filtro por portão/setor ('ingressos permitidos para aquele portão' — devolve todos os tickets do evento).
- ✅ **§12 Servidor aceita o primeiro check-in e marca os demais como conflito** — apps/api/src/checkins/checkins.service.ts:261-334 (attemptCheckin: updateMany com guarda ISSUED/ACTIVE; perdedores geram Checkin status CONFLICT com localSeq/device/portão); provado sob concorrência em __tests__/checkin-race.test.ts:9
  - falta: Nada: first-wins atômico + trilha de conflito com auditoria (qual aparelho validou primeiro e quando é devolvido ao perdedor).
- ✅ **§12 Bloqueio remoto de dispositivo comprometido** — apps/api/src/validator/validator.controller.ts:64-71 (POST /v1/events/:eventId/validator-devices/:deviceId/block) + validator-device.guard.ts:31-38 (status !== ACTIVE corta na hora); consumido pelo producer-web em apps/producer/app/eventos/[eventId]/portaria/page.tsx:65
  - falta: Nada: rota com permissão do produtor, guard rejeita BLOCKED em toda chamada seguinte, e há UI real usando.

### dados

De 40 tabelas do §8, 28 existem completas no schema.prisma com constraints reais e uso no código. Faltam 12: event_sessions, event_media, event_categories, event_policies, sectors, seats, products, payment_attempts, coupons, coupon_redemptions, ticket_transfers, ticket_versions, ticket_revocations e payout_items (refunds e platform_fees existem só parcialmente via refund_requests e colunas de override + ledger; order_participants vive como 2 campos no Ticket). O núcleo de venda/pagamento/check-in/ledger está sólido; os buracos são catálogo avançado (sessões, assentos, produtos), descontos, transferência/revogação de ingresso e reconciliação de repasse. Das 7 regras do banco: centavos inteiros OK; timezone violada (tudo TIMESTAMP sem tz); UUIDv4 em vez de v7/ULID; organization_id só nas entidades de topo; nenhum CHECK constraint; append-only sem enforcement no banco; CPF sem proteção alguma (coluna plana e não usada).

- ✅ **users** — packages/database/prisma/schema.prisma:28-45 (@@map("users"))
- ✅ **user_identities** — packages/database/prisma/schema.prisma:47-59 (@@map("user_identities"), unique(provider, providerId))
- ✅ **otp_challenges** — packages/database/prisma/schema.prisma:67-82 (@@map("otp_challenges"), codeHash/attempts/expiresAt)
- ✅ **organizations** — packages/database/prisma/schema.prisma:100-123 (@@map("organizations"), status + overrides de taxa)
- ✅ **organization_members** — packages/database/prisma/schema.prisma:166-182 (@@map("organization_members"), unique(organizationId, userId))
- ✅ **roles** — packages/database/prisma/schema.prisma:125-136 (@@map("roles")); join role_permissions em 149-158
- ✅ **permissions** — packages/database/prisma/schema.prisma:138-147 (@@map("permissions"))
- ✅ **organizer_verifications** — packages/database/prisma/schema.prisma:190-205 (@@map("organizer_verifications"), status/reviewedBy)
- ✅ **bank_accounts** — packages/database/prisma/schema.prisma:207-224 (@@map("bank_accounts"), pixKey/isDefault)
- ✅ **events** — packages/database/prisma/schema.prisma:255-286 (@@map("events"), EventStatus com máquina de estados do §9)
- ❌ **event_sessions** — não encontrado
  - falta: Nenhum model de sessões/dias múltiplos. Event tem startsAt/endsAt únicos (schema.prisma:264-265) — evento multi-sessão não é representável.
- ✅ **venues** — packages/database/prisma/schema.prisma:230-244 (@@map("venues"), FK opcional em Event.venueId:258)
- ❌ **event_media** — não encontrado
  - falta: Só existe Event.bannerUrl (schema.prisma:262) — campo único, sem tabela de galeria/mídias.
- ❌ **event_categories** — não encontrado
  - falta: Nenhum model/enum de categoria; Event não tem campo category. Sem filtro por categoria no catálogo.
- ❌ **event_policies** — não encontrado
  - falta: Nenhuma tabela de políticas (reembolso, meia-entrada, idade mínima) por evento.
- ✅ **ticket_types** — packages/database/prisma/schema.prisma:288-302 (@@map("ticket_types"))
- ✅ **ticket_lots** — packages/database/prisma/schema.prisma:312-336 (@@map("ticket_lots"), capacity/soldCount/reservedCount; uso real anti-oversell em apps/api/src/inventory/inventory.service.ts:28,49)
- ❌ **sectors** — não encontrado
  - falta: Sem setores/mapa de casa; apenas ticket_types planos.
- ❌ **seats** — não encontrado
  - falta: Sem assentos numerados em nenhum model.
- ❌ **products** — não encontrado
  - falta: Sem tabela de produtos extras (bar, estacionamento, combos).
- ✅ **reservations** — packages/database/prisma/schema.prisma:349-366 (@@map("reservations"), status+expiresAt indexados, máquina do §9)
- ✅ **reservation_items** — packages/database/prisma/schema.prisma:368-381 (@@map("reservation_items"), snapshot de price/fee)
- ✅ **orders** — packages/database/prisma/schema.prisma:396-425 (@@map("orders"), publicToken, OrderStatus completo com REFUND/CHARGEBACK)
- ✅ **order_items** — packages/database/prisma/schema.prisma:427-441 (@@map("order_items"))
- 🟡 **order_participants** — packages/database/prisma/schema.prisma:587-588 (Ticket.attendeeName/attendeeEmail)
  - falta: Não existe tabela order_participants; nomeação de participante vive como 2 campos opcionais no Ticket, sem CPF/documento do participante e sem entidade própria por item do pedido.
- ✅ **payments** — packages/database/prisma/schema.prisma:492-517 (@@map("payments"), unique(provider, externalId), idempotencyKey)
- ❌ **payment_attempts** — não encontrado
  - falta: Sem tabela de tentativas; retentativas de cartão viram novas linhas em payments (implícito), sem histórico estruturado de attempt por payment.
- ✅ **payment_events** — packages/database/prisma/schema.prisma:521-536 (@@map("payment_events"), unique(provider, externalEventId) p/ idempotência)
- 🟡 **refunds** — packages/database/prisma/schema.prisma:473-490 (refund_requests) + admin/admin.service.ts (refundOrder)
  - falta: Existe refund_requests (workflow de pedido do comprador) e statuses REFUNDED em Payment/Order, mas não há tabela refunds registrando o estorno executado (valor, externalRefundId do gateway, parcial vs total). Estorno parcial não é representável.
- ❌ **coupons** — não encontrado
  - falta: Nenhum model de cupom; checkout não tem campo de desconto.
- ❌ **coupon_redemptions** — não encontrado
  - falta: Depende de coupons, que não existe.
- ✅ **tickets** — packages/database/prisma/schema.prisma:577-605 (@@map("tickets"), code unique, qrToken, unique(orderItemId, seq)); chave de assinatura em event_signing_keys:780-791
- ❌ **ticket_transfers** — não encontrado
  - falta: TicketStatus tem valor TRANSFERRED (schema.prisma:572) mas não existe tabela de transferência nem endpoint que a use — o status é letra morta.
- ❌ **ticket_versions** — não encontrado
  - falta: Sem versionamento de QR: Ticket tem um único qrToken (schema.prisma:585); reemissão/rotação de QR pós-transferência não é suportada.
- ✅ **checkin_points** — packages/database/prisma/schema.prisma:612-624 (@@map("checkin_points"), unique(eventId, name))
- ✅ **validator_credentials** — packages/database/prisma/schema.prisma:627-641 (@@map("validator_credentials"), pinHash/expiresAt)
- ✅ **validator_devices** — packages/database/prisma/schema.prisma:650-668 (@@map("validator_devices"), tokenHash, status BLOCKED p/ corte remoto)
- ✅ **checkins** — packages/database/prisma/schema.prisma:683-705 (@@map("checkins"), unique(deviceId, localSeq), status CONFLICT/REVERSED)
- ✅ **checkin_sync_batches** — packages/database/prisma/schema.prisma:709-722 (@@map("checkin_sync_batches"), unique(deviceId, batchKey))
- ❌ **ticket_revocations** — não encontrado
  - falta: Sem tabela de revogação; cancelamento vive só em Ticket.status/canceledAt. Lista de revogados para o manifesto offline precisa ser derivada por scan de tickets, sem trilha própria (quem revogou, quando, motivo).
- ✅ **ledger_accounts** — packages/database/prisma/schema.prisma:799-808 (@@map("ledger_accounts"), 1:1 com organization)
- ✅ **ledger_entries** — packages/database/prisma/schema.prisma:820-835 (@@map("ledger_entries"), tipos SALE_CREDIT/PLATFORM_FEE/REFUND_DEBIT/PAYOUT_DEBIT, referenceType/referenceId)
- ✅ **payouts** — packages/database/prisma/schema.prisma:845-859 (@@map("payouts"); execução bancária real é manual, admitido no comentário 843-844)
- ❌ **payout_items** — não encontrado
  - falta: Payout tem só amountCents agregado; não há tabela ligando o repasse aos pedidos/lançamentos que o compõem — reconciliação item a item impossível.
- 🟡 **platform_fees** — packages/database/prisma/schema.prisma:107-110 (Organization.pixFeeBps/pixFeeFloorCents/cardFeeBps) + LedgerEntryType.PLATFORM_FEE:812
  - falta: Não existe tabela platform_fees; configuração vive como 3 colunas de override em organizations e a cobrança como lançamento no ledger. Sem histórico de vigência de taxas nem taxas por evento/método além de Pix/cartão.
- ✅ **webhook_deliveries** — packages/database/prisma/schema.prisma:547-562 (@@map("webhook_deliveries"), rawBody/headers/signatureValid guardados mesmo em rejeição)
- ✅ **outbox_events** — packages/database/prisma/schema.prisma:872-886 (@@map("outbox_events"), status/attempts/availableAt)
- ✅ **notifications** — packages/database/prisma/schema.prisma:742-759 (@@map("notifications"), fila persistente com retry); push_tokens extra em 764-775
- ✅ **audit_logs** — packages/database/prisma/schema.prisma:902-915 (@@map("audit_logs"), actor/entity/metadata indexados)
- ✅ **idempotency_keys** — packages/database/prisma/schema.prisma:888-900 (@@map("idempotency_keys"), requestHash/lockedAt/responseBody)
- ✅ **Regra: valores monetários em centavos inteiros** — schema.prisma:316-317, 406, 498, 824, 848 — todos os valores são Int *Cents; nenhum Decimal/Float monetário no schema
- ❌ **Regra: datas sempre com timezone** — migrations/20260723015128_init/migration.sql:29-56 — todas as colunas são TIMESTAMP(3) sem time zone (default do Prisma); grep por timestamptz nas 10 migrations retorna zero
  - falta: Nenhuma coluna usa timestamptz. A app compensa gravando UTC, mas a regra do §8 ('datas sempre com timezone') não está cumprida no banco.
- 🟡 **Regra: IDs UUIDv7 ou ULID, nunca sequenciais expostos** — schema.prisma:29 etc. — @default(uuid()) em todos os models (UUIDv4 do Prisma), colunas UUID no banco (init/migration.sql:24)
  - falta: Nenhum ID sequencial exposto (ok), mas os IDs são UUIDv4 aleatórios, não UUIDv7/ULID ordenáveis como a regra pede — sem uuid(7) no schema nem geração v7 no código.
- 🟡 **Regra: organization_id nas entidades multi-tenant** — schema.prisma:168, 192, 209, 232, 257, 801, 847, 905 — organization_id em members, verifications, bank_accounts, venues, events, ledger_accounts, payouts, audit_logs
  - falta: Entidades de venda/ingresso (ticket_types, ticket_lots, reservations, orders, tickets, checkins) não carregam organization_id direto — tenancy só via cadeia eventId→organizationId, exigindo join para qualquer filtro por tenant.
- 🟡 **Regra: constraints e índices para garantir integridade** — schema.prisma:513 unique(provider,externalId), 600 unique(orderItemId,seq), 701 unique(deviceId,localSeq), 720 unique(deviceId,batchKey), 533 unique(provider,externalEventId) + índices de status/expiração
  - falta: Uniques e índices críticos existem, mas zero CHECK constraints nas migrations (grep vazio): sold_count+reserved_count<=capacity, amount_cents>0, quantity>0 são garantidos só em SQL da aplicação (inventory.service.ts:28), não pelo banco.
- 🟡 **Regra: lançamentos financeiros e auditoria append-only** — schema.prisma:817-835 — LedgerEntry sem updatedAt e comentário 'nunca editar'; audit_logs idem
  - falta: Append-only é só convenção de código: nenhum trigger, RULE ou REVOKE UPDATE/DELETE nas migrations (grep vazio). Qualquer código com o client Prisma pode dar update/delete em ledger_entries e audit_logs.
- ❌ **Regra: CPF e documentos protegidos, acesso só a funções autorizadas** — schema.prisma:33 (users.cpf String? plano); grep de 'cpf' em apps/api/src retorna zero fora do schema
  - falta: Coluna cpf existe em texto plano, sem criptografia/mascaramento e sem qualquer mecanismo de autorização por função para lê-la; hoje ela simplesmente não é usada pela API (campo morto). Organization.document e BankAccount.holderDocument também são texto plano sem controle de acesso dedicado.

### filas-workers

Das 12 filas sugeridas na seção 14, existem de fato 5 BullMQ queues em packages/queues (reservation-expiration, payment-reconciliation, order-expiration, outbox-dispatch, notification-delivery), todas com worker real em apps/worker/src/main.ts. Cobertura funcional dos 12 itens: 4 COMPLETOS diretos (reservation-expiration, payment-reconciliation, notification-delivery, ticket-delivery fundida em notification-delivery), 1 COMPLETO por mecanismo equivalente (ticket-issuance via outbox-dispatch), 3 PARCIAIS (refund-processing só cobre pagamento órfão — estorno admin é síncrono; payout-processing é 100% manual sem fila; checkin-reconciliation roda síncrona no endpoint de sync), e 4 FALTANDO por completo: wallet-pass-generation, report-generation, webhook-delivery de saída (só existe recepção de webhook do gateway) e media-processing. A idempotência exigida está implementada com guardas consistentes em todos os handlers, mas sem testes automatizados que re-executem os jobs do worker.

- ✅ **reservation-expiration** — packages/queues/src/reservation-expiration.ts:4 (RESERVATION_EXPIRATION_QUEUE="reservation-expiration"); apps/worker/src/main.ts:29-40 (worker + scheduler de reconciliação a cada 60s); apps/api/src/reservations/reservations.service.ts:11,69 (API enfileira job com delay por reserva)
- ✅ **payment-reconciliation** — packages/queues/src/payment-reconciliation.ts:8; apps/worker/src/main.ts:53-60 (scheduler a cada 60s) -> apps/worker/src/reconcile-payments.ts (consulta gateway p/ pagamentos abertos >2min, reusa applyGatewayStatus idempotente)
- ✅ **ticket-issuance** — via outbox: packages/queues/src/outbox-dispatch.ts:9 + apps/worker/src/main.ts:43-50; apps/worker/src/process-outbox.ts:63-64 roteia "order.paid" -> issueTicketsForOrder (apps/worker/src/issue-tickets.ts:14) com guarda FULFILLED (linha 24) e unique(orderItemId,seq) p/ P2002 (linhas 64-66)
  - falta: Não existe fila com o nome "ticket-issuance" — a emissão roda dentro da fila outbox-dispatch (padrão outbox, mecanismo equivalente e mais robusto). Sem teste automatizado que execute issueTicketsForOrder duas vezes (a idempotência é visível no código mas não coberta por teste direto).
- ✅ **ticket-delivery** — fundida em notification-delivery: apps/worker/src/issue-tickets.ts:81-122 cria linhas Notification (EMAIL/WHATSAPP/PUSH, template ticket_delivery) na mesma transação do FULFILLED; entrega em apps/worker/src/deliver-notifications.ts:23-96 (renderiza e envia via @borafest/notifications)
  - falta: Não é fila separada — a entrega de ingresso é um template dentro de notification-delivery. Funcionalmente completo.
- ❌ **wallet-pass-generation** — não encontrado
  - falta: Zero ocorrências de wallet/pkpass/passkit/Apple Wallet/Google Wallet em packages/, apps/api/ e apps/worker/. Nenhuma fila, nenhum gerador de passe, nenhum modelo no schema.
- 🟡 **refund-processing** — apps/worker/src/process-outbox.ts:67-68,84-101 (evento outbox "payment.orphaned" -> refundOrphanedPayment com idempotencyKey refund_orphan_<id>); apps/api/src/admin/admin.service.ts:232-296 (refundOrder síncrono) e :311-330 (approveRefundRequest reusa refundOrder)
  - falta: Só o estorno de pagamento órfão é assíncrono (via outbox). O estorno manual/aprovação de solicitação roda síncrono no request HTTP do admin — se o gateway falhar, não há retry em fila. Não há processador de follow-up para status REFUND_PENDING. Não existe fila dedicada "refund-processing".
- 🟡 **payout-processing** — apps/api/src/admin/admin.service.ts:481-513 (createPayout cria registro Payout com saldo do ledger) e :515+ (markPayoutPaid manual); packages/database/prisma/schema.prisma:845 (model Payout); apps/api/src/common/ledger.ts (getAvailableForPayoutCents)
  - falta: Fluxo 100% manual: admin cria o payout e marca como pago à mão. Nenhuma fila, nenhum worker, nenhuma transferência automática via gateway/split. "payout-processing" como job assíncrono não existe.
- 🟡 **checkin-reconciliation** — apps/api/src/checkins/checkins.controller.ts:19 (POST v1/validator/checkins/sync); apps/api/src/checkins/checkins.service.ts:67-160 (sync idempotente por batch com CheckinSyncBatch, classificação de conflitos linhas 300-332)
  - falta: A reconciliação acontece síncrona no endpoint de sync do validador, não em fila/worker. Funciona para o fluxo offline-first, mas não há job em background que reconcilie check-ins (ex.: varredura periódica de conflitos pendentes).
- ❌ **report-generation** — não encontrado
  - falta: Nenhuma fila, worker ou código de geração de relatório em packages/queues, apps/worker ou apps/api (grep por "report" só bate em validator-device.guard.ts, sem relação). O módulo dashboard existe mas serve consultas síncronas, não relatórios gerados em background.
- ❌ **webhook-delivery (saída)** — não encontrado (apenas ENTRADA: apps/api/src/webhooks/webhooks.controller.ts:10 POST v1/webhooks/payments/:provider)
  - falta: O que existe é recepção de webhooks do gateway; o model WebhookDelivery (schema.prisma:547) registra entregas RECEBIDAS. Não há sistema de webhooks de SAÍDA para produtores/integrações: nenhum endpoint de cadastro de webhook, nenhuma fila de entrega, nenhum retry de disparo.
- ✅ **notification-delivery** — packages/queues/src/notification-delivery.ts:9; apps/worker/src/main.ts:73-80 (tick a cada 5s); apps/worker/src/deliver-notifications.ts:23-69 (claim com guarda de status, backoff, MAX_ATTEMPTS=5 -> FAILED visível ao backoffice); canais EMAIL/WHATSAPP/PUSH via packages/notifications
- ❌ **media-processing** — não encontrado
  - falta: Nenhuma fila, worker ou código de upload/processamento de mídia (imagem de evento, resize, etc.) em packages/ ou apps/api. Grep por media/upload/image não retorna nada relevante.
- 🟡 **Requisito transversal: jobs idempotentes (aceitar repetição sem efeito duplicado)** — guardas visíveis em todos os handlers: apps/worker/src/issue-tickets.ts:24 (FULFILLED = no-op), :64-66 (unique orderItemId+seq), :82-86 (updateMany com guarda de status antes das notificações); apps/worker/src/process-outbox.ts:25-29 (claim PENDING->PROCESSING), :92 (idempotencyKey no refund); apps/worker/src/deliver-notifications.ts:32-36 (claim); checkins.service.ts:68-112 (batch de sync idempotente)
  - falta: O código implementa idempotência de forma consistente, mas nenhum teste automatizado executa os jobs do worker duas vezes (grep por processOutboxBatch/issueTicketsForOrder/deliverPendingNotifications nos *.test.ts não retorna nada). O único teste de duplicidade é o de webhook duplicado no ledger (apps/api/src/__tests__/order-payment-flow.test.ts:20,70-77).
- ✅ **OBSERVAÇÃO: filas extras fora da lista da seção 14** — order-expiration (packages/queues/src/order-expiration.ts:8, worker main.ts:63-70) e outbox-dispatch (packages/queues/src/outbox-dispatch.ts:9, main.ts:43-50) existem e não constam na lista de 12 — cobrem expiração de pedidos e o padrão outbox que substitui ticket-issuance/refund órfão/revogação

### seguranca

Dos 12 itens da seção 15, só 1 está COMPLETO (anti-enumeração via publicToken uuid + códigos aleatórios + QR assinado). 6 estão PARCIAIS com lacunas objetivas: RBAC é só por organização e hardcoded; sessão de validador limita evento mas não portão; rate limit cobre OTP/login/checkout mas o scanner e o PIN de validador caem só no default global 120/min; TLS ok mas nada em repouso (chave Ed25519 privada em texto plano no banco); auditoria cobre reembolso/saque/reversão mas NÃO publicação nem preço; backup/restore existem mas restauração nunca é testada por código. 5 FALTANDO por completo: MFA (zero segundo fator, inclusive nas ações financeiras do admin), acesso restrito a CPF/documentos (só colunas no schema, e verifyOtp devolve o user inteiro), retenção/anonimização (nenhum job), consentimento/política versionados (nada nos frontends nem no schema) e WAF/anti-bot (Caddy é só proxy TLS). Riscos extras vistos de passagem: CORS origin:true+credentials e rate limit confiando em x-forwarded-for.

- 🟡 **RBAC por organização e evento** — packages/auth/src/rbac.ts:1-27 (PERMISSIONS/ROLE_PERMISSIONS); apps/api/src/common/org-access.service.ts:7-22 (assertPermission via organizationMember+role); usado em events.service.ts:21/72, catalog.service.ts:18/41/63, finance.service.ts:12/23, checkins.service.ts:178/219, validator.service.ts:218, organizations.service.ts:62; staff da plataforma em common/platform-access.service.ts:7-22
  - falta: RBAC é só por organização — não existe escopo por evento (qualquer membro com a permissão age em todos os eventos da org). Papéis/permissões estão hardcoded no TS (roleHasPermission usa mapa estático pelo role.key); os models Role/Permission/RolePermission do banco (schema.prisma:125-157) não são consultados na checagem. Papel 'operator' (CHECKIN_PERFORM) existe mas o fluxo de check-in real autentica por device token, não por esse papel.
- ❌ **MFA para administradores e ações financeiras** — não encontrado — grep por mfa/totp/2fa em apps/api e packages retorna zero; admin.controller.ts:15-16 usa apenas SessionGuard + assertAdmin/assertStaff (platform-access.service.ts); login é fator único (OTP por e-mail, identity.service.ts)
  - falta: Nenhum segundo fator em lugar nenhum. Ações financeiras críticas (admin.order.refund, admin.payout.create/mark_paid em admin.service.ts:280/501/545) exigem só a sessão JWT comum de quem tem platformRole admin.
- 🟡 **Sessão de validador limitada a evento/portão** — apps/api/src/validator/validator.service.ts:111-157 (createSessionAndRegisterDevice: PIN válido só para o eventId, device criado com eventId); validator-device.guard.ts:16-49 (token hasheado, credencial ativa/expiração, BLOCKED corta na hora); checkins.service.ts:28 e 86-88 (resolveTicket/sync filtram por device.eventId)
  - falta: Limitação por evento está real e enforced. Limitação por PORTÃO não: checkinPointId é opcional por scan (checkins.service.ts:33-35 só valida que o ponto pertence ao evento) — a sessão/dispositivo não fica vinculada a um portão específico. Também não há @RateLimit dedicado no POST /v1/validator/sessions (tentativa de PIN cai só no default 120/min por IP).
- 🟡 **Rate limit em OTP, login, checkout e scanner** — apps/api/src/common/rate-limit.guard.ts:21-55 registrado como APP_GUARD global (app.module.ts:46) com default 120/min por IP; OTP: identity.controller.ts:12 (otp/request 5/15min por IP+destination) e :18 (otp/verify 10/15min — que é o login, passwordless); checkout: reservations.controller.ts:13 (20/min); tentativas de OTP também limitadas no banco (OTP_MAX_ATTEMPTS=5, identity.service.ts:52)
  - falta: Scanner sem limite dedicado: POST /v1/checkins e /v1/checkins/sync (checkins.controller.ts:13/19) caem apenas no default global 120/min por IP. Idem POST /v1/validator/sessions (brute force de PIN). O contador do IP confia em x-forwarded-for (rate-limit.guard.ts:29) — spoofável se o Caddy não sobrescrever o header.
- ✅ **Proteção contra enumeração de pedido e ingresso** — schema.prisma:398 (Order.publicToken uuid aleatório @unique) usado nas rotas públicas orders.controller.ts:19 (GET :publicToken/status) e tickets.controller.ts:12 (GET orders/:publicToken/tickets); transferência exige match do publicToken (tickets.service.ts:66-69, ForbiddenException); código humano do ingresso aleatório 31^8 (packages/tickets/src/code.ts:7-15); ids são uuid; QR assinado Ed25519 com nonce (tickets.service.ts:80-90)
- 🟡 **Criptografia em trânsito e em repouso** — em trânsito: infra/docker/Caddyfile:1-18 (HTTPS automático Let's Encrypt na frente de api/checkout/producer/admin, portas 80/443 no docker-compose.prod.yml:144-145); segredos hasheados: OTP sha256+timingSafeEqual (packages/auth/src/otp.ts), PIN e device token com hash (validator.service.ts:60-64, validator-device.guard.ts:36)
  - falta: Em repouso não há nada: postgres:16-alpine com volume comum, sem encryption-at-rest nem criptografia de coluna. A chave privada Ed25519 de assinatura dos QRs fica em texto plano no banco (EventSigningKey.privateKeyPem, schema.prisma:780-790, lida em tickets.service.ts:90). Backups (pg_dump gzip) também sem criptografia.
- ❌ **Documentos e CPF com acesso restrito** — apenas colunas no schema: users.cpf (schema.prisma:33), organizations.document (:105), bank_accounts.holder_document (:211); grep por 'cpf' em apps/api/src retorna zero fora do schema
  - falta: Não existe caminho de coleta, mascaramento nem controle de acesso específico para CPF/documentos. verifyOtp devolve o objeto user inteiro (identity.service.ts:79 'return { token, user }'), então cpf vazaria na resposta de login se algum dia for preenchido. Nenhum select restritivo ou papel dedicado para dados sensíveis.
- 🟡 **Trilha de auditoria para publicação, preço, reembolso, saque e reversão** — model AuditLog (schema.prisma:902-914); escritas reais: admin.order.refund (admin.service.ts:280-283), admin.refund-request.reject (:353-356), admin.payout.create (:501-505), admin.payout.mark_paid (:545-549), checkin.reverse (checkins.service.ts:200-208), ticket.transfer (tickets.service.ts:98-105), block/unblock org e evento, set_fee, ticket.block (admin.service.ts:84/122/167/415); leitura em GET admin (admin.service.ts:435)
  - falta: Dois dos cinco itens exigidos pela seção não geram auditoria: PUBLICAÇÃO de evento (events.service.ts:68-80 publish() não cria auditLog) e MUDANÇA DE PREÇO (catalog/inventory services não têm nenhuma escrita em auditLog — grep vazio).
- ❌ **Retenção e anonimização de dados** — não encontrado — grep por anonimiz/retention/purge em apps e packages retorna zero; workers existentes são só expire-reservation, expire-orders, process-outbox, reconcile-payments, deliver-notifications (apps/worker/src/)
  - falta: Nenhum job de expurgo/anonimização de dados pessoais (otp_challenges antigos, pedidos, e-mails de participantes), nenhuma política de retenção implementada. O RETENTION_DAYS=14 de infra/scripts/backup.sh:15 é rotação de arquivos de backup, não retenção LGPD.
- ❌ **Consentimento e política de privacidade versionados** — não encontrado — nenhum model de consentimento no schema.prisma; grep por privacidade/consentimento/termos nos apps checkout/producer/admin retorna zero
  - falta: Tudo: registro de aceite com versão/timestamp, páginas de política/termos nos frontends, checkbox de consentimento no checkout e no cadastro.
- 🟡 **Backup, restauração testada e plano de desastre** — infra/scripts/backup.sh (pg_dump+gzip, promoção atômica do arquivo, cron diário sugerido, rotação 14 dias) e infra/scripts/restore.sh (drop+create+restore com confirmação, para api/worker antes); healthcheck-alert.sh existe
  - falta: 'Restauração testada' não existe como código: restore.sh comenta 'ver restore-drill abaixo' mas não há script de drill nem automação/CI que valide um restore. Backup fica no mesmo host (sem envio off-site), sem criptografia, e não há plano de desastre além dos comentários dos scripts.
- ❌ **WAF e proteção contra bots nas vendas concorridas** — não encontrado — infra/docker/Caddyfile:1-18 é só reverse_proxy com TLS; nenhuma menção a WAF/Cloudflare/Turnstile/captcha no repo
  - falta: Nenhum WAF nem desafio anti-bot na frente do checkout; a única mitigação é o rate limit de aplicação por IP (20/min em reservations), que não segura bot distribuído em venda concorrida. Agravante: CORS aberto com origin:true + credentials (apps/api/src/main.ts:14).

### mvp17-backoffice-obs

O núcleo funcional do MVP §17 está sólido no código: fluxo do comprador com Pix fim-a-fim (reserva → pedido → QR Ed25519 → reenvio), app de validação RN completo (PIN, scanner, offline SQLite, fila de sync, bloqueio de device) e backoffice praticamente 100% (8/8 itens com rota real no AdminController + páginas). As lacunas do comprador/produtor são de UI e integração: sem cartão no checkout, sem consentimento LGPD, e-mail/WhatsApp só com sender dev-log (nada real em produção), sem editar/despublicar evento, sem banner na prática e sem exibição do link público no painel. Observabilidade (§16) é o ponto mais fraco: nada de OpenTelemetry, Sentry ou Prometheus; só pino parcial (HTTP log desligado) e um shell script de healthcheck com alerta via webhook; as métricas listadas existem no máximo como endpoints de consulta ad-hoc. Do §5: sem OpenAPI/Swagger e sem refresh token rotativo para usuários (JWT fixo de 7 dias; só o device de validador rotaciona token).

- ✅ **§17 Comprador — página do evento** — apps/checkout/app/evento/[slug]/page.tsx + GET /v1/public/events/:slug (apps/api/src/catalog/public-catalog.controller.ts:16) e :slug/availability (:21)
- ✅ **§17 Comprador — tipos/lotes e quantidade** — apps/checkout/app/evento/[slug]/EventPurchaseForm.tsx:26-88 (seleção de lote/quantidade com preço+taxa)
- ✅ **§17 Comprador — carrinho e reserva** — POST /v1/reservations (apps/api/src/reservations/reservations.controller.ts:12); expiração tratada em apps/checkout/app/checkout/[reservationId]/page.tsx:33-36; maxPerOrder aplicado em reservations.service.ts:31
- 🟡 **§17 Comprador — convidado e OTP** — guest: checkout/[reservationId]/page.tsx:56-61 (sem conta); OTP: apps/api/src/identity/identity.controller.ts:11-21
  - falta: O checkout web nunca usa OTP (grep otp/consent em apps/checkout = zero). OTP só é usado no login do produtor. Não há fluxo de comprador autenticado (/v1/me/tickets existe mas sem UI).
- 🟡 **§17 Comprador — Pix e cartão** — Pix fim-a-fim: payments.controller.ts:10 + QR/copia-e-cola em checkout/[reservationId]/page.tsx:64-129; cartão só API: payments.controller.ts:19 e payments.service.ts:79 (gateway pagarme em packages/payments/src/pagarme.ts)
  - falta: Nenhuma UI de cartão no checkout — único botão é 'Pagar com Pix' (page.tsx:188). Falta formulário/tokenização de cartão no frontend.
- ✅ **§17 Comprador — taxa transparente** — apps/checkout/app/evento/[slug]/EventPurchaseForm.tsx:88 — '(ingresso X + taxa Y)' exibido por lote
- ✅ **§17 Comprador — confirmação em tempo real** — polling 3s com redirect ao FULFILLED (checkout/[reservationId]/page.tsx:68-77) e 4s na página do pedido (pedido/[publicToken]/page.tsx:35)
  - falta: Funciona via polling; não é SSE/WebSocket como §5 sugere (aceitável para o item do MVP).
- ✅ **§17 Comprador — ingresso com QR** — pedido/[publicToken]/page.tsx:89 (<QRCode value={ticket.qrToken}>); token assinado Ed25519 em packages/tickets/src/qr-token.ts:44-48
- 🟡 **§17 Comprador — envio por e-mail e WhatsApp** — worker enfileira EMAIL+WHATSAPP (apps/worker/src/issue-tickets.ts:91,101) e entrega via registry (apps/worker/src/deliver-notifications.ts)
  - falta: Só existem senders dev-log (packages/notifications/src/registry.ts — default devlog; nenhum adapter real de SMTP/Resend nem de WhatsApp no repo). Em produção nada é enviado de verdade.
- ✅ **§17 Comprador — checkout web responsivo** — apps/checkout/app/layout.tsx:13 (mx-auto max-w-xl, coluna única mobile-first, Tailwind em todas as páginas)
- 🟡 **§17 Comprador — abertura e recuperação do ingresso sem aplicativo** — pedido/[publicToken]/page.tsx abre ingressos no navegador sem login + reenvio (POST /v1/orders/:publicToken/resend, apps/api/src/notifications/notifications.controller.ts:10)
  - falta: Se o comprador perder o link, não há fluxo de recuperação na UI (ex.: OTP → meus ingressos). GET /v1/me/tickets existe (tickets.controller.ts:17) mas nenhuma página do checkout o consome.
- ❌ **§17 Comprador — consentimento LGPD** — não encontrado
  - falta: grep consent/lgpd em apps/checkout = zero. Sem checkbox, sem link de política de privacidade, sem registro de consentimento no fluxo de compra.
- ✅ **§17 Produtor — cadastro básico** — login OTP (apps/producer/lib/api.ts:48-54 + app/login/page.tsx) e criação de organização (POST /v1/organizations, organizations.controller.ts:13; página app/organizacoes)
- 🟡 **§17 Produtor — lista, criação e edição de evento** — lista/criação: events.controller.ts:13,22 + organizacoes/[orgId]/page.tsx:39; PATCH /v1/events/:id existe (events.controller.ts:27)
  - falta: Edição não existe no producer-web: eventsApi (apps/producer/lib/api.ts:99-113) não tem update e nenhuma página tem formulário de edição.
- 🟡 **§17 Produtor — publicar/despublicar** — publicar: POST /v1/events/:id/publish (events.controller.ts:36) + botão em eventos/[eventId]/page.tsx:65
  - falta: Despublicar não existe em lugar nenhum: sem rota unpublish, events.service.ts só faz DRAFT→PUBLISHED (linhas 74-80).
- 🟡 **§17 Produtor — banner** — campo bannerUrl no contrato e serviço (packages/contracts/src/events.ts:14; apps/api/src/events/events.service.ts:59; catalog.service.ts:112 expõe no público)
  - falta: Sem upload (nenhum storage/S3), sem campo de banner na UI do produtor (grep banner em apps/producer = zero) e o checkout não renderiza bannerUrl (grep em apps/checkout/app = zero). Só existe como string opcional na API.
- 🟡 **§17 Produtor — tipos, preços, taxas, estoque e limite** — UI cria tipo e lote com preço, taxa e capacidade (eventos/[eventId]/page.tsx:85-100 → catalog.controller.ts:13,22,31); maxPerOrder no schema (contracts/catalog.ts:15) e aplicado (reservations.service.ts:31)
  - falta: O limite por pedido (maxPerOrder) não é exposto no formulário do produtor — sempre cai no default 6; só configurável via API direta.
- ✅ **§17 Produtor — dashboard de vendas** — GET /v1/events/:eventId/dashboard (dashboard.controller.ts:11) + página apps/producer/app/eventos/[eventId]/dashboard/page.tsx (total, byStatus, lotes)
- 🟡 **§17 Produtor — link público** — página pública por slug funciona (apps/checkout/app/evento/[slug]/page.tsx); slug disponível em EventSummary (producer/lib/api.ts:67)
  - falta: O producer-web não exibe nem copia o link público do evento (grep por /evento/, copiar, publicUrl em apps/producer = zero). Produtor precisa montar a URL de cabeça.
- ✅ **§17 Produtor — configuração básica de portões e PIN** — apps/producer/app/eventos/[eventId]/portaria/page.tsx (criar portão, gerar PIN exibido uma vez, bloquear dispositivo) → rotas validator.controller.ts:36-64
- 🟡 **§17 Produtor — visão mínima de pedidos e participantes** — participantes: página + export CSV (participantes/page.tsx; dashboard.controller.ts:31,36); pedidos agregados por status no dashboard (dashboard/page.tsx:47-60)
  - falta: GET /v1/events/:eventId/orders existe (dashboard.controller.ts:16) mas o producer-web não lista pedidos individuais — só contagens por status.
- ✅ **§17 Validação — login por PIN** — apps/mobile-checkin/src/screens/PinLoginScreen.tsx:24 → POST /v1/validator/sessions (validator.controller.ts:81); verificação de hash do PIN em validator.service.ts:123-127
- ✅ **§17 Validação — evento e portão** — eventId+PIN no login (PinLoginScreen.tsx:12-38); checkinPoints retornados pela sessão e troca de portão via setCheckinPoint (SessionContext.tsx:42-46, usado no HomeScreen)
- ✅ **§17 Validação — scanner** — apps/mobile-checkin/src/screens/ScannerScreen.tsx:3,54 (expo-camera CameraView com leitura de QR)
- ✅ **§17 Validação — válido, inválido e já utilizado** — apps/mobile-checkin/src/checkin/attemptCheckin.ts:40-127 (VALID/INVALID/ALREADY_USED, inclusive offline) + ResultBanner.tsx:6-13 (cores/labels)
- ✅ **§17 Validação — busca manual** — apps/mobile-checkin/src/screens/ManualSearchScreen.tsx:20-29 (busca por código no SQLite local via searchTicketsByCode e check-in a partir do resultado)
- ✅ **§17 Validação — aplicativo React Native para Android e iOS** — apps/mobile-checkin (Expo/RN; app.json com blocos ios e android, linhas 11 e 18)
- ✅ **§17 Validação — modo offline com SQLite** — apps/mobile-checkin/src/db/database.ts:1-4 (expo-sqlite); manifesto local (sync/manifestSync.ts) + verificação Ed25519 offline (qr/verifyTicketToken.ts); GET manifest/delta na API (validator.controller.ts:93-99)
- ✅ **§17 Validação — fila persistente de sincronização** — apps/mobile-checkin/src/sync/syncQueue.ts:24-66 (flushPendingCheckins lê pendências do SQLite e envia a POST /v1/checkins/sync, checkins.controller.ts:19)
- ✅ **§17 Validação — autorização e bloqueio de dispositivo** — registro do device na sessão (validator.service.ts:131-137, token opaco hasheado); bloqueio (validator.controller.ts:64) e guard cortando status != ACTIVE (validator-device.guard.ts:33)
- ✅ **§17 Validação — resumo básico** — HomeScreen.tsx:21-86 (contadores confirmados / na fila offline); backend ainda tem GET /v1/events/:eventId/checkin-live (checkins.controller.ts:31, checkins.service.ts:216)
- ✅ **§17 Backoffice — visualizar organizadores e eventos** — GET /v1/admin/organizations e /v1/admin/events (admin.controller.ts:20,53) + páginas apps/admin/app/organizacoes e eventos
- ✅ **§17 Backoffice — configurar taxa** — POST /v1/admin/organizations/:id/fee (admin.controller.ts:30) com schema setOrganizationFeeSchema
- ✅ **§17 Backoffice — consultar pedidos e pagamentos** — GET /v1/admin/orders (admin.controller.ts:71) incluindo payments (admin.service.ts:208) + página apps/admin/app/pedidos
- ✅ **§17 Backoffice — reenviar ingresso** — POST /v1/admin/orders/:publicToken/resend (admin.controller.ts:81-85)
- ✅ **§17 Backoffice — executar estorno controlado** — POST /v1/admin/orders/:publicToken/refund chamando gateway.refund com guarda de status (admin.service.ts:237-258) + approve/reject de refund-requests (admin.controller.ts:101-117)
- ✅ **§17 Backoffice — acompanhar webhooks e filas** — GET /v1/admin/webhooks e /v1/admin/queues com getJobCounts reais do BullMQ + outbox por status (admin.controller.ts:119,128; admin.service.ts:386-398) + páginas admin/app/webhooks e filas
- ✅ **§17 Backoffice — bloquear evento, organização ou ingresso** — POST /v1/admin/organizations/:id/block e unblock, /admin/events/:id/block, /admin/tickets/:id/block (admin.controller.ts:39,48,62,133; blockTicket cancela em admin.service.ts:401-413)
- ✅ **§17 Backoffice — visualizar auditoria** — GET /v1/admin/audit-logs com filtros (admin.controller.ts:142-150) + página apps/admin/app/auditoria
- ❌ **§16 — OpenTelemetry** — não encontrado
  - falta: Zero referências a opentelemetry/otel em código e package.json de todos os apps/packages. Sem tracing, sem instrumentação.
- 🟡 **§16 — logs JSON estruturados** — pino em packages/observability/src/index.ts:3-15 (withContext), usado em todos os jobs do worker e em identity/webhooks/checkins da API
  - falta: Logging HTTP desligado (FastifyAdapter({logger:false}) em apps/api/src/main.ts:9); maioria dos serviços da API (orders, payments, reservations, admin, catalog...) não loga nada.
- ❌ **§16 — Sentry (frontend e backend)** — não encontrado
  - falta: Zero referências a Sentry em apps (web, api, worker e mobile-checkin — §5 mobile também pede Sentry) e nos package.json.
- ❌ **§16 — Prometheus/Grafana (ou equivalente)** — não encontrado
  - falta: Sem endpoint /metrics, sem prom-client, nada de Prometheus/Grafana em infra/docker/docker-compose*.yml.
- 🟡 **§16 — alertas (pagamento, emissão, estoque, sincronização)** — infra/scripts/healthcheck-alert.sh (alerta up/down da API+DB via webhook Slack/Discord, com edge-trigger para não spammar; usa GET /health que checa o banco — health.controller.ts:8)
  - falta: Só cobre 'API caiu'. Nenhum alerta de erro de pagamento, falha de emissão, estoque ou sincronização como o §16 lista.
- 🟡 **§16 — métricas essenciais (conversão, reservas, estoque, latência gateway, webhook→emissão, duplicidade=0, scans/min p95, conflitos offline, idade do manifesto, financeiro, filas/DLQ)** — apenas consultas ad-hoc: estoque/vendas no dashboard (dashboard.controller.ts:11), filas+outbox em /admin/queues (admin.service.ts:386-398), check-in ao vivo (checkins.service.ts:216), financeiro (finance.controller.ts:11-16)
  - falta: Não existe sistema de métricas: sem conversão por etapa, sem latência/erro do gateway, sem tempo webhook→emissão, sem métrica de duplicidade, sem scans/min ou p95, sem conflitos de check-in offline, sem idade do manifesto, sem séries temporais nem dashboards.
- 🟡 **§5 backend — access token curto + refresh token rotativo nos apps** — sessão de usuário é um único JWT HS256 de 7 dias sem refresh (packages/auth/src/session.ts:16-25); device de validador tem rotação de token opaco (POST /v1/validator/devices/:deviceId/refresh, validator.service.ts:161-172)
  - falta: Não há par access curto + refresh rotativo para usuários (comprador/produtor/admin): token de 7d, sem rotação, sem revogação server-side. A rotação do validador é de token único de device, não o esquema do §5.
- ❌ **§5 backend — OpenAPI/Swagger** — não encontrado
  - falta: Nenhuma referência a @nestjs/swagger ou OpenAPI no repo; main.ts não monta docs. Contratos existem só como schemas Zod em packages/contracts (bom, mas não é OpenAPI).

### pagamentos-financeiro

O núcleo do §11 é sólido e verificado no código: idempotência em criação/webhook/estorno/emissão, payload bruto sempre armazenado, verificação fail-closed do webhook (Basic/HMAC com timingSafeEqual), caminho único applyGatewayStatus com guardas de status para eventos fora de ordem, reconciliação periódica e emissão exatamente-uma-vez com constraint no banco — com testes nos caminhos principais (duplicado, ledger, refund-request, Pagar.me unitário). Os buracos reais: (1) split/recebedores Pagar.me e antecipação NÃO existem — tudo liquida na conta da plataforma e o repasse é manual (Payout é só controle contábil, sem transferência bancária); (2) estorno parcial é bug funcional: admin aceita amountCents mas applyReversal trata como total (pedido REFUNDED, ledger e estoque revertidos integralmente, todos os ingressos revogados) — PARTIALLY_REFUNDED nunca é usado; (3) chargeback só tem o caminho de derrota (sem disputa/reversão/taxa, sem teste); (4) máquinas de estado do §9 estão pela metade: SALES_PAUSED/SALES_CLOSED/COMPLETED (evento), SOLD_OUT/CLOSED (lote), CANCELED (reserva/pedido), TRANSFERRED/REFUNDED (ingresso) existem só nos enums, sem transição em código; (5) do modelo §8 faltam payment_attempts, refunds, payout_items e a tabela platform_fees (comissão vive só como lançamento no ledger); (6) reconciliação cobre apenas pagamentos abertos — webhook perdido de refund/chargeback sobre pagamento PAID passa despercebido; (7) o caminho de cartão não tem uso real: nenhum frontend tokeniza (checkout web é só Pix).

- ✅ **§11 Interface PaymentGateway (createPix, createCardPayment, refund, getStatus, verifyWebhook)** — packages/payments/src/types.ts (importado em pagarme.ts:2-14); PagarmeGateway implementa em packages/payments/src/pagarme.ts:58 (createPixCharge:61, createCardPayment:97, refund:141, getStatus:157, verifyWebhook:162); registry com mock+pagarme e troca por env PAYMENTS_PROVIDER em packages/payments/src/registry.ts:28-38
- ✅ **§11 Idempotency key na criação de pagamento** — apps/api/src/common/idempotency.service.ts:16-63 (unique key + hash do payload + resposta gravada); usado em apps/api/src/payments/payments.service.ts:12 e :80 (rotas POST v1/orders/:orderId/payments/pix|card em payments.controller.ts:10-26); idempotencyKey = payment.id repassado ao gateway e enviado no header 'Idempotency-key' (pagarme.ts:295); reuso de Pix pendente evita QR duplicado (payments.service.ts:20-31)
- ✅ **§11 Idempotência no processamento de webhook** — unique(provider, external_event_id) em packages/database/prisma/schema.prisma:533; apps/api/src/webhooks/webhooks.service.ts:86-104 captura P2002 e responde 200 como duplicado sem efeito; teste em apps/api/src/__tests__/order-payment-flow.test.ts:20 (webhook duplicado é no-op)
- ✅ **§11 Idempotência no estorno** — admin refund com idempotencyKey 'admin-refund:{paymentId}:{amount}' + guarda PAID→REFUND_PENDING via updateMany (apps/api/src/admin/admin.service.ts:246-268); estorno de órfão com key 'refund_orphan_{paymentId}' e guarda de status (apps/worker/src/process-outbox.ts:84-98); refund via DELETE /charges com Idempotency-key (pagarme.ts:141-155)
- ✅ **§11 Idempotência na emissão / pagamento aprovado nunca emite duas vezes** — apps/worker/src/issue-tickets.ts:24-28 (guarda PAID/FULFILLED), :47-69 (P2002 em unique(order_item_id, seq) — schema.prisma:600 — é no-op), FULFILLED em :84; transição PAID única em apply-status.ts:92-103 gera outbox order.paid uma vez; teste order-payment-flow.test.ts:20
- ✅ **§11 Payload bruto do webhook armazenado** — apps/api/src/webhooks/webhooks.service.ts:35-42 cria WebhookDelivery com rawBody+headers ANTES de verificar assinatura (armazenado mesmo rejeitado, status IGNORED em :49-53); modelo em schema.prisma:547-561; rawBody habilitado no Fastify em apps/api/src/main.ts:11
- ✅ **§11 Assinatura do webhook verificada** — verifyWebhook antes de qualquer efeito (webhooks.service.ts:46-56); pagarme.ts:208-246: Basic auth com timingSafeEqual OU HMAC X-Hub-Signature, e fail-closed (sem config → rejeita tudo, :242-245); testes pagarme.test.ts:139-183. Nota honesta do código: Pagar.me v5 não assina HMAC — o mecanismo real é Basic auth do endpoint, com reconciliação como defesa extra
- 🟡 **§11 Eventos fora de ordem tratados** — packages/payments/src/apply-status.ts:34-35, 44-77, 92-103, 240-250 — todas as transições via updateMany com guarda de status: regressão/repetição vira no-op, PAID vence EXPIRED/FAILED/CANCELED mas nunca regride estado monetário
  - falta: o mecanismo é real e usado em todos os caminhos, mas só o cenário 'PAID duplicado' tem teste (order-payment-flow.test.ts:71); faltam testes dos caminhos fora de ordem de verdade (AUTHORIZED chegando depois de PAID, REFUNDED antes de PAID, PAID depois de EXPIRED)
- 🟡 **§11 Reconciliação periódica com o gateway** — apps/worker/src/reconcile-payments.ts:12-40 (GET /charges/{id} p/ pagamentos PENDING/AUTHORIZED >2min, aplica via applyGatewayStatus); agendado a cada 60s em apps/worker/src/main.ts:53-60
  - falta: só reconcilia pagamentos abertos (PENDING/AUTHORIZED) — um webhook perdido de refund/chargeback sobre pagamento já PAID nunca é detectado; sem teste do job
- 🟡 **§11 Cartão tokenizado pelo provedor (escopo PCI)** — contrato exige cardToken (packages/contracts/src/payments.ts:13); backend só repassa card_token ao Pagar.me (pagarme.ts:112-116) — PAN nunca toca a API
  - falta: nenhum frontend tokeniza/coleta cartão: o checkout web só implementa Pix (apps/checkout/app/checkout/[reservationId]/page.tsx:64 chama apenas createPixPayment); o caminho de cartão não tem uso real de ponta a ponta (sem UI, sem chamada ao endpoint de tokenização do Pagar.me)
- 🟡 **§9 Máquina de estados do Evento** — enum completo em schema.prisma:246-253; DRAFT→PUBLISHED em apps/api/src/events/events.service.ts:80; →CANCELED (blockEvent admin) em apps/api/src/admin/admin.service.ts:164
  - falta: SALES_PAUSED, SALES_CLOSED e COMPLETED existem só no enum — nenhuma rota/worker faz essas transições
- 🟡 **§9 Máquina de estados do Lote** — enum em schema.prisma:304-310; DRAFT/SCHEDULED→ACTIVE em apps/api/src/catalog/catalog.service.ts:69-73
  - falta: SOLD_OUT e CLOSED nunca são setados em lugar nenhum (inventory-ops.ts não muda status ao esgotar; grep no repo não acha escrita); lote esgotado continua ACTIVE e é 'protegido' só pela conta de capacidade no SQL
- 🟡 **§9 Máquina de estados da Reserva** — ACTIVE→CONVERTED em apps/api/src/orders/orders.service.ts:42; →EXPIRED em apps/worker/src/expire-reservation.ts:29 (+ reconciliação por varredura)
  - falta: CANCELED nunca é setado — não existe rota/fluxo de cancelamento de reserva
- 🟡 **§9 Máquina de estados do Pedido** — CREATED→PAYMENT_PENDING (payments.service.ts:146-151), →PAID (apply-status.ts:105-108), →FULFILLED (issue-tickets.ts:84), →EXPIRED (expire-orders.ts:35,47), →REFUNDED/CHARGEBACK (apply-status.ts:247-250)
  - falta: CANCELED nunca setado; REFUND_PENDING existe só no Payment, nunca no Order (o where de apply-status.ts:248 até prevê, mas ninguém grava); PARTIALLY_REFUNDED nunca usado — estorno parcial (admin.service.ts:257-261 aceita amountCents) volta do gateway como REFUNDED e applyReversal trata como total: marca pedido REFUNDED, reverte TODO o ledger e devolve TODO o estoque (apply-status.ts:230-267) — bug funcional real
- 🟡 **§9 Máquina de estados do Ingresso** — →CHECKED_IN (apps/api/src/checkins/checkins.service.ts:281), →CANCELED (admin.service.ts:412 e process-outbox.ts:104-112)
  - falta: ingresso nasce direto ACTIVE (issue-tickets.ts:58) — ISSUED nunca é um estado real; TRANSFERRED nunca setado (transferTicket troca titular e reassina QR in-place, tickets.service.ts:92-96, sem tabela ticket_transfers/ticket_versions do §8); REFUNDED nunca setado (estorno marca CANCELED)
- ✅ **§8 ledger_accounts + ledger_entries (append-only)** — schema.prisma:799-836 (conta 1:1 org, lançamentos assinados, sem update em lugar nenhum); crédito SALE_CREDIT + débito PLATFORM_FEE na aprovação (apply-status.ts:147-186); reversão REFUND_DEBIT (apply-status.ts:189-228); saldo sempre recalculado por soma (apps/api/src/common/ledger.ts:4-13); rotas do produtor GET v1/organizations/:id/balance|ledger (finance.controller.ts:11-23) com permissão FINANCE_VIEW; teste order-payment-flow.test.ts:20
- 🟡 **§8 platform_fees (comissão da plataforma)** — cálculo em packages/payments/src/fees.ts:20-33 (Pix 4,99% piso R$2,49, cartão 6,99%, overrides por organização) e registro como LedgerEntry PLATFORM_FEE (apply-status.ts:177-183)
  - falta: a tabela platform_fees do doc não existe — a comissão vive só como lançamento no ledger (funcional, mas sem registro configurável/histórico próprio)
- 🟡 **§8 payouts (repasses)** — modelo Payout em schema.prisma:845-858; rotas admin POST v1/admin/organizations/:id/payouts e payouts/:id/mark-paid (admin.controller.ts:161-181); createPayout bloqueia sem KYC (org != ACTIVE) e usa saldo disponível menos repasses pendentes (admin.service.ts:481-513, common/ledger.ts:16-30); mark-paid lança PAYOUT_DEBIT (admin.service.ts:515-541)
  - falta: execução bancária real é manual — o próprio schema admite (schema.prisma:844 'aguarda integração de recebedores/KYC do gateway — aqui só o controle'); sem transferência automática, sem teste do fluxo de payout
- ❌ **§8 payout_items** — não encontrado — schema.prisma não tem o modelo; payout é um valor agregado único sem itens
- ❌ **§8 payment_attempts** — não encontrado no schema — existem payments (schema.prisma:492) e payment_events (:521), mas não a tabela de tentativas do doc; cada retry de cartão vira um novo Payment
- ❌ **§8 refunds (registro do estorno executado)** — não encontrado — não existe tabela refunds; RefundRequest (schema.prisma:473-490) é a solicitação do comprador (fluxo completo: criação em refund-requests.service.ts:12-29, aprovação/rejeição admin em admin.controller.ts:101-115), mas o estorno executado em si só muda payment.status — valor parcial estornado não fica persistido em lugar nenhum
- ✅ **§8 webhook_deliveries / outbox_events / idempotency_keys** — schema.prisma:547-561, 872-885, 888-899; outbox com claim atômico, retry com backoff e dead-letter após 10 tentativas (apps/worker/src/process-outbox.ts:16-56), agendado a cada 3s (worker/main.ts:46-50)
- ✅ **applyGatewayStatus como caminho único de status** — packages/payments/src/apply-status.ts:37-78; usado por webhook (webhooks.service.ts:107), cartão síncrono (payments.service.ts:124), reconciliação (reconcile-payments.ts:28) e estorno admin (admin.service.ts:278) — sem caminho paralelo; PAID órfão (pedido expirado) gera outbox payment.orphaned e estorno automático (apply-status.ts:110-123 + process-outbox.ts:84-101)
- ❌ **Split/recebedores Pagar.me** — não encontrado — zero ocorrências de split/recipient no código de pagamentos; o payload de /orders não envia split (pagarme.ts:62-120); comentário explícito em pagarme.ts:51-53: 'O split para produtores (recebedores) entra na Fase 9 — por ora as cobranças liquidam 100% na conta da plataforma'; não há cadastro de recipients nem KYC via gateway
- ❌ **Antecipação de recebíveis** — não encontrado — grep por 'antecip' no repo não retorna nada em código; nenhum modelo, rota ou integração
- 🟡 **Chargeback flow completo** — recepção: mapWebhookType trata charge.chargedback e chargeback.received (pagarme.ts:350-352) e extrai charge de dentro do objeto de chargeback (pagarme.ts:181-183); efeito: applyReversal → payment/pedido CHARGEBACK + reversão de ledger + devolução de estoque (apply-status.ts:230-267) + revogação de ingressos via outbox order.payment_reversed (process-outbox.ts:104-112)
  - falta: só a metade 'perder o chargeback' existe: sem tratamento de disputa/representação nem de chargeback revertido (vitória) — CHARGEBACK é terminal; sem lançamento de taxa de chargeback (usa REFUND_DEBIT genérico, sem tipo próprio no ledger); reconciliação não detecta chargeback perdido em pagamento PAID; nenhum teste cobre o caminho de chargeback

### identidade-contas

Identidade tem apenas o núcleo do OTP funcionando de verdade (desafio hasheado, tentativas, TTL, rate limit e sessão JWT). Todo o resto de §5/§8 é lacuna: o OTP nunca é enviado (TODO em identity.service.ts:32 e sender de e-mail é stub devlog — login quebrado em produção), não há refresh token rotativo (JWT único de 7 dias, sem revogação), user_identities/login social, perfil (nome/CPF), exclusão de conta e bank_accounts existem só como tabelas no schema sem uma linha de código usando-as, e o "KYC" real é um unblock manual de admin sobre o status da organização, sem tocar organizer_verifications.

- ✅ **OTP — desafio de código (request/verify)** — apps/api/src/identity/identity.controller.ts:11-21 (POST v1/identity/otp/request e otp/verify); apps/api/src/identity/identity.service.ts:18-79; packages/auth/src/otp.ts (hash sha256 com escopo por destination, comparação timingSafeEqual, TTL 10min, máx 5 tentativas)
  - falta: Nada no núcleo do desafio: código hasheado, expiração, contador de tentativas, consumo único e rate limit (5/15min por destination no request, 10/15min no verify via @RateLimit) estão implementados e há testes de rate limit citados nos commits.
- ❌ **Envio real do código OTP por e-mail/SMS/WhatsApp** — apps/api/src/identity/identity.service.ts:32 — TODO explícito: "enfileirar envio real via notification-delivery worker (e-mail/SMS/WhatsApp)"
  - falta: O código nunca é enviado: só é logado, e apenas quando NODE_ENV !== production (linhas 34-36). Em produção o usuário não recebe nada e o login fica impossível. Agravante: mesmo a infra de e-mail é stub — packages/notifications/src/registry.ts:37-40 usa DevLogEmailSender por padrão e nenhum provedor real (SES/Resend/Postmark) está implementado no repo. Falta enfileirar o OTP no worker de notificações e plugar um sender real.
- ❌ **Refresh token rotativo (access token curto + refresh, §5 Backend)** — packages/auth/src/session.ts — createSessionToken emite um único JWT HS256 com expiresIn="7d"; apps/api/src/common/session.guard.ts:20 só verifica esse JWT; nenhuma rota de refresh/logout em nenhum controller
  - falta: Não existe refresh token para usuários: é um access token único de 7 dias, sem rotação, sem armazenamento server-side, sem revogação e sem logout. O único "refresh" do repo é de token de dispositivo validador (apps/api/src/validator/validator.controller.ts:87, POST devices/:deviceId/refresh), subsistema de check-in, não autenticação de usuário. Falta: endpoint de refresh, rotação com invalidação do token anterior, e access token de vida curta.
- ❌ **Login social (user_identities / Google / Apple)** — packages/database/prisma/schema.prisma:47 (model UserIdentity) e :14-19 (enum IdentityProvider EMAIL/GOOGLE/APPLE/PHONE) — nenhuma outra referência no código
  - falta: A tabela existe só no schema. Grep por userIdentity/IdentityProvider/google/apple/oauth em apps/api, apps/worker e packages retorna zero uso: nenhuma rota OAuth, nenhum insert em user_identities, nem o fluxo de OTP registra a identidade EMAIL. Login social é 100% não implementado.
- ❌ **Perfil de usuário (editar nome/CPF/telefone)** — schema.prisma:28-36 (users tem name/phone/cpf nullable), mas nenhuma rota de perfil — listagem completa de rotas dos controllers não tem GET/PATCH /me de perfil (só GET me/tickets em tickets.controller.ts:17)
  - falta: Usuário é criado apenas com e-mail (upsert em identity.service.ts:65-69 e no convite em organizations.service.ts:67-71); name/cpf/phone nunca são preenchidos ou editáveis por nenhum endpoint. Falta rota GET/PATCH de perfil e validação de CPF.
- ❌ **Exclusão de conta (LGPD, §15)** — não encontrado — nenhum @Delete de usuário em nenhum controller; grep por delete/anonymize sobre users não retorna nada
  - falta: Não há endpoint de exclusão/anonimização de conta nem job de apagamento de dados pessoais. Nada implementado.
- 🟡 **KYC do organizador (organizer_verifications com fluxo real)** — schema.prisma:190-205 (model OrganizerVerification com PENDING/APPROVED/REJECTED, provider, reviewedBy) — zero uso no código; o que existe é proxy via status da organização: admin.service.ts:102-103 (unblock seta ACTIVE, "desbloqueio manual") e admin.service.ts:486-489 (createPayout bloqueia repasse se org não estiver ACTIVE, com mensagem "KYC aprovado")
  - falta: A tabela organizer_verifications nunca é lida nem escrita. Não há upload de documentos, não há submissão pelo produtor, não há endpoint de aprovação/rejeição que crie registro de verificação, não há integração com provider de KYC. O que existe é só o gate indireto: org nasce PENDING_VERIFICATION (default do schema) e um admin dá unblock manual para ACTIVE, o que libera payout. É um interruptor manual, não um fluxo de KYC.
- ❌ **bank_accounts (CRUD de conta bancária da organização)** — schema.prisma:207-226 (model BankAccount completo: banco, agência, conta, pixKey, isDefault) — nenhuma referência em apps/api, apps/worker ou packages
  - falta: Só a tabela. Nenhuma rota de criar/listar/editar/remover conta bancária, e o fluxo de payout (admin.service.ts createPayout) nem consulta BankAccount — o repasse é criado sem saber para onde pagar. Falta CRUD no producer-web/API e vínculo do payout à conta default.
