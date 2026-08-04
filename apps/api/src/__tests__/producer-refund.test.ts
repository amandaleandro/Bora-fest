import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
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

async function paidOrderWithMember(fixture: Awaited<ReturnType<typeof createFixtureEvent>>) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  const payments = new PaymentsService(new IdempotencyService());

  const reservation = await reservations.create(undefined, {
    eventId: fixture.event.id,
    items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: `casa-${Math.random().toString(36).slice(2, 8)}@borafest.dev`,
  });
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");

  const member = await prisma.user.create({
    data: { email: `dono-casa-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
  });
  await prisma.organizationMember.create({
    data: {
      organizationId: fixture.organization.id,
      userId: member.id,
      roleId: fixture.ownerRoleId,
      status: "ACTIVE",
    },
  });
  return { order, member };
}

test("casa INSTANTÂNEA aprova o próprio reembolso; PADRÃO é barrada", async () => {
  const service = new RefundRequestsService(new OrgAccessService());

  // PADRÃO: solicitação nasce roteada para a BoraFest e a casa não resolve
  const padrao = await createFixtureEvent({ lotCapacity: 5, priceCents: 8000, feeCents: 0 });
  try {
    const { order, member } = await paidOrderWithMember(padrao);
    const pedido = await service.create(order.publicToken, { reason: "não vou mais" });
    assert.equal(pedido.reviewedBy, "BoraFest");

    await assert.rejects(
      () => service.approveByOrganization(pedido.id, padrao.organization.id, member.id, {}),
      /quem analisa reembolsos é a BoraFest/,
    );
  } finally {
    await cleanupFixtureEvent(padrao.organization.id);
  }

  // INSTANTÂNEO: solicitação roteada para a casa, e ela executa o estorno
  const instant = await createFixtureEvent({ lotCapacity: 5, priceCents: 8000, feeCents: 0 });
  try {
    await prisma.organization.update({
      where: { id: instant.organization.id },
      data: { settlementMode: "INSTANT" },
    });
    const { order, member } = await paidOrderWithMember(instant);
    const pedido = await service.create(order.publicToken, { reason: "evento remarcado" });
    assert.equal(pedido.reviewedBy, instant.organization.name);

    const result = await service.approveByOrganization(
      pedido.id,
      instant.organization.id,
      member.id,
      {},
    );
    assert.equal(result.approved, true);

    // estorno de verdade: pedido revertido e débito no ledger da casa
    const refreshed = await prisma.refundRequest.findUniqueOrThrow({ where: { id: pedido.id } });
    assert.equal(refreshed.status, "APPROVED");
    const orderAfter = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(orderAfter.status, "REFUNDED");
  } finally {
    await cleanupFixtureEvent(instant.organization.id);
  }
});
