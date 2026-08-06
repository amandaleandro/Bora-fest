import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { applyGatewayStatus } from "@borafest/payments";
import { generateEventKeyPair, generateTicketCode, signTicketToken } from "@borafest/tickets";
import { randomBytes, randomUUID } from "crypto";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { IdempotencyService } from "../common/idempotency.service";
import { TicketsService } from "../tickets/tickets.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

async function buildPaidOrderWithTicket(eventId: string, lotId: string) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  const payments = new PaymentsService(new IdempotencyService());

  const reservation = await reservations.create(undefined, {
    eventId,
    items: [{ ticketLotId: lotId, quantity: 1 }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: "titular-original@example.com",
    contactName: "Titular Original",
  });
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");

  const keyPair = generateEventKeyPair();
  const signingKey = await prisma.eventSigningKey.create({
    data: { eventId, publicKeyPem: keyPair.publicKeyPem, privateKeyPem: keyPair.privateKeyPem },
  });

  const orderItem = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  const ticketId = randomUUID();
  const qrToken = signTicketToken(
    { v: 1, eid: eventId, tid: ticketId, lid: lotId, n: randomBytes(8).toString("base64url"), iat: 0 },
    signingKey.privateKeyPem,
  );
  const ticket = await prisma.ticket.create({
    data: {
      id: ticketId,
      orderId: order.id,
      orderItemId: orderItem.id,
      eventId,
      ticketLotId: lotId,
      seq: 1,
      code: generateTicketCode(),
      qrToken,
      status: "ACTIVE",
      attendeeName: "Titular Original",
      attendeeEmail: "titular-original@example.com",
    },
  });

  return { order, ticket };
}

test("transferência de ingresso troca titular, reassina o QR e audita", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const { order, ticket } = await buildPaidOrderWithTicket(event.id, lot.id);
    const ticketsService = new TicketsService();

    const email = `novo-titular-${Math.random().toString(36).slice(2, 8)}@example.com`;
    // destino sem conta → recusa com orientação (decisão 2026-08-06)
    await assert.rejects(
      () =>
        ticketsService.transferTicket(ticket.id, {
          orderPublicToken: order.publicToken,
          toEmail: email,
        }),
      /criar a conta/i,
    );

    const toUser = await prisma.user.create({ data: { name: "Novo Titular", email } });
    const result = await ticketsService.transferTicket(ticket.id, {
      orderPublicToken: order.publicToken,
      toEmail: email,
    });

    assert.equal(result.attendeeName, "Novo Titular");

    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(updated.ownerUserId, toUser.id, "POSSE muda para a conta destino");
    assert.equal(updated.attendeeName, "Novo Titular");
    assert.equal(updated.attendeeEmail, email);
    assert.notEqual(updated.qrToken, ticket.qrToken, "QR deve ser reassinado (nonce novo)");

    // carteira: aparece para o novo dono, some para quem não é dono
    const carteiraNova = await ticketsService.findByUser(toUser.id);
    assert.ok(carteiraNova.some((t: any) => t.id === ticket.id), "ingresso na carteira destino");

    // aviso ao novo dono entrou na fila
    const aviso = await prisma.notification.findFirst({
      where: { recipient: email, template: "ticket_transferred" },
    });
    assert.ok(aviso, "notificação de transferência enfileirada");

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "ticket", entityId: ticket.id, action: "ticket.transfer" },
    });
    assert.ok(audit, "deveria ter registrado auditoria da transferência");
    assert.equal((audit!.metadata as any).toEmail, email);
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});

test("transferência com orderPublicToken errado é recusada (403)", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const { ticket } = await buildPaidOrderWithTicket(event.id, lot.id);
    const ticketsService = new TicketsService();

    await assert.rejects(
      () =>
        ticketsService.transferTicket(ticket.id, {
          orderPublicToken: "00000000-0000-0000-0000-000000000000",
          toEmail: "golpista@example.com",
        }),
      /Forbidden|não confere/i,
    );

    const untouched = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(untouched.attendeeName, "Titular Original");
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});
