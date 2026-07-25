import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { InventoryService } from "../inventory/inventory.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

function services() {
  return {
    reservations: new ReservationsService(new InventoryService()),
    orders: new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService()),
  };
}

test("quem paga a taxa: PRODUCER não cobra a taxa do comprador; BUYER cobra", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 10, priceCents: 10000, feeCents: 1000 });
  try {
    const { reservations, orders } = services();

    // BUYER (padrão): comprador paga preço + taxa
    const r1 = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
    });
    const o1 = await orders.createFromReservation(undefined, {
      reservationId: r1.id,
      contactEmail: "buyer@test.dev",
    });
    assert.equal(o1.totalCents, 11000, "BUYER: 100,00 + 10,00 de taxa");

    // PRODUCER: produtor absorve — comprador paga só o preço
    await prisma.ticketLot.update({
      where: { id: fixture.lot.id },
      data: { feeMode: "PRODUCER" },
    });
    const r2 = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
    });
    const o2 = await orders.createFromReservation(undefined, {
      reservationId: r2.id,
      contactEmail: "producer@test.dev",
    });
    assert.equal(o2.totalCents, 10000, "PRODUCER: taxa por conta do produtor");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("ingresso nominal exige um participante por unidade (e CPF quando o lote pede)", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 10, priceCents: 5000, feeCents: 0 });
  try {
    await prisma.ticketLot.update({
      where: { id: fixture.lot.id },
      data: { nominal: true, requiresCpf: true },
    });
    const { reservations, orders } = services();

    const reservation = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: fixture.lot.id, quantity: 2 }],
    });

    // sem participantes → recusa
    await assert.rejects(
      orders.createFromReservation(undefined, {
        reservationId: reservation.id,
        contactEmail: "nominal@test.dev",
      }),
      /participante/i,
    );

    // com 1 participante para 2 ingressos → ainda recusa
    await assert.rejects(
      orders.createFromReservation(undefined, {
        reservationId: reservation.id,
        contactEmail: "nominal@test.dev",
        attendees: [{ ticketLotId: fixture.lot.id, name: "Ana Souza", cpf: "52998224725" }],
      }),
      /participante/i,
    );

    // sem CPF num lote que exige → recusa
    await assert.rejects(
      orders.createFromReservation(undefined, {
        reservationId: reservation.id,
        contactEmail: "nominal@test.dev",
        attendees: [
          { ticketLotId: fixture.lot.id, name: "Ana Souza", cpf: "52998224725" },
          { ticketLotId: fixture.lot.id, name: "Bruno Lima" },
        ],
      }),
      /CPF/i,
    );

    // completo → passa e grava os participantes
    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: "nominal@test.dev",
      attendees: [
        { ticketLotId: fixture.lot.id, name: "Ana Souza", cpf: "529.982.247-25" },
        { ticketLotId: fixture.lot.id, name: "Bruno Lima", cpf: "52998224725" },
      ],
    });

    const attendees = await prisma.orderAttendee.findMany({ where: { orderId: order.id } });
    assert.equal(attendees.length, 2);
    assert.ok(
      attendees.every((a) => a.cpf && /^\d{11}$/.test(a.cpf)),
      "CPF é normalizado para só dígitos",
    );
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("consentimento LGPD é gravado versionado por pedido", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5 });
  try {
    const { reservations, orders } = services();
    const reservation = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
    });
    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: "lgpd@test.dev",
      consent: { version: "v2026-07", terms: true, privacy: true },
    });

    const consents = await prisma.consent.findMany({ where: { orderId: order.id } });
    assert.equal(consents.length, 2, "termos + privacidade");
    assert.ok(consents.every((c) => c.version === "v2026-07"));
    assert.deepEqual(consents.map((c) => c.document).sort(), ["privacy", "terms"]);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
