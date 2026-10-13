import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, type Prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { PaymentsService } from "../payments/payments.service";
import { pagouValorDiferente } from "../payments/valor-diferente";
import { IdempotencyService } from "../common/idempotency.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// PAGOU UM VALOR DIFERENTE DO COBRADO (2026-10-12). O gateway diz "pago", mas
// entrou menos: nada é faturado e o pedido segue pendente (apply-status.ts).
// Antes a tela do Pix ficava em "Aguardando pagamento" até expirar, para quem
// já tinha pago. O sync da tela agora devolve um sim/não — e só isso: nem os
// valores nem o resto do metadata (que pode ter dado do pagador) saem.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);
const marca = { amountMismatch: { expectedCents: 5500, paidCents: 5000, detectedAt: "2026-10-12T20:00:00.000Z" } };

test("regra: só pedido ainda não pago com a marca do gateway", () => {
  assert.equal(pagouValorDiferente({ status: "PAYMENT_PENDING", payments: [{ metadata: marca }] }), true);
  // expirou na janela normal: o aviso continua valendo
  assert.equal(pagouValorDiferente({ status: "EXPIRED", payments: [{ metadata: null }, { metadata: marca }] }), true);
  assert.equal(pagouValorDiferente({ status: "PAYMENT_PENDING", payments: [{ metadata: { payerDocument: "x" } }] }), false);
  assert.equal(pagouValorDiferente({ status: "PAYMENT_PENDING", payments: [] }), false);
  // a equipe resolveu e o pedido foi pago: a tela segue o caminho normal
  assert.equal(pagouValorDiferente({ status: "PAID", payments: [{ metadata: marca }] }), false);
  assert.equal(pagouValorDiferente({ status: "REFUNDED", payments: [{ metadata: marca }] }), false);
  // formatos estranhos não viram "sim"
  assert.equal(pagouValorDiferente({ status: "PAYMENT_PENDING", payments: [{ metadata: [marca] }] }), false);
  assert.equal(pagouValorDiferente({ status: "PAYMENT_PENDING", payments: [{ metadata: { amountMismatch: true } }] }), false);
});

test("sync da tela do Pix: devolve valorDiferente e nada além do sim/não", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 10, priceCents: 5000, feeCents: 500 });
  const payments = new PaymentsService(new IdempotencyService());
  try {
    const novoPedido = async (status: "PAYMENT_PENDING" | "PAID", metadata: Prisma.InputJsonObject | null) => {
      const reservation = await prisma.reservation.create({
        data: {
          eventId: fx.event.id,
          status: "CONVERTED",
          expiresAt: new Date(),
          items: { create: [{ ticketLotId: fx.lot.id, quantity: 1, priceCents: 5000, feeCents: 500 }] },
        },
      });
      const order = await prisma.order.create({
        data: {
          eventId: fx.event.id,
          reservationId: reservation.id,
          contactEmail: `pix-${rand()}@borafest.dev`,
          status,
          totalCents: 5500,
          items: { create: [{ ticketLotId: fx.lot.id, quantity: 1, priceCents: 5000, feeCents: 500 }] },
        },
      });
      // sem externalId: o sync não chama gateway nenhum — testa só o sinal
      await prisma.payment.create({
        data: {
          orderId: order.id,
          provider: "mock",
          method: "PIX",
          status: status === "PAID" ? "PAID" : "PENDING",
          amountCents: 5500,
          ...(metadata ? { metadata } : {}),
        },
      });
      return order;
    };

    const comMarca = await novoPedido("PAYMENT_PENDING", { ...marca, payerDocument: "52998224725" });
    const r = await payments.syncPendingPayment(comMarca.id);
    assert.equal(r.valorDiferente, true);
    const texto = JSON.stringify(r);
    assert.ok(!texto.includes("5000") && !texto.includes("5500"), "valores não saem");
    assert.ok(!texto.includes("52998224725"), "dado do pagador não sai");

    const semMarca = await novoPedido("PAYMENT_PENDING", null);
    assert.equal((await payments.syncPendingPayment(semMarca.id)).valorDiferente, false);

    const resolvido = await novoPedido("PAID", marca);
    assert.equal((await payments.syncPendingPayment(resolvido.id)).valorDiferente, false);
  } finally {
    await cleanupFixtureEvent(fx.organization.id);
  }
});
