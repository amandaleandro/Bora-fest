import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { applyGatewayStatus } from "@borafest/payments";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { IdempotencyService } from "../common/idempotency.service";
import { RefundRequestsService } from "../refund-requests/refund-requests.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

test("pedido de reembolso fica PENDING num pedido PAID e bloqueia duplicata", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    const payments = new PaymentsService(new IdempotencyService());
    const refundRequests = new RefundRequestsService(new OrgAccessService());

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
    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    const refundRequests = new RefundRequestsService(new OrgAccessService());

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


test("comprador não pede reembolso self-service enquanto ingresso estiver transferido a terceiro", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    const payments = new PaymentsService(new IdempotencyService());
    const refundRequests = new RefundRequestsService(new OrgAccessService());

    const reservation = await reservations.create(undefined, {
      eventId: event.id,
      items: [{ ticketLotId: lot.id, quantity: 1 }],
    });
    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: `refund-owner-${Math.random().toString(36).slice(2, 8)}@example.com`,
      contactName: "Titular",
    });
    const payment = await payments.createPix(order.id, {});
    await applyGatewayStatus(payment.id, "PAID");

    const recipient = await prisma.user.create({
      data: { email: `refund-recipient-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    await prisma.ticket.create({
      data: {
        orderId: order.id,
        orderItemId: item.id,
        eventId: event.id,
        ticketLotId: lot.id,
        seq: 1,
        code: `RF-${Math.random().toString(36).slice(2, 10)}`,
        qrToken: "qr-refund-transferred",
        status: "ACTIVE",
        ownerUserId: recipient.id,
        attendeeEmail: recipient.email,
      },
    });

    await assert.rejects(
      () =>
        refundRequests.create(order.publicToken, {
          reason: "Quero cancelar mesmo depois de transferir",
        }),
      /transferido para outra pessoa/i,
    );

    const count = await prisma.refundRequest.count({ where: { orderId: order.id } });
    assert.equal(count, 0, "não cria solicitação que pode revogar ingresso de terceiro");
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});
