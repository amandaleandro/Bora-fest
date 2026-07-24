import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { InventoryService } from "../inventory/inventory.service";
import { NotificationsService } from "../notifications/notifications.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

test("registro de push token fica atrelado ao pedido (upsert por token)", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const reservations = new ReservationsService(new InventoryService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    const notifications = new NotificationsService();

    const reservation = await reservations.create(undefined, {
      eventId: event.id,
      items: [{ ticketLotId: lot.id, quantity: 1 }],
    });
    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: "comprador@example.com",
    });

    const result = await notifications.registerPushToken(order.publicToken, {
      token: "ExponentPushToken[teste-fixture-1234567890]",
      platform: "android",
    });
    assert.equal(result.registered, true);

    const stored = await prisma.pushToken.findUniqueOrThrow({
      where: { token: "ExponentPushToken[teste-fixture-1234567890]" },
    });
    assert.equal(stored.orderId, order.id);
    assert.equal(stored.platform, "android");

    // registrar de novo o mesmo token (reinstalo/reabri o app) é upsert, não duplica
    await notifications.registerPushToken(order.publicToken, {
      token: "ExponentPushToken[teste-fixture-1234567890]",
      platform: "ios",
    });
    const count = await prisma.pushToken.count({
      where: { token: "ExponentPushToken[teste-fixture-1234567890]" },
    });
    assert.equal(count, 1, "upsert não deveria criar uma segunda linha pro mesmo token");
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});
