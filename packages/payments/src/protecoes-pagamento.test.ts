import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "node:test";
import { AsaasGateway, mapAsaasStatus, mapAsaasWebhookEvent } from "./asaas";
import { MercadoPagoGateway } from "./mercadopago";
import { MockGateway, mockSignWebhookBody } from "./mock";
import { PagarmeGateway } from "./pagarme";
import { checkPaymentSecrets } from "./secrets";

/**
 * Proteções de pagamento (2026-10-12), parte pura: os adapters expõem o valor
 * REALMENTE pago (corpo do webhook, resposta do cartão, consulta), o Asaas
 * reconhece a disputa de chargeback ganha e a trava de boot confere as chaves
 * de TODO provedor em uso. Sem banco — o efeito no pedido/ledger está em
 * apps/worker/src/__tests__/protecoes-pagamento.test.ts.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** fila de respostas — cada chamada consome a próxima */
function stubFetchQueue(responses: Array<{ status: number; body: unknown }>) {
  const queue = [...responses];
  globalThis.fetch = (async () => {
    const next = queue.shift() ?? { status: 500, body: { erro: "fila vazia" } };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
}

// --- Asaas ------------------------------------------------------------------

function asaasEnv() {
  process.env.ASAAS_API_KEY = "asaas_test_key";
  process.env.ASAAS_API_URL = "https://api.test.local/v3";
  process.env.ASAAS_WEBHOOK_TOKEN = "tok_webhook_teste";
}

test("Asaas: webhook de pagamento traz o valor pago em centavos", () => {
  asaasEnv();
  const gateway = new AsaasGateway();
  const event = gateway.verifyWebhook(
    { "asaas-access-token": "tok_webhook_teste" },
    JSON.stringify({
      id: "evt_v1",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_v1", status: "RECEIVED", value: 176.4 },
    }),
  );
  assert.equal(event.status, "PAID");
  assert.equal(event.paidAmountCents, 17640);
});

test("Asaas: parcela de cartão parcelado NÃO informa valor (o value é de uma parcela só)", () => {
  asaasEnv();
  const gateway = new AsaasGateway();
  const event = gateway.verifyWebhook(
    { "asaas-access-token": "tok_webhook_teste" },
    JSON.stringify({
      id: "evt_v2",
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay_v2", status: "CONFIRMED", value: 33.33, installment: "ins_1" },
    }),
  );
  assert.equal(event.status, "PAID");
  assert.equal(event.paidAmountCents, undefined, "sem valor = sem conferência, nunca falso alarme");
});

test("Asaas: evento que não é de pagamento não carrega valor", () => {
  asaasEnv();
  const gateway = new AsaasGateway();
  const event = gateway.verifyWebhook(
    { "asaas-access-token": "tok_webhook_teste" },
    JSON.stringify({
      id: "evt_v3",
      event: "PAYMENT_REFUNDED",
      payment: { id: "pay_v3", status: "REFUNDED", value: 50 },
    }),
  );
  assert.equal(event.status, "REFUNDED");
  assert.equal(event.paidAmountCents, undefined);
});

test("Asaas: disputa de chargeback vencida vira CHARGEBACK_REVERSED (antes era tratada como perdida)", () => {
  assert.equal(mapAsaasStatus("AWAITING_CHARGEBACK_REVERSAL"), "CHARGEBACK_REVERSED");
  assert.equal(mapAsaasWebhookEvent("PAYMENT_AWAITING_CHARGEBACK_REVERSAL"), "CHARGEBACK_REVERSED");
  // evento informativo com o status atual da cobrança também
  assert.equal(
    mapAsaasWebhookEvent("PAYMENT_UPDATED", "AWAITING_CHARGEBACK_REVERSAL"),
    "CHARGEBACK_REVERSED",
  );
  // pedido e disputa em andamento seguem como perda (comportamento de sempre)
  assert.equal(mapAsaasStatus("CHARGEBACK_REQUESTED"), "CHARGEBACK");
  assert.equal(mapAsaasStatus("CHARGEBACK_DISPUTE"), "CHARGEBACK");
  assert.equal(mapAsaasWebhookEvent("PAYMENT_CHARGEBACK_DISPUTE"), "CHARGEBACK");
});

test("Asaas: getPaymentSnapshot devolve status e valor só quando pago", async () => {
  asaasEnv();
  const gateway = new AsaasGateway();
  stubFetchQueue([{ status: 200, body: { id: "pay_s1", status: "RECEIVED", value: 99.5 } }]);
  assert.deepEqual(await gateway.getPaymentSnapshot("pay_s1"), { status: "PAID", paidAmountCents: 9950 });

  stubFetchQueue([{ status: 200, body: { id: "pay_s2", status: "PENDING", value: 99.5 } }]);
  assert.deepEqual(await gateway.getPaymentSnapshot("pay_s2"), { status: "PENDING" });
});

test("Asaas: cartão aprovado devolve o valor registrado", async () => {
  asaasEnv();
  const gateway = new AsaasGateway();
  stubFetchQueue([
    { status: 200, body: { id: "cus_c1" } },
    { status: 200, body: { id: "pay_c1", status: "CONFIRMED", value: 106.99 } },
  ]);
  const result = await gateway.createCardPayment({
    paymentId: "pmt-c1",
    orderId: "order-c1",
    amountCents: 10699,
    cardToken: "tok_c1",
    installments: 1,
    customer: { email: "a@b.dev" },
    idempotencyKey: "idem-c1",
  });
  assert.deepEqual(result, { externalId: "pay_c1", status: "PAID", paidAmountCents: 10699 });
});

// --- Mercado Pago -------------------------------------------------------------

test("Mercado Pago: getPaymentSnapshot usa o total pago pelo comprador", async () => {
  process.env.MERCADOPAGO_ACCESS_TOKEN = "mp_test_token";
  process.env.MERCADOPAGO_API_URL = "https://mp.test.local";
  const gateway = new MercadoPagoGateway();

  stubFetchQueue([
    {
      status: 200,
      body: {
        id: 111,
        status: "approved",
        transaction_amount: 55,
        transaction_details: { total_paid_amount: 54.99 },
      },
    },
  ]);
  assert.deepEqual(await gateway.getPaymentSnapshot("111"), { status: "PAID", paidAmountCents: 5499 });

  stubFetchQueue([{ status: 200, body: { id: 112, status: "pending", transaction_amount: 55 } }]);
  assert.deepEqual(await gateway.getPaymentSnapshot("112"), { status: "PENDING" });

  // sem transaction_details: cai no valor cobrado
  stubFetchQueue([{ status: 200, body: { id: 113, status: "approved", transaction_amount: 55 } }]);
  assert.deepEqual(await gateway.getPaymentSnapshot("113"), { status: "PAID", paidAmountCents: 5500 });
});

// --- Pagar.me -----------------------------------------------------------------

test("Pagar.me: webhook charge.paid traz paid_amount (já em centavos)", () => {
  delete process.env.PAGARME_WEBHOOK_BASIC_USER;
  delete process.env.PAGARME_WEBHOOK_BASIC_PASSWORD;
  process.env.PAGARME_WEBHOOK_SECRET = "whsec_protecao";
  const gateway = new PagarmeGateway();
  const body = JSON.stringify({
    id: "hook_pa",
    type: "charge.paid",
    data: { id: "ch_pa", status: "paid", amount: 8800, paid_amount: 8000 },
  });
  const signature = `sha256=${createHmac("sha256", "whsec_protecao").update(body).digest("hex")}`;
  const event = gateway.verifyWebhook({ "x-hub-signature": signature }, body);
  assert.equal(event.status, "PAID");
  assert.equal(event.paidAmountCents, 8000);
});

test("Pagar.me: getPaymentSnapshot devolve paid_amount", async () => {
  process.env.PAGARME_SECRET_KEY = "sk_test_protecao";
  process.env.PAGARME_API_URL = "https://pagarme.test.local/core/v5";
  const gateway = new PagarmeGateway();
  stubFetchQueue([{ status: 200, body: { id: "ch_s1", status: "paid", amount: 8800, paid_amount: 8800 } }]);
  assert.deepEqual(await gateway.getPaymentSnapshot("ch_s1"), { status: "PAID", paidAmountCents: 8800 });
  // underpaid nunca vira PAID (auditoria 2026-08-30) — e sem valor
  stubFetchQueue([{ status: 200, body: { id: "ch_s2", status: "underpaid", amount: 8800, paid_amount: 5000 } }]);
  assert.deepEqual(await gateway.getPaymentSnapshot("ch_s2"), { status: "PENDING" });
});

// --- Mock -------------------------------------------------------------------

test("Mock: simulatePayment controla status e valor pago; webhook pode trazer o valor", async () => {
  const gateway = new MockGateway();
  assert.deepEqual(await gateway.getPaymentSnapshot("mock_x"), { status: "PENDING" });

  gateway.simulatePayment("mock_x", "PAID", 4900);
  assert.deepEqual(await gateway.getPaymentSnapshot("mock_x"), { status: "PAID", paidAmountCents: 4900 });

  gateway.simulatePayment("mock_x", "CHARGEBACK");
  assert.deepEqual(await gateway.getPaymentSnapshot("mock_x"), { status: "CHARGEBACK" });

  const card = await gateway.createCardPayment({
    paymentId: "p_card",
    orderId: "o_card",
    amountCents: 1234,
    cardToken: "tok_ok",
    installments: 1,
    customer: { email: "c@test.dev" },
    idempotencyKey: "k_card",
  });
  assert.equal(card.paidAmountCents, 1234);
  assert.deepEqual(await gateway.getPaymentSnapshot(card.externalId), {
    status: "PAID",
    paidAmountCents: 1234,
  });

  const body = JSON.stringify({
    id: "evt_mock_v",
    paymentExternalId: "mock_x",
    type: "payment.paid",
    status: "PAID",
    paidAmountCents: 4800,
  });
  const event = gateway.verifyWebhook({ "x-mock-signature": mockSignWebhookBody(body) }, body);
  assert.equal(event.paidAmountCents, 4800);
});

// --- Trava de boot ------------------------------------------------------------

test("boot: Pix no Mercado Pago sem token nem segredo do webhook é ERRO", () => {
  const report = checkPaymentSecrets({
    PAYMENTS_PROVIDER: "asaas",
    PAYMENTS_PROVIDER_PIX: "mercadopago",
    ASAAS_API_KEY: "k",
    ASAAS_WEBHOOK_TOKEN: "t",
  });
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0], /PAYMENTS_PROVIDER_PIX=mercadopago/);
  assert.match(report.errors[0], /MERCADOPAGO_ACCESS_TOKEN/);
  assert.match(report.errors[0], /MERCADOPAGO_WEBHOOK_SECRET/);
});

