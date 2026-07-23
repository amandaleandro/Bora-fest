import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { applyGatewayStatus } from "@borafest/payments";
import { ReservationsService } from "../reservations/reservations.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { IdempotencyService } from "../common/idempotency.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// ReservationsService/OrdersService abrem conexão BullMQ/Redis persistente
// (normal numa API de vida longa) — num script de teste de vida curta, isso
// mantém o processo vivo pra sempre se não fechar explicitamente.
after(async () => {
  await closeRedisConnection();
});

test("pedido pago credita o ledger (venda + comissão) e webhook duplicado é no-op", async () => {
  const { organization, event, lot } = await createFixtureEvent({
    lotCapacity: 5,
    priceCents: 5000,
    feeCents: 500,
  });

  try {
    const reservations = new ReservationsService(new InventoryService());
    const orders = new OrdersService();
    const payments = new PaymentsService(new IdempotencyService());

    const reservation = await reservations.create(undefined, {
      eventId: event.id,
      items: [{ ticketLotId: lot.id, quantity: 1 }],
    });

    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: "teste-integracao@example.com",
    });
    assert.equal(order.status, "PAYMENT_PENDING");
    assert.equal(order.totalCents, 5500);

    const payment = await payments.createPix(order.id, {});
    assert.equal(payment.status, "PENDING");

    const applied = await applyGatewayStatus(payment.id, "PAID");
    assert.equal(applied.paymentChanged, true);
    assert.equal(applied.orderPaid, true);

    const paidOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(paidOrder.status, "PAID");

    const ledgerAccount = await prisma.ledgerAccount.findUnique({
      where: { organizationId: organization.id },
    });
    assert.ok(ledgerAccount, "deveria ter criado a conta do ledger");

    const entries = await prisma.ledgerEntry.findMany({
      where: { ledgerAccountId: ledgerAccount!.id },
      orderBy: { type: "asc" },
    });
    assert.equal(entries.length, 2, "deveria ter SALE_CREDIT + PLATFORM_FEE, nada mais");

    const credit = entries.find((e) => e.type === "SALE_CREDIT");
    const fee = entries.find((e) => e.type === "PLATFORM_FEE");
    assert.equal(credit?.amountCents, 5500);
    assert.ok((fee?.amountCents ?? 0) < 0, "comissão deve ser um débito (negativo)");

    // webhook duplicado: mesmo status PAID de novo não pode gerar novo lançamento
    const reapplied = await applyGatewayStatus(payment.id, "PAID");
    assert.equal(reapplied.paymentChanged, false, "PAID repetido deve ser no-op");

    const entriesAfterDuplicate = await prisma.ledgerEntry.count({
      where: { ledgerAccountId: ledgerAccount!.id },
    });
    assert.equal(entriesAfterDuplicate, 2, "webhook duplicado não pode duplicar lançamento");

    const lotAfter = await prisma.ticketLot.findUniqueOrThrow({ where: { id: lot.id } });
    assert.equal(lotAfter.soldCount, 1);
    assert.equal(lotAfter.reservedCount, 0);
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});
