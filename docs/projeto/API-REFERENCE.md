# Referência da API — BoraFest

> Gerado a partir do código em `apps/api/src` (2026-07-23). Sempre que adicionar
> ou mudar uma rota, atualize esta tabela na mesma sessão — ela existia como
> lacuna (só dava pra achar rota lendo controller por controller) e é aqui
> que Amanda e Arthur (e qualquer Claude novo no projeto) olham primeiro para
> saber "isso já existe? em que módulo?".

Convenções gerais (ver `docs/projeto/MEMORIA.md` para detalhes):

- Todas as rotas usam prefixo `v1/`.
- **Guard = SessionGuard**: exige `Authorization: Bearer <token>` de sessão de
  usuário (login por OTP). Autorização fina por organização é feita dentro do
  service via `OrgAccessService.assertPermission`, ou por
  `PlatformAccessService.assertStaff/assertAdmin` nas rotas de backoffice.
- **Guard = ValidatorDeviceGuard**: exige os headers `x-device-id` +
  `x-device-token` (aparelho de check-in registrado via
  `POST /v1/validator/sessions`), não usa Bearer/sessão de usuário.
- **Guard = nenhum**: rota pública (pode ter `@OptionalUserId()`, que anexa o
  usuário só se um Bearer válido vier junto, sem exigir).
- Corpo/query validados com Zod (`packages/contracts`) via `ZodBody(schema)`.

---

## Identity (`apps/api/src/identity`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| POST | `/v1/identity/otp/request` | nenhum | `requestOtpSchema` |
| POST | `/v1/identity/otp/verify` | nenhum | `verifyOtpSchema` |

## Organizations (`apps/api/src/organizations`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| POST | `/v1/organizations` | SessionGuard | `createOrganizationSchema` |
| POST | `/v1/organizations/:id/members` | SessionGuard | `inviteMemberSchema` |

## Events (`apps/api/src/events`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| POST | `/v1/organizations/:organizationId/events` | SessionGuard | `createEventSchema` |
| GET | `/v1/organizations/:organizationId/events` | SessionGuard | — |
| PATCH | `/v1/events/:id` | SessionGuard | `updateEventSchema` |
| POST | `/v1/events/:id/publish` | SessionGuard | — |

## Catalog (`apps/api/src/catalog`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| POST | `/v1/events/:eventId/ticket-types` | SessionGuard | `createTicketTypeSchema` |
| POST | `/v1/ticket-types/:ticketTypeId/lots` | SessionGuard | `createTicketLotSchema` |
| POST | `/v1/ticket-lots/:lotId/activate` | SessionGuard | — |
| GET | `/v1/public/events/:slug` | nenhum | — |
| GET | `/v1/public/events/:slug/availability` | nenhum | — |

## Inventory (`apps/api/src/inventory`)

Sem rota HTTP — módulo só de serviço (`InventoryService`), consumido
internamente por Reservations/Catalog. Não expõe controller.

## Reservations (`apps/api/src/reservations`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| POST | `/v1/reservations` | `@OptionalUserId()` (convidado ou logado) | `createReservationSchema` |
| GET | `/v1/reservations/:id` | nenhum | — |

## Orders (`apps/api/src/orders`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| POST | `/v1/orders` | `@OptionalUserId()` | `createOrderSchema` |
| GET | `/v1/orders/:publicToken/status` | nenhum | — |

## Payments (`apps/api/src/payments`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| POST | `/v1/orders/:orderId/payments/pix` | nenhum (lê header `Idempotency-Key`) | `createPixPaymentSchema` |
| POST | `/v1/orders/:orderId/payments/card` | nenhum (lê header `Idempotency-Key`) | `createCardPaymentSchema` |

## Webhooks (`apps/api/src/webhooks`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| POST | `/v1/webhooks/payments/:provider` | nenhum (assinatura verificada dentro do service; raw body sempre salvo) | raw body, sem schema Zod |

## Tickets (`apps/api/src/tickets`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| GET | `/v1/orders/:publicToken/tickets` | nenhum | — |
| GET | `/v1/me/tickets` | SessionGuard | — |

## Notifications (`apps/api/src/notifications`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| POST | `/v1/orders/:publicToken/resend` | nenhum (limite de 3/hora por pedido) | — (`HttpCode 202`) |

