import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { ReservationsService } from "../../../api/src/reservations/reservations.service";
import { CouponsService } from "../../../api/src/coupons/coupons.service";
import { OrgAccessService } from "../../../api/src/common/org-access.service";
import { OrdersService } from "../../../api/src/orders/orders.service";
import { PaymentsService } from "../../../api/src/payments/payments.service";
import { InventoryService } from "../../../api/src/inventory/inventory.service";
import { WaitingRoomService } from "../../../api/src/waiting-room/waiting-room.service";
import { IdempotencyService } from "../../../api/src/common/idempotency.service";
import { createFixtureEvent, cleanupFixtureEvent } from "../../../api/src/__tests__/helpers";
import { awardLoyaltyForOrder, reverseLoyaltyForOrder } from "../loyalty";

after(async () => {
  await closeRedisConnection();
});

async function makePaidOrder(fixture: Awaited<ReturnType<typeof createFixtureEvent>>, email: string) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orgAccess = new OrgAccessService();
  const orders = new OrdersService(new CouponsService(orgAccess), orgAccess);
  const payments = new PaymentsService(new IdempotencyService());

  const reservation = await reservations.create(undefined, {
    eventId: fixture.event.id,
    items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: email,
    contactName: "Cliente Fidelidade",
  });
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");
  return order;
}

test("N9 fidelidade: crédito e reversão são idempotentes por pedido", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 20, priceCents: 10_000, feeCents: 0 });
  try {
    await prisma.$executeRaw`
      INSERT INTO loyalty_programs (
        id, organization_id, enabled, points_per_real,
        silver_points, gold_points, platinum_points, created_at, updated_at
      ) VALUES (
        ${randomUUID()}::uuid, ${fixture.organization.id}::uuid, FALSE, 2,
        100, 500, 1000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;

    const pausedOrder = await makePaidOrder(fixture, "loyalty-paused@example.com");
    await awardLoyaltyForOrder(pausedOrder.id);
    const pausedEntries = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM loyalty_entries
      WHERE organization_id = ${fixture.organization.id}::uuid AND source_id = ${pausedOrder.id}::uuid
    `;
    assert.equal(Number(pausedEntries[0]?.count ?? 0n), 0, "programa pausado não credita pontos");

    await prisma.$executeRaw`
      UPDATE loyalty_programs SET enabled = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ${fixture.organization.id}::uuid
    `;

    const order = await makePaidOrder(fixture, "LOYALTY@EXAMPLE.COM");
    await awardLoyaltyForOrder(order.id);
    await awardLoyaltyForOrder(order.id);

    const account = await prisma.$queryRaw<Array<{ email: string; balance: bigint }>>`
      SELECT a.email_key AS email, COALESCE(SUM(e.delta_points), 0)::bigint AS balance
      FROM loyalty_accounts a
      LEFT JOIN loyalty_entries e ON e.loyalty_account_id = a.id
      WHERE a.organization_id = ${fixture.organization.id}::uuid AND a.email_key = 'loyalty@example.com'
      GROUP BY a.id
    `;
    assert.equal(account[0]?.email, "loyalty@example.com");
    assert.equal(Number(account[0]?.balance ?? 0n), 200, "R$100 × 2 pontos/R$1");

    const earns = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM loyalty_entries
      WHERE organization_id = ${fixture.organization.id}::uuid
        AND source_type = 'ORDER_EARN' AND source_id = ${order.id}::uuid
    `;
    assert.equal(Number(earns[0]?.count ?? 0n), 1, "retry de order.paid não duplica crédito");

    await prisma.$executeRaw`
      UPDATE loyalty_programs SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ${fixture.organization.id}::uuid
    `;
    await reverseLoyaltyForOrder(order.id);
    await reverseLoyaltyForOrder(order.id);

    const balance = await prisma.$queryRaw<Array<{ points: bigint }>>`
      SELECT COALESCE(SUM(delta_points), 0)::bigint AS points
      FROM loyalty_entries
      WHERE organization_id = ${fixture.organization.id}::uuid
        AND loyalty_account_id = (
          SELECT id FROM loyalty_accounts
          WHERE organization_id = ${fixture.organization.id}::uuid AND email_key = 'loyalty@example.com'
        )
    `;
    assert.equal(Number(balance[0]?.points ?? 0n), 0, "reversão funciona mesmo com programa pausado");

    const reversals = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM loyalty_entries
      WHERE organization_id = ${fixture.organization.id}::uuid
        AND source_type = 'ORDER_REVERSAL' AND source_id = ${order.id}::uuid
    `;
    assert.equal(Number(reversals[0]?.count ?? 0n), 1, "retry de reversão não duplica débito");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
