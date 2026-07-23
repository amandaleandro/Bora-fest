import { test } from "node:test";
import assert from "node:assert/strict";
import { generateTicketCode } from "@borafest/tickets";
import { prisma } from "@borafest/database";
import { CheckinsService } from "../checkins/checkins.service";
import { OrgAccessService } from "../common/org-access.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

test("check-in concorrente: N aparelhos escaneando o mesmo ingresso ao mesmo tempo, só um vence", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });

  try {
    // pedido/reserva mínimos só pra satisfazer as FKs do Ticket
    const reservation = await prisma.reservation.create({
      data: { eventId: event.id, status: "CONVERTED", expiresAt: new Date() },
    });
    const order = await prisma.order.create({
      data: {
        eventId: event.id,
        reservationId: reservation.id,
        contactEmail: "checkin-teste@example.com",
        status: "FULFILLED",
        totalCents: 5500,
      },
    });
    const orderItem = await prisma.orderItem.create({
      data: { orderId: order.id, ticketLotId: lot.id, quantity: 1, priceCents: 5000, feeCents: 500 },
    });
    const ticket = await prisma.ticket.create({
      data: {
        orderId: order.id,
        orderItemId: orderItem.id,
        eventId: event.id,
        ticketLotId: lot.id,
        seq: 1,
        code: generateTicketCode(),
        qrToken: "n/a",
        status: "ACTIVE",
      },
    });

    const DEVICE_COUNT = 8;
    const devices = [];
    for (let i = 0; i < DEVICE_COUNT; i++) {
      const credential = await prisma.validatorCredential.create({
        data: {
          eventId: event.id,
          label: `Credencial ${i}`,
          pinHash: "n/a",
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      const device = await prisma.validatorDevice.create({
        data: {
          credentialId: credential.id,
          eventId: event.id,
          name: `Aparelho ${i}`,
          tokenHash: "n/a",
          status: "ACTIVE",
        },
      });
      devices.push(device);
    }

    const checkins = new CheckinsService(new OrgAccessService());

    const results = await Promise.all(
      devices.map((device) => checkins.create(device, { code: ticket.code })),
    );

    const valid = results.filter((r) => r.result === "VALID").length;
    const alreadyUsed = results.filter((r) => r.result === "ALREADY_USED").length;

    assert.equal(valid, 1, "exatamente um aparelho deve vencer a corrida");
    assert.equal(alreadyUsed, DEVICE_COUNT - 1, "os demais devem ver ALREADY_USED");

    const finalTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(finalTicket.status, "CHECKED_IN");

    const confirmedCheckins = await prisma.checkin.count({
      where: { ticketId: ticket.id, status: "CONFIRMED" },
    });
    assert.equal(confirmedCheckins, 1, "só pode haver um check-in CONFIRMED por ingresso");
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});