## Dashboard do produtor (`apps/api/src/dashboard`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| GET | `/v1/events/:eventId/dashboard` | SessionGuard (`FINANCE_VIEW`) | — |
| GET | `/v1/events/:eventId/orders` | SessionGuard (`FINANCE_VIEW`) | query: `status`, `page`, `pageSize` |
| GET | `/v1/events/:eventId/participants` | SessionGuard (`FINANCE_VIEW`) | — |
| GET | `/v1/events/:eventId/participants/export` | SessionGuard (`FINANCE_VIEW`) | — (CSV) |

## Financeiro do produtor (`apps/api/src/finance`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| GET | `/v1/organizations/:organizationId/balance` | SessionGuard (`FINANCE_VIEW`) | — |
| GET | `/v1/organizations/:organizationId/ledger` | SessionGuard (`FINANCE_VIEW`) | query: `limit` |

## Validador — configuração pelo produtor (`apps/api/src/validator`, `ValidatorConfigController`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| POST | `/v1/events/:eventId/checkin-points` | SessionGuard | `createCheckinPointSchema` |
| GET | `/v1/events/:eventId/checkin-points` | SessionGuard | — |
| POST | `/v1/events/:eventId/validator-credentials` | SessionGuard | `createValidatorCredentialSchema` |
| GET | `/v1/events/:eventId/validator-devices` | SessionGuard | — |
| POST | `/v1/events/:eventId/validator-devices/:deviceId/block` | SessionGuard | — |

## Validador — app de check-in (`apps/api/src/validator`, `ValidatorController`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| POST | `/v1/validator/sessions` | nenhum | `{ session: {eventId, pin}, device: {name} }` (composto inline, não está em `checkin.ts`) |
| POST | `/v1/validator/devices/:deviceId/refresh` | ValidatorDeviceGuard | — |
| GET | `/v1/validator/events/:eventId/manifest` | ValidatorDeviceGuard | — |
| GET | `/v1/validator/events/:eventId/manifest/delta` | ValidatorDeviceGuard | query: `since` (ISO date) |

`POST /v1/validator/sessions` responde:

```jsonc
{
  "deviceId": "...",
  "deviceToken": "...", // guardar em SecureStore; enviar em x-device-token
  "credentialLabel": "...",
  "event": { "id": "...", "title": "...", "slug": "...", "startsAt": "...", "endsAt": "..." },
  "checkinPoints": [{ "id": "...", "name": "..." }]
}
```

`GET /v1/validator/events/:eventId/manifest[/delta]` responde:

```jsonc
{
  "manifestVersion": "2026-07-23T12:00:00.000Z", // ISO timestamp, não é um inteiro
  "delta": false,
  "event": { "id": "...", "title": "...", "startsAt": "...", "endsAt": "...", "timezone": "..." },
  "signingKey": { "publicKeyPem": "...", "algorithm": "ed25519" },
  "ticketCount": 120,
  "tickets": [
    { "id": "...", "code": "BF-XXXX-XXXX", "status": "ACTIVE", "ticketLotId": "...", "checkedInAt": null, "updatedAt": "..." }
  ]
}
```

> **Nota**: o parâmetro `:eventId` na URL do manifesto não é usado pelo
> service — o evento é sempre o vinculado ao dispositivo autenticado
> (`req.validatorDevice.eventId`).

## Check-in (`apps/api/src/checkins`)

| Verbo | Rota | Guard | Corpo/Query |
|---|---|---|---|
| POST | `/v1/checkins` | ValidatorDeviceGuard | `createCheckinSchema` (`qrToken` OU `code`) |
| POST | `/v1/checkins/sync` | ValidatorDeviceGuard | `syncCheckinsSchema` |
| POST | `/v1/checkins/:id/reverse` | SessionGuard (`CHECKIN_PERFORM`) | — |
| GET | `/v1/events/:eventId/checkin-live` | SessionGuard (`CHECKIN_PERFORM`) | — |

> **Atenção ao construir o app de check-in**: `reverse` e `checkin-live` são
> **SessionGuard** (usuário logado do produtor/backoffice), não
> `ValidatorDeviceGuard`. O aparelho de check-in (autenticado só por device
> token) **não consegue chamar essas duas rotas** — reversão e o contador ao
> vivo "oficial" são operações do painel do produtor, não do app de portaria.
> O app de check-in deve manter seu próprio contador local a partir dos
> check-ins que ele mesmo confirmou/sincronizou.

`POST /v1/checkins` responde (união por `result`):

