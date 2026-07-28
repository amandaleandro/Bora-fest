import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { AsaasGateway, mapAsaasStatus, mapAsaasWebhookEvent } from "./asaas";
import { WebhookVerificationError } from "./types";

const gateway = new AsaasGateway();
const originalFetch = globalThis.fetch;
let requests: Array<{ url: string; init: RequestInit }> = [];

/** fila de respostas — cada chamada consome a próxima */
function stubFetchQueue(responses: Array<{ status: number; body: unknown }>) {
  const queue = [...responses];
  globalThis.fetch = (async (url: any, init: any) => {
    requests.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 500, body: { erro: "fila vazia" } };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.ASAAS_API_KEY = "asaas_test_key";
  process.env.ASAAS_API_URL = "https://api.test.local/v3";
  process.env.ASAAS_WEBHOOK_TOKEN = "tok_webhook_teste";
  requests = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("createPixCharge cria customer + payment e busca o QR", async () => {
  stubFetchQueue([
    { status: 200, body: { id: "cus_1" } },
    { status: 200, body: { id: "pay_1", status: "PENDING" } },
    { status: 200, body: { payload: "000201PIXASAAS", expirationDate: "2099-01-01 23:59:59" } },
  ]);

  const charge = await gateway.createPixCharge({
    paymentId: "pmt-interno-1",
    orderId: "order-1",
    amountCents: 17600,
    customer: { email: "a@b.dev", name: "Arthur", document: "529.982.247-25" },
    expiresInSeconds: 1800,
    idempotencyKey: "idem-1",
  });

  assert.equal(charge.externalId, "pay_1");
  assert.equal(charge.qrCodeText, "000201PIXASAAS");
  // expiração local (30 min) vence a data longínqua do Asaas
  assert.ok(charge.expiresAt.getTime() <= Date.now() + 1800_000 + 1000);

  const paymentBody = JSON.parse(String(requests[1].init.body));
  assert.equal(paymentBody.value, 176); // centavos → reais
  assert.equal(paymentBody.billingType, "PIX");
  assert.equal(paymentBody.externalReference, "pmt-interno-1");
  const customerBody = JSON.parse(String(requests[0].init.body));
  assert.equal(customerBody.cpfCnpj, "52998224725");
  assert.equal(customerBody.notificationDisabled, true);
  // auth via header access_token
  assert.equal((requests[0].init.headers as any).access_token, "asaas_test_key");
});

test("createCardPayment CONFIRMED vira PAID; recusa 400 vira FAILED com motivo", async () => {
  stubFetchQueue([
    { status: 200, body: { id: "cus_2" } },
    { status: 200, body: { id: "pay_2", status: "CONFIRMED" } },
  ]);
  const ok = await gateway.createCardPayment({
    paymentId: "pmt-2",
    orderId: "order-2",
    amountCents: 10699,
    cardToken: "tok_123",
    installments: 1,
    customer: { email: "a@b.dev" },
    idempotencyKey: "idem-2",
  });
  assert.deepEqual(ok, { externalId: "pay_2", status: "PAID" });

  stubFetchQueue([
    { status: 200, body: { id: "cus_3" } },
    { status: 400, body: { errors: [{ code: "invalid_creditCard", description: "Cartão sem limite" }] } },
  ]);
  const recusado = await gateway.createCardPayment({
    paymentId: "pmt-3",
    orderId: "order-3",
    amountCents: 10699,
    cardToken: "tok_ruim",
    installments: 1,
    customer: { email: "a@b.dev" },
    idempotencyKey: "idem-3",
  });
  assert.equal(recusado.status, "FAILED");
  assert.equal(recusado.failReason, "Cartão sem limite");
});

test("refund parcial envia value em reais", async () => {
  stubFetchQueue([{ status: 200, body: { id: "pay_4", status: "REFUNDED" } }]);
  const result = await gateway.refund({
    externalId: "pay_4",
    amountCents: 5000,
    idempotencyKey: "idem-4",
  });
  assert.equal(result.status, "REFUNDED");
  const body = JSON.parse(String(requests[0].init.body));
  assert.equal(body.value, 50);
});

test("webhook: token errado ou ausente é rejeitado (fail closed)", () => {
  const body = JSON.stringify({ event: "PAYMENT_RECEIVED", payment: { id: "pay_5" } });
  assert.throws(
    () => gateway.verifyWebhook({ "asaas-access-token": "tok_errado_xx" }, body),
    WebhookVerificationError,
  );
  assert.throws(() => gateway.verifyWebhook({}, body), WebhookVerificationError);
  delete process.env.ASAAS_WEBHOOK_TOKEN;
  assert.throws(
    () => gateway.verifyWebhook({ "asaas-access-token": "qualquer" }, body),
    WebhookVerificationError,
  );
});

test("webhook válido normaliza evento e status", () => {
  const body = JSON.stringify({
    id: "evt_9",
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_9", status: "RECEIVED" },
  });
  const event = gateway.verifyWebhook({ "asaas-access-token": "tok_webhook_teste" }, body);
  assert.equal(event.externalEventId, "evt_9");
  assert.equal(event.externalPaymentId, "pay_9");
  assert.equal(event.status, "PAID");

  // sem id próprio: dedupe pelo par evento+cobrança
  const semId = gateway.verifyWebhook(
    { "asaas-access-token": "tok_webhook_teste" },
    JSON.stringify({ event: "PAYMENT_REFUNDED", payment: { id: "pay_10", status: "REFUNDED" } }),
  );
  assert.equal(semId.externalEventId, "PAYMENT_REFUNDED:pay_10");
  assert.equal(semId.status, "REFUNDED");
});

test("mapeamento de status cobre o ciclo completo", () => {
  assert.equal(mapAsaasStatus("RECEIVED"), "PAID");
  assert.equal(mapAsaasStatus("CONFIRMED"), "PAID");
  assert.equal(mapAsaasStatus("AWAITING_RISK_ANALYSIS"), "PENDING");
  assert.equal(mapAsaasStatus("OVERDUE"), "EXPIRED");
  assert.equal(mapAsaasStatus("REFUND_REQUESTED"), "PAID");
  assert.equal(mapAsaasStatus("REFUNDED"), "REFUNDED");
  assert.equal(mapAsaasStatus("CHARGEBACK_REQUESTED"), "CHARGEBACK");
  assert.equal(mapAsaasWebhookEvent("PAYMENT_CONFIRMED"), "PAID");
  assert.equal(mapAsaasWebhookEvent("PAYMENT_OVERDUE"), "EXPIRED");
  assert.equal(mapAsaasWebhookEvent("PAYMENT_UPDATED", "RECEIVED"), "PAID");
  assert.equal(mapAsaasWebhookEvent("PAYMENT_CREATED", undefined), "PENDING");
});
