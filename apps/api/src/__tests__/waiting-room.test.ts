import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection, getRedisConnection, sweepWaitingRoom } from "@borafest/queues";
import { ReservationsService } from "../reservations/reservations.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

test("sala de espera desativada: reserva não exige ticket", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });
  try {
    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
    const reservation = await reservations.create(undefined, {
      eventId: event.id,
      items: [{ ticketLotId: lot.id, quantity: 1 }],
    });
    assert.ok(reservation.id);
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});

test("sala de espera ativa: 1ª entrada admite, 2ª fica na fila; reserva sem ticket admitido é recusada", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });
  await prisma.event.update({
    where: { id: event.id },
    data: { waitingRoomEnabled: true, waitingRoomConcurrency: 1 },
  });

  try {
    const waitingRoomService = new WaitingRoomService();
    const reservations = new ReservationsService(new InventoryService(), waitingRoomService);

    const first = await waitingRoomService.join(event.slug);
    assert.equal(first.status, "ADMITTED");

    const second = await waitingRoomService.join(event.slug);
    assert.equal(second.status, "QUEUED");
    if (second.status === "QUEUED") assert.equal(second.position, 1);

    // sem ticket: recusado
    await assert.rejects(
      reservations.create(undefined, { eventId: event.id, items: [{ ticketLotId: lot.id, quantity: 1 }] }),
      /Forbidden|sala de espera/i,
    );

    // com o ticket admitido: passa
    const withAdmitted = await reservations.create(undefined, {
      eventId: event.id,
      items: [{ ticketLotId: lot.id, quantity: 1 }],
      waitingRoomTicketId: first.status === "ADMITTED" ? first.ticketId : undefined,
    });
    assert.ok(withAdmitted.id);

    // ticket ainda na fila (não admitido): recusado
    await assert.rejects(
      reservations.create(undefined, {
        eventId: event.id,
        items: [{ ticketLotId: lot.id, quantity: 1 }],
        waitingRoomTicketId: second.status === "QUEUED" ? second.ticketId : undefined,
      }),
    );
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});

test("sweep promove da fila pros admitidos quando o slot expira", async () => {
  const { organization, event } = await createFixtureEvent({ lotCapacity: 5 });
  await prisma.event.update({
    where: { id: event.id },
    data: { waitingRoomEnabled: true, waitingRoomConcurrency: 1 },
  });

  try {
    const waitingRoomService = new WaitingRoomService();
    const redis = getRedisConnection();

    const first = await waitingRoomService.join(event.slug);
    const second = await waitingRoomService.join(event.slug);
    assert.equal(first.status, "ADMITTED");
    assert.equal(second.status, "QUEUED");

    // simula o slot do 1º expirando (TTL vencido)
    if (first.status === "ADMITTED") {
      await redis.zadd(`wr:active:${event.id}`, Date.now() - 1000, first.ticketId);
    }

    await sweepWaitingRoom(redis, event.id, 1);

    const statusOfSecond = await waitingRoomService.status(
      event.slug,
      second.status === "QUEUED" ? second.ticketId : "",
    );
    assert.equal(statusOfSecond.status, "ADMITTED");
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});