test("boot: só o segredo do webhook do MP faltando também barra", () => {
  const report = checkPaymentSecrets({
    PAYMENTS_PROVIDER: "asaas",
    PAYMENTS_PROVIDER_PIX: "mercadopago",
    ASAAS_API_KEY: "k",
    ASAAS_WEBHOOK_TOKEN: "t",
    MERCADOPAGO_ACCESS_TOKEN: "mp",
  });
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0], /MERCADOPAGO_WEBHOOK_SECRET/);
  assert.doesNotMatch(report.errors[0], /MERCADOPAGO_ACCESS_TOKEN/);
});

test("boot: configuração de produção completa (Pix MP + cartão Asaas) passa", () => {
  const report = checkPaymentSecrets({
    PAYMENTS_PROVIDER: "asaas",
    PAYMENTS_PROVIDER_PIX: "mercadopago",
    PAYMENTS_PROVIDER_CARD: "asaas",
    ASAAS_API_KEY: "k",
    ASAAS_WEBHOOK_TOKEN: "t",
    MERCADOPAGO_ACCESS_TOKEN: "mp",
    MERCADOPAGO_WEBHOOK_SECRET: "s",
  });
  assert.deepEqual(report, { errors: [], warnings: [] });
});

test("boot: cartão no Asaas sem chave é ERRO mesmo com PAYMENTS_PROVIDER=mercadopago", () => {
  const report = checkPaymentSecrets({
    PAYMENTS_PROVIDER: "mercadopago",
    PAYMENTS_PROVIDER_CARD: "asaas",
    MERCADOPAGO_ACCESS_TOKEN: "mp",
    MERCADOPAGO_WEBHOOK_SECRET: "s",
  });
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0], /PAYMENTS_PROVIDER_CARD=asaas/);
});

test("boot: provedor com nome errado é ERRO; reserva sem chave é só AVISO", () => {
  const errado = checkPaymentSecrets({ PAYMENTS_PROVIDER: "mercado_pago" });
  assert.equal(errado.errors.length, 1);
  assert.match(errado.errors[0], /desconhecido/);

  const reserva = checkPaymentSecrets({
    PAYMENTS_PROVIDER: "asaas",
    ASAAS_API_KEY: "k",
    ASAAS_WEBHOOK_TOKEN: "t",
    PAYMENTS_FALLBACK_PIX: "mercadopago",
  });
  assert.deepEqual(reserva.errors, []);
  assert.equal(reserva.warnings.length, 1);
  assert.match(reserva.warnings[0], /PAYMENTS_FALLBACK_PIX=mercadopago/);
});

test("boot: dev sem nada configurado (mock) não exige chave", () => {
  assert.deepEqual(checkPaymentSecrets({}), { errors: [], warnings: [] });
  assert.deepEqual(checkPaymentSecrets({ PAYMENTS_PROVIDER: "mock" }), { errors: [], warnings: [] });
});
