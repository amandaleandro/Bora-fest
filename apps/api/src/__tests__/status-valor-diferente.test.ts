import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, type Prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { OrdersService } from "../orders/orders.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// VALOR DIFERENTE NO /status (2026-10-12): a página do pedido consulta o
// /status a cada 3 s; o sinal "pagou valor diferente" só vinha no sync do
// pagamento (~30 s). Agora o /status traz o mesmo sim/não — e o metadata do
// pagamento (pode ter dado do pagador) continua sem sair da rota pública.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);
const marca = { amountMismatch: { expectedCents: 5500, paidCents: 5000, detectedAt: "2026-10-12T20:00:00.000Z" } };

test("/status do pedido: valorDiferente na hora, sem metadata do pagamento", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 10, priceCents: 5000, feeCents: 500 });
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  try {
    const novoPedido = async (status: "PAYMENT_PENDING" | "PAID" | "EXPIRED", metadata: Prisma.InputJsonObject | null) => {
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
          contactEmail: `status-${rand()}@borafest.dev`,
          status,
          totalCents: 5500,
          items: { create: [{ ticketLotId: fx.lot.id, quantity: 1, priceCents: 5000, feeCents: 500 }] },
        },
      });
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
    const status = (await orders.findByPublicToken(comMarca.publicToken)) as Record<string, unknown> & {
      payments: Array<Record<string, unknown>>;
    };
    assert.equal(status.valorDiferente, true, "o polling vê o sinal sem esperar o sync");
    assert.equal(status.payments.length, 1, "o pagamento continua na resposta");
    assert.ok(status.payments.every((p) => !("metadata" in p)), "o metadata do pagamento não sai");
    const texto = JSON.stringify(status);
    assert.ok(!texto.includes("52998224725"), "dado do pagador não sai");
    assert.ok(!texto.includes("amountMismatch") && !texto.includes("paidCents"), "nem os valores da divergência");

    // expirou na janela normal: o aviso continua valendo
    const expirado = await novoPedido("EXPIRED", marca);
    assert.equal(((await orders.findByPublicToken(expirado.publicToken)) as { valorDiferente: boolean }).valorDiferente, true);

    // sem marca, ou resolvido e pago: "não"
    const semMarca = await novoPedido("PAYMENT_PENDING", null);
    assert.equal(((await orders.findByPublicToken(semMarca.publicToken)) as { valorDiferente: boolean }).valorDiferente, false);
    const pago = await novoPedido("PAID", marca);
    assert.equal(((await orders.findByPublicToken(pago.publicToken)) as { valorDiferente: boolean }).valorDiferente, false);
  } finally {
    await cleanupFixtureEvent(fx.organization.id);
  }
});