```jsonc
// VALID
{ "result": "VALID", "ticket": { "id": "...", "code": "...", "status": "CHECKED_IN", "attendeeName": "...", "lotName": "...", "typeName": "..." }, "checkinId": "..." }
// ALREADY_USED — inclui quem/quando validou antes
{ "result": "ALREADY_USED", "ticket": { "...": "..." }, "firstCheckin": { "at": "...", "deviceName": "..." } }
// CANCELED / INVALID — "ticket" pode nem vir (ex.: QR não resolvido)
{ "result": "INVALID" }
```

`POST /v1/checkins/sync` responde:

```jsonc
{
  "batchKey": "...",
  "received": 10, "confirmed": 8, "conflicts": 1, "invalid": 1,
  "items": [{ "localSeq": 1, "ticketId": "...", "status": "CONFIRMED", "checkinId": "..." }]
}
```

> **Mismatch a observar**: `syncCheckinsSchema` só aceita `ticketId` (uuid)
> por item — não aceita `qrToken`/`code`. Isso significa que, para o modo
> offline, o app precisa resolver `ticketId` localmente a partir do QR
> (decodificar o payload, campo `tid`) ANTES de enfileirar — não dá pra
> mandar o QR cru pro servidor verificar depois, como acontece no caminho
> online. Ver seção do QR abaixo.

## QR do ingresso (`packages/tickets/src/qr-token.ts`)

Formato: `BF1.<payload-base64url>.<assinatura-base64url>`. Payload:

```ts
interface TicketTokenPayload {
  v: 1;
  eid: string; // event id
  tid: string; // ticket id
  lid: string; // ticket lot id
  n: string;   // nonce aleatório
  iat: number; // epoch seconds
}
```

Assinatura Ed25519 via `node:crypto` (`generateEventKeyPair`, `signTicketToken`,
`verifyTicketToken`, `parseTicketToken`). **`parseTicketToken` decodifica e
valida o formato, mas NÃO verifica assinatura** — só `verifyTicketToken` faz
isso, e depende de `node:crypto`, que **não roda em React Native**. A
verificação de assinatura hoje só acontece no servidor
(`POST /v1/checkins` chama `verifyTicketToken` server-side). O app de
check-in usa `parseTicketToken` (reimplementado de forma portátil, sem
`node:crypto`) só para extrair `tid`/`eid` e fazer o pré-check local contra o
manifesto — a confirmação de verdade (e a detecção de adulteração) é sempre
do servidor, tanto no caminho online quanto na sincronização em lote.

## Backoffice (`apps/api/src/admin`)

Todas as rotas abaixo checam `PlatformAccessService.assertStaff/assertAdmin`
dentro do service (não há guard dedicado — só `SessionGuard` no controller).

| Verbo | Rota | Nível | Corpo/Query |
|---|---|---|---|
| GET | `/v1/admin/organizations` | staff | — |
| GET | `/v1/admin/organizations/:id` | staff | — |
| POST | `/v1/admin/organizations/:id/fee` | admin | `setOrganizationFeeSchema` |
| POST | `/v1/admin/organizations/:id/block` | admin | `blockReasonSchema` |
| POST | `/v1/admin/organizations/:id/unblock` | admin | — |
| GET | `/v1/admin/events` | staff | query: `organizationId`, `status` |
| POST | `/v1/admin/events/:id/block` | admin | `blockReasonSchema` |
| GET | `/v1/admin/orders` | staff | query: `publicToken`, `email`, `eventId` |
| POST | `/v1/admin/orders/:publicToken/resend` | staff | — |
| POST | `/v1/admin/orders/:publicToken/refund` | admin | `refundOrderSchema` |
| GET | `/v1/admin/webhooks` | staff | query: `provider`, `status` |
| GET | `/v1/admin/queues` | staff | — |
| POST | `/v1/admin/tickets/:id/block` | admin | `blockReasonSchema` |
| GET | `/v1/admin/audit-logs` | staff | query: `entityType`, `entityId`, `organizationId` |
| GET | `/v1/admin/organizations/:id/ledger` | staff | query: `limit` |
| GET | `/v1/admin/payouts` | staff | query: `organizationId`, `status` |
| POST | `/v1/admin/organizations/:id/payouts` | admin | — |
| POST | `/v1/admin/payouts/:id/mark-paid` | admin | `markPayoutPaidSchema` |

## Health

| Verbo | Rota | Guard |
|---|---|---|
| GET | `/health` | nenhum |
