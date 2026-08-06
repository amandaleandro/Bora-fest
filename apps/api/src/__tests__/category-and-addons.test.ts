import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { CatalogService } from "../catalog/catalog.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

test("categoria: evento entra e sai do filtro público conforme a categoria", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5 });

  try {
    await prisma.event.update({ where: { id: fixture.event.id }, data: { category: "FESTAS" } });

    const catalog = new CatalogService(new OrgAccessService(), new InventoryService());
    const festas = await catalog.listPublicEvents({ page: 1, pageSize: 20, category: "FESTAS" });
    assert.ok(festas.events.some((e) => e.id === fixture.event.id), "aparece no filtro da própria categoria");

    const shows = await catalog.listPublicEvents({ page: 1, pageSize: 20, category: "SHOWS" });
    assert.ok(!shows.events.some((e) => e.id === fixture.event.id), "some do filtro de outra categoria");

    const all = await catalog.listPublicEvents({ page: 1, pageSize: 20 });
    assert.ok(all.events.some((e) => e.id === fixture.event.id), "aparece sem filtro");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("itens adicionais: soma ao total do pedido sem entrar na base de comissão do parceiro", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 10_000, feeCents: 0 });

  try {
    const owner = await prisma.user.create({
      data: { email: `owner-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });
    await prisma.organizationMember.create({
      data: { organizationId: fixture.organization.id, userId: owner.id, roleId: fixture.ownerRoleId, status: "ACTIVE" },
    });

    const addOn = await prisma.eventAddOn.create({
      data: { eventId: fixture.event.id, name: "Camiseta do evento", priceCents: 5_000 },
    });
    const inactiveAddOn = await prisma.eventAddOn.create({
      data: { eventId: fixture.event.id, name: "Item descontinuado", priceCents: 1_000, active: false },
    });

    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());

    const reservation = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
    });
    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: "upsell@test.dev",
      addOns: [{ addOnId: addOn.id, quantity: 2 }],
    } as any);

    // ingresso 10.000 + 2x camiseta (5.000) = 20.000
    assert.equal(order.totalCents, 20_000);

    const items = await prisma.orderAddOnItem.findMany({ where: { orderId: order.id } });
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 2);
    assert.equal(items[0].priceCents, 5_000);

    // item inativo é rejeitado
    const reservation2 = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
    });
    await assert.rejects(
      orders.createFromReservation(undefined, {
        reservationId: reservation2.id,
        contactEmail: "inativo@test.dev",
        addOns: [{ addOnId: inactiveAddOn.id, quantity: 1 }],
      } as any),
      (error: any) => error.status === 400,
    );
  } finally {
    // cleanup apaga os pedidos primeiro (cascade em order_add_on_items) — só
    // depois dá pra apagar os add-ons sem violar a FK RESTRICT
    await cleanupFixtureEvent(fixture.organization.id);
    await prisma.eventAddOn.deleteMany({ where: { eventId: fixture.event.id } });
  }
});
