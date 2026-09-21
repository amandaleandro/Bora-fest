import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../catalog/catalog.service";
import { ReservationsService } from "../reservations/reservations.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { OrdersService } from "../orders/orders.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
  await prisma.$disconnect();
});

function services() {
  const inventory = new InventoryService();
  const access = new OrgAccessService();
  return {
    catalog: new CatalogService(access, inventory),
    reservations: new ReservationsService(inventory, new WaitingRoomService()),
    orders: new OrdersService(new CouponsService(access), access),
  };
}

test("janela do lote vale no catálogo e na reserva, não só na UI", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5 });
  const { catalog, reservations } = services();

  try {
    await prisma.ticketLot.update({
      where: { id: fixture.lot.id },
      data: {
        startsAt: new Date(Date.now() + 60 * 60_000),
        endsAt: new Date(Date.now() + 2 * 60 * 60_000),
      },
    });

    const beforeStart = await catalog.getPublicEvent(fixture.event.slug);
    assert.equal(
      beforeStart.ticketTypes.flatMap((type) => type.lots).some((lot) => lot.id === fixture.lot.id),
      false,
      "lote futuro não deve aparecer no catálogo público",
    );
    await assert.rejects(
      () =>
        reservations.create(undefined, {
          eventId: fixture.event.id,
          items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
        }),
      /ainda não começaram/i,
    );

    await prisma.ticketLot.update({
      where: { id: fixture.lot.id },
      data: {
        startsAt: new Date(Date.now() - 2 * 60 * 60_000),
        endsAt: new Date(Date.now() - 60 * 60_000),
      },
    });

    const afterEnd = await catalog.getPublicEvent(fixture.event.slug);
    assert.equal(
      afterEnd.ticketTypes.flatMap((type) => type.lots).some((lot) => lot.id === fixture.lot.id),
      false,
      "lote encerrado não deve aparecer no catálogo público",
    );
    await assert.rejects(
      () =>
        reservations.create(undefined, {
          eventId: fixture.event.id,
          items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
        }),
      /já foram encerradas/i,
    );
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("promoterOnly exige acesso válido no catálogo, reserva e pedido", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 10 });
  const { catalog, reservations, orders } = services();
  const suffix = Math.random().toString(36).slice(2, 9);
  const promoter = await prisma.user.create({
    data: { email: `promoter-exclusive-${suffix}@borafest.dev` },
  });
  const seller = await prisma.user.create({
    data: { email: `seller-exclusive-${suffix}@borafest.dev` },
  });

  try {
    await prisma.ticketLot.update({
      where: { id: fixture.lot.id },
      data: { promoterOnly: true },
    });
    const link = await prisma.promoterLink.create({
      data: {
        organizationId: fixture.organization.id,
        promoterUserId: promoter.id,
        eventId: fixture.event.id,
        status: "ACTIVE",
        commissionType: "NONE",
        slug: `pr-exclusive-${suffix}`,
      },
    });
    const sellerLink = await prisma.promoterSeller.create({
      data: {
        promoterLinkId: link.id,
        sellerUserId: seller.id,
        status: "ACTIVE",
        slug: `vd-exclusive-${suffix}`,
      },
    });

    const publicEvent = await catalog.getPublicEvent(fixture.event.slug);
    assert.equal(
      publicEvent.ticketTypes.flatMap((type) => type.lots).some((lot) => lot.id === fixture.lot.id),
      false,
      "público geral não vê lote exclusivo",
    );

    const promoterEvent = await catalog.getPublicEvent(fixture.event.slug, link.slug);
    assert.equal(
      promoterEvent.ticketTypes.flatMap((type) => type.lots).some((lot) => lot.id === fixture.lot.id),
      true,
      "link válido de promoter vê lote exclusivo",
    );

    const sellerEvent = await catalog.getPublicEvent(fixture.event.slug, undefined, sellerLink.slug);
    assert.equal(
      sellerEvent.ticketTypes.flatMap((type) => type.lots).some((lot) => lot.id === fixture.lot.id),
      true,
      "link válido de vendedor herda acesso do promoter",
    );

    await assert.rejects(
      () =>
        reservations.create(undefined, {
          eventId: fixture.event.id,
          items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
        }),
      /exige um link válido de promoter/i,
    );

    const reservation = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
      promoterSlug: link.slug,
    });

    await assert.rejects(
      () =>
        orders.createFromReservation(undefined, {
          reservationId: reservation.id,
          contactEmail: promoter.email,
        }),
      /ingresso exclusivo de promoter/i,
      "não pode usar uma reserva exclusiva para remover a atribuição no pedido",
    );

    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: promoter.email,
      promoterSlug: link.slug,
    });
    assert.equal(order.promoterLinkId, link.id);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
    await prisma.user.deleteMany({ where: { id: { in: [promoter.id, seller.id] } } });
  }
});
