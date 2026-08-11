import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { MercadoPagoGateway, mapMercadoPagoStatus } from "./mercadopago";
import { WebhookVerificationError } from "./types";

test("mapeamento de status do Mercado Pago", () => {
  assert.equal(mapMercadoPagoStatus("approved"), "PAID");
  assert.equal(mapMercadoPagoStatus("pending"), "PENDING");
  assert.equal(mapMercadoPagoStatus("in_process"), "PENDING");
  assert.equal(mapMercadoPagoStatus("rejected"), "FAILED");
  assert.equal(mapMercadoPagoStatus("cancelled"), "CANCELED");
  assert.equal(mapMercadoPagoStatus("refunded"), "REFUNDED");
  assert.equal(mapMercadoPagoStatus("charged_back"), "CHARGEBACK");
});

test("webhook do MP: assinatura válida passa, adulterada é recusada, sem segredo é fail closed", () => {
  const gateway = new MercadoPagoGateway();
  const secret = "segredo-de-teste";
  const paymentId = "1234567890";
  const requestId = "req-abc";
  const ts = "1786000000";
  const body = JSON.stringify({ type: "payment", data: { id: paymentId } });

  const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");

  // sem segredo: nada é aceito
  delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
  assert.throws(
    () => gateway.verifyWebhook({ "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId }, body),
    WebhookVerificationError,
  );

  process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
  const evento = gateway.verifyWebhook(
    { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
    body,
  );
  assert.equal(evento.externalPaymentId, paymentId);
  assert.equal(evento.externalEventId, `payment:${paymentId}`);

  // assinatura adulterada
  assert.throws(
    () =>
      gateway.verifyWebhook(
        { "x-signature": `ts=${ts},v1=${"0".repeat(64)}`, "x-request-id": requestId },
        body,
      ),
    WebhookVerificationError,
  );

  // corpo adulterado (outro payment id) com a mesma assinatura
  assert.throws(
    () =>
      gateway.verifyWebhook(
        { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
        JSON.stringify({ type: "payment", data: { id: "9999999999" } }),
      ),
    WebhookVerificationError,
  );
  delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
});
