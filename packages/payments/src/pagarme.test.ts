import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createHmac } from "node:crypto";
import { PagarmeGateway, mapChargeStatus, mapWebhookType } from "./pagarme";
import { WebhookVerificationError } from "./types";

const gateway = new PagarmeGateway();
const originalFetch = globalThis.fetch;
let lastRequest: { url: string; init: RequestInit } | undefined;

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = (async (url: any, init: any) => {
    lastRequest = { url: String(url), init };
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.PAGARME_SECRET_KEY = "sk_test_123";
  process.env.PAGARME_API_URL = "https://api.test.local/core/v5";
  delete process.env.PAGARME_WEBHOOK_SECRET;
  delete process.env.PAGARME_WEBHOOK_BASIC_USER;
  delete process.env.PAGARME_WEBHOOK_BASIC_PASSWORD;
  lastRequest = undefined;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("createPixCharge monta o pedido e extrai o QR", async () => {
  stubFetch(200, {
    id: "or_1",
    status: "pending",
    charges: [
      {
        id: "ch_abc",
        status: "pending",
        last_transaction: { qr_code: "000201PIXCOPIAECOLA", expires_at: "2026-07-23T12:00:00Z" },
      },
    ],
  });

  const charge = await gateway.createPixCharge({
    paymentId: "pay_1",
    orderId: "ord_1",
    amountCents: 17600,
    customer: {
      email: "c@test.dev",
      name: "Cliente",
      document: "123.456.789-09",
      phone: "+55 (11) 99999-8888",
    },
    expiresInSeconds: 900,
    idempotencyKey: "pay_1",
  });

  assert.equal(charge.externalId, "ch_abc");
  assert.equal(charge.qrCodeText, "000201PIXCOPIAECOLA");
  assert.equal(charge.expiresAt.toISOString(), "2026-07-23T12:00:00.000Z");

  assert.ok(lastRequest);
  assert.equal(lastRequest!.url, "https://api.test.local/core/v5/orders");
  const sent = JSON.parse(String(lastRequest!.init.body));
  assert.equal(sent.items[0].amount, 17600);
  assert.equal(sent.payments[0].payment_method, "pix");
  assert.equal(sent.payments[0].pix.expires_in, 900);
  assert.equal(sent.customer.document, "12345678909");
  assert.equal(sent.customer.type, "individual");
  assert.deepEqual(sent.customer.phones, {
    mobile_phone: { country_code: "55", area_code: "11", number: "999998888" },
  });
  const headers = lastRequest!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Basic ${Buffer.from("sk_test_123:").toString("base64")}`);
  // grafia literal da doc oficial (case-sensitive)
  assert.equal(headers["Idempotency-key"], "pay_1");
});

test("createCardPayment mapeia aprovado, autorizado e recusado", async () => {
  stubFetch(200, { id: "or_2", charges: [{ id: "ch_ok", status: "paid" }] });
  const paid = await gateway.createCardPayment({
    paymentId: "p1",
    orderId: "o1",
    amountCents: 8800,
    cardToken: "tok_1",
    installments: 3,
    customer: { email: "c@test.dev" },
    idempotencyKey: "p1",
  });
  assert.deepEqual(paid, { externalId: "ch_ok", status: "PAID" });

  stubFetch(200, {
    id: "or_3",
    charges: [
      {
        id: "ch_fail",
        status: "failed",
        last_transaction: { acquirer_message: "Cartão recusado" },
      },
    ],
  });
  const failed = await gateway.createCardPayment({
    paymentId: "p2",
    orderId: "o2",
    amountCents: 8800,
    cardToken: "tok_2",
    installments: 1,
    customer: { email: "c@test.dev" },
    idempotencyKey: "p2",
  });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.failReason, "Cartão recusado");
});

test("refund via DELETE /charges e mapeamento de status", async () => {
  stubFetch(200, { id: "ch_1", status: "canceled" });
  const result = await gateway.refund({ externalId: "ch_1", idempotencyKey: "r1" });
  assert.equal(result.status, "REFUNDED");
  assert.equal(lastRequest!.url, "https://api.test.local/core/v5/charges/ch_1");
  assert.equal(lastRequest!.init.method, "DELETE");
});

test("getStatus mapeia estados da charge", async () => {
  stubFetch(200, { id: "ch_1", status: "chargedback" });
  assert.equal(await gateway.getStatus("ch_1"), "CHARGEBACK");
});

test("mapeamentos puros de status", () => {
  assert.equal(mapChargeStatus("paid"), "PAID");
  assert.equal(mapChargeStatus("underpaid"), "PAID");
  assert.equal(mapChargeStatus("processing"), "PENDING");
  assert.equal(mapChargeStatus("desconhecido"), "PENDING");
  assert.equal(mapWebhookType("charge.paid"), "PAID");
  assert.equal(mapWebhookType("charge.refunded"), "REFUNDED");
  assert.equal(mapWebhookType("chargeback.received"), "CHARGEBACK");
  assert.equal(mapWebhookType("charge.antifraud_approved", "pending"), "PENDING");
});

test("verifyWebhook exige verificação configurada (fail closed)", () => {
  assert.throws(
    () => gateway.verifyWebhook({}, JSON.stringify({ id: "e1", type: "charge.paid", data: { id: "ch_1" } })),
    WebhookVerificationError,
  );
});

test("verifyWebhook com HMAC X-Hub-Signature", () => {
  process.env.PAGARME_WEBHOOK_SECRET = "whsec";
  const body = JSON.stringify({
    id: "hook_1",
    type: "charge.paid",
    data: { id: "ch_9", status: "paid" },
  });
  const signature = `sha256=${createHmac("sha256", "whsec").update(body).digest("hex")}`;

  const event = gateway.verifyWebhook({ "x-hub-signature": signature }, body);
  assert.equal(event.externalEventId, "hook_1");
  assert.equal(event.externalPaymentId, "ch_9");
  assert.equal(event.status, "PAID");

  assert.throws(
    () => gateway.verifyWebhook({ "x-hub-signature": "sha256=deadbeef" }, body),
    WebhookVerificationError,
  );
});

test("verifyWebhook com Basic auth", () => {
  process.env.PAGARME_WEBHOOK_BASIC_USER = "hook";
  process.env.PAGARME_WEBHOOK_BASIC_PASSWORD = "s3cret";
  const body = JSON.stringify({
    id: "hook_2",
    type: "order.paid",
    data: { id: "or_1", charges: [{ id: "ch_77", status: "paid" }] },
  });
  const auth = `Basic ${Buffer.from("hook:s3cret").toString("base64")}`;

  const event = gateway.verifyWebhook({ authorization: auth }, body);
  assert.equal(event.externalPaymentId, "ch_77");
  assert.equal(event.status, "PAID");

  assert.throws(
    () => gateway.verifyWebhook({ authorization: "Basic errado" }, body),
    WebhookVerificationError,
  );
});
