import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { generateEventKeyPair } from "@borafest/tickets";
import { ReservationsService } from "../../../api/src/reservations/reservations.service";
import { CouponsService } from "../../../api/src/coupons/coupons.service";
import { OrgAccessService } from "../../../api/src/common/org-access.service";
import { OrdersService } from "../../../api/src/orders/orders.service";
import { PaymentsService } from "../../../api/src/payments/payments.service";
import { InventoryService } from "../../../api/src/inventory/inventory.service";
import { WaitingRoomService } from "../../../api/src/waiting-room/waiting-room.service";
import { IdempotencyService } from "../../../api/src/common/idempotency.service";
import { issueTicketsForOrder } from "../issue-tickets";
import { createFixtureEvent, cleanupFixtureEvent } from "../../../api/src/__tests__/helpers";

after(async () => {
  await closeRedisConnection();
});

test("compra múltipla: 3 ingressos no mesmo pedido, cada um com código e QR próprios", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 10, priceCents: 5000, feeCents: 0 });
  try {
    // chave de assinatura do evento (emissão assina o QR de cada unidade)
    const keyPair = generateEventKeyPair();
    await prisma.eventSigningKey.create({
      data: {
        eventId: fixture.event.id,
        publicKeyPem: keyPair.publicKeyPem,
        privateKeyPem: keyPair.privateKeyPem,
      },
    });

    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    const payments = new PaymentsService(new IdempotencyService());

    const reservation = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: fixture.lot.id, quantity: 3 }],
    });
    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: "compra-multipla@borafest.dev",
    });
    // 3 × (5000 + taxa automática 2,49 fica no fixture com feeCents 0 → 3×5000)
    assert.equal(order.totalCents, 15000);

    const payment = await payments.createPix(order.id, {});
    await applyGatewayStatus(payment.id, "PAID");
    await issueTicketsForOrder(order.id);

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    assert.equal(tickets.length, 3, "3 unidades emitidas");
    assert.equal(new Set(tickets.map((t) => t.code)).size, 3, "códigos únicos");
    assert.equal(new Set(tickets.map((t) => t.qrToken)).size, 3, "QRs únicos");
    assert.ok(tickets.every((t) => t.status === "ACTIVE" || t.status === "ISSUED"));

    // estoque: 3 vendidos
    const lot = await prisma.ticketLot.findUniqueOrThrow({ where: { id: fixture.lot.id } });
    assert.equal(lot.soldCount, 3);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
