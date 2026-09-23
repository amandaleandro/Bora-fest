import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { ReservationsService } from "../reservations/reservations.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { OrdersService } from "../orders/orders.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { CheckinsService } from "../checkins/checkins.service";
import { FaceCheckinService } from "../checkins/face-checkin.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  delete process.env.FACE_PROVIDER_NAME;
  delete process.env.FACE_PROVIDER_VERIFY_URL;
  delete process.env.FACE_PROVIDER_API_KEY;
  await closeRedisConnection();
  await prisma.$disconnect();
});

async function buildOwnedTicket(eventId: string, lotId: string) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());

  const reservation = await reservations.create(undefined, {
    eventId,
    items: [{ ticketLotId: lotId, quantity: 1 }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: `face-${Math.random().toString(36).slice(2, 10)}@example.com`,
    contactName: "Titular Facial",
  });
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  const ticket = await prisma.ticket.create({
    data: {
      orderId: order.id,
      ownerUserId: order.userId,
      orderItemId: item.id,
      eventId,
      ticketLotId: lotId,
      seq: 1,
      code: `FACE-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      qrToken: "face-test-token",
      status: "ACTIVE",
      attendeeName: "Titular Facial",
      attendeeEmail: order.contactEmail,
    },
  });
  return { order, ticket, userId: order.userId! };
}

function service() {
  return new FaceCheckinService(new CheckinsService(new OrgAccessService()));
}

test("evento sem opt-in recusa cadastro facial", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 2 });
  try {
    const { ticket, userId } = await buildOwnedTicket(fixture.event.id, fixture.lot.id);
    process.env.FACE_PROVIDER_NAME = "test-provider";
    process.env.FACE_PROVIDER_VERIFY_URL = "https://face.example.test/verify";

    await assert.rejects(
      () =>
        service().enroll(userId, ticket.id, {
          provider: "test-provider",
          providerReference: "opaque-reference-123",
          consentVersion: "face-checkin-v1",
          consent: true,
        }),
      /não habilitou check-in facial/i,
    );
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("ambiente sem provedor não finge que enrollment está disponível", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 2 });
  try {
    await prisma.event.update({
      where: { id: fixture.event.id },
      data: { faceCheckinEnabled: true },
    });
    const { ticket, userId } = await buildOwnedTicket(fixture.event.id, fixture.lot.id);
    delete process.env.FACE_PROVIDER_NAME;
    delete process.env.FACE_PROVIDER_VERIFY_URL;

    await assert.rejects(
      () =>
        service().enroll(userId, ticket.id, {
          provider: "qualquer",
          providerReference: "opaque-reference-456",
          consentVersion: "face-checkin-v1",
          consent: true,
        }),
      /ainda não está configurado/i,
    );

    assert.equal(service().capabilities().enabled, false);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("status facial não expõe providerReference", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 2 });
  try {
    await prisma.event.update({
      where: { id: fixture.event.id },
      data: { faceCheckinEnabled: true },
    });
    const { ticket, userId } = await buildOwnedTicket(fixture.event.id, fixture.lot.id);
    process.env.FACE_PROVIDER_NAME = "test-provider";
    process.env.FACE_PROVIDER_VERIFY_URL = "https://face.example.test/verify";

    await service().enroll(userId, ticket.id, {
      provider: "test-provider",
      providerReference: "opaque-secret-reference",
      consentVersion: "face-checkin-v1",
      consent: true,
    });

    const status = await service().status(userId, ticket.id);
    assert.equal(status.enrolled, true);
    assert.equal(status.eventEnabled, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(status.enrollment ?? {}, "providerReference"),
      false,
      "referência biométrica não deve sair na resposta da conta",
    );
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
