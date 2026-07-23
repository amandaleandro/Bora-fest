import assert from "node:assert/strict";
import { test } from "node:test";
import { MockGateway, mockSignWebhookBody } from "./mock";
import { WebhookVerificationError } from "./types";

test("mock: webhook assinado é aceito e adulterado é rejeitado", () => {
  const gateway = new MockGateway();
  const body = JSON.stringify({
    id: "evt_1",
    paymentExternalId: "mock_pix_p1",
    type: "payment.paid",
    status: "PAID",
  });

  const event = gateway.verifyWebhook({ "x-mock-signature": mockSignWebhookBody(body) }, body);
  assert.equal(event.externalPaymentId, "mock_pix_p1");
  assert.equal(event.status, "PAID");

  assert.throws(
    () => gateway.verifyWebhook({ "x-mock-signature": "0".repeat(64) }, body),
    WebhookVerificationError,
  );
  assert.throws(() => gateway.verifyWebhook({}, body), WebhookVerificationError);
});

test("mock: cartão com token _fail recusa, demais aprovam", async () => {
  const gateway = new MockGateway();
  const base = {
    paymentId: "p1",
    orderId: "o1",
    amountCents: 1000,
    installments: 1,
    customer: { email: "c@test.dev" },
    idempotencyKey: "k1",
  };
  const fail = await gateway.createCardPayment({ ...base, cardToken: "tok_fail" });
  assert.equal(fail.status, "FAILED");
  const ok = await gateway.createCardPayment({ ...base, paymentId: "p2", cardToken: "tok_ok" });
  assert.equal(ok.status, "PAID");
  assert.equal(await gateway.getStatus(ok.externalId), "PAID");
});
