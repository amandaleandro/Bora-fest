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
import { RefundRequestsService } from "../refund-requests/refund-requests.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

test("pedido de reembolso fica PENDING num pedido PAID e bloqueia duplicata", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const reservations = new ReservationsService(new InventoryService());
    const orders = new OrdersService();
    const payments = new PaymentsService(new IdempotencyService());
    const refundRequests = new RefundRequestsService();

    const reservation = await reservations.create(undefined, {
      eventId: event.id,
      items: [{ ticketLotId: lot.id, quantity: 1 }],
    });
    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: "comprador@example.com",
    });
    const payment = await payments.createPix(order.id, {});
    await applyGatewayStatus(payment.id, "PAID");

    const request = await refundRequests.create(order.publicToken, {
      reason: "Não vou poder ir mais ao evento",
    });
    assert.equal(request.status, "PENDING");
    assert.equal(request.orderId, order.id);

    await assert.rejects(
      () => refundRequests.create(order.publicToken, { reason: "Tentando de novo" }),
      /pendente/i,
    );

    const count = await prisma.refundRequest.count({ where: { orderId: order.id } });
    assert.equal(count, 1, "não pode criar um segundo pedido pendente pro mesmo pedido");
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});

test("pedido de reembolso é recusado se o pedido ainda não foi pago", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const reservations = new ReservationsService(new InventoryService());
    const orders = new OrdersService();
    const refundRequests = new RefundRequestsService();

    const reservation = await reservations.create(undefined, {
      eventId: event.id,
      items: [{ ticketLotId: lot.id, quantity: 1 }],
    });
    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: "comprador@example.com",
    });
    assert.equal(order.status, "PAYMENT_PENDING");

    await assert.rejects(
      () => refundRequests.create(order.publicToken, { reason: "Desisti" }),
      /pagamento aprovado/i,
    );
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});
