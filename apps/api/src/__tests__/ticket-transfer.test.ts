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

/**
 * Pedido pago com N ingressos. E-mail do comprador é aleatório, então a conta
 * do comprador SEMPRE é criada (order.userId = comprador) — determinístico. O
 * comprador é verificado, para o portão do 1º ingresso não interferir.
 */
async function buildPaidOrder(eventId: string, lotId: string, quantidade = 1) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  const payments = new PaymentsService(new IdempotencyService());

  const buyerEmail = `comprador-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const reservation = await reservations.create(undefined, {
    eventId,
    items: [{ ticketLotId: lotId, quantity: quantidade }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: buyerEmail,
    contactName: "Comprador Original",
  });
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");

  // comprador verificado (senão o portão do 1º ingresso esconde os QRs)
  await prisma.user.update({
    where: { id: order.userId! },
    data: { emailVerifiedAt: new Date() },
  });

  const keyPair = generateEventKeyPair();
  const signingKey = await prisma.eventSigningKey.create({
    data: { eventId, publicKeyPem: keyPair.publicKeyPem, privateKeyPem: keyPair.privateKeyPem },
  });

  const orderItem = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  const tickets = [];
  for (let seq = 1; seq <= quantidade; seq++) {
    const ticketId = randomUUID();
    const qrToken = signTicketToken(
      { v: 1, eid: eventId, tid: ticketId, lid: lotId, n: randomBytes(8).toString("base64url"), iat: 0 },
      signingKey.privateKeyPem,
    );
    tickets.push(
      await prisma.ticket.create({
        data: {
          id: ticketId,
          orderId: order.id,
          orderItemId: orderItem.id,
          eventId,
          ticketLotId: lotId,
          seq,
          code: generateTicketCode(),
          qrToken,
          status: "ACTIVE",
          attendeeName: "Comprador Original",
          attendeeEmail: order.contactEmail,
        },
      }),
    );
  }

  return { order, buyerUserId: order.userId!, tickets };
}

test("transferência troca titular, reassina o QR e audita", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const { buyerUserId, tickets } = await buildPaidOrder(event.id, lot.id);
    const ticket = tickets[0];
    const ticketsService = new TicketsService();

    const email = `novo-titular-${Math.random().toString(36).slice(2, 8)}@example.com`;
    // destino sem conta → recusa com orientação (decisão 2026-08-06)
    await assert.rejects(
      () => ticketsService.transferTicket(ticket.id, buyerUserId, { toEmail: email }),
      /criar a conta/i,
    );

    const toUser = await prisma.user.create({ data: { name: "Novo Titular", email } });
    const result = await ticketsService.transferTicket(ticket.id, buyerUserId, { toEmail: email });
    assert.equal(result.attendeeName, "Novo Titular");

    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(updated.ownerUserId, toUser.id, "POSSE muda para a conta destino");
    assert.notEqual(updated.qrToken, ticket.qrToken, "QR deve ser reassinado (nonce novo)");

    const carteiraNova = await ticketsService.findByUser(toUser.id);
    assert.ok(carteiraNova.some((t: any) => t.id === ticket.id), "ingresso na carteira destino");

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "ticket", entityId: ticket.id, action: "ticket.transfer" },
    });
    assert.ok(audit, "auditoria da transferência");
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});

test("quem não é o dono atual não transfere — nem sabendo o token do pedido", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const { tickets } = await buildPaidOrder(event.id, lot.id);
    const ticket = tickets[0];
    const ticketsService = new TicketsService();
    const estranho = await prisma.user.create({
      data: { email: `estranho-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });

    await assert.rejects(
      () => ticketsService.transferTicket(ticket.id, estranho.id, { toEmail: "golpista@example.com" }),
      /dono atual/i,
    );

    const intacto = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(intacto.attendeeName, "Comprador Original", "titular preservado");
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});

test("ROUBO BLOQUEADO: presenteado não recebe o token do pedido nem enxerga os outros ingressos", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 10 });

  try {
    // comprador com 3 ingressos, presenteia 1 para o Bob
    const { order, buyerUserId, tickets } = await buildPaidOrder(event.id, lot.id, 3);
    const ticketsService = new TicketsService();
    const bob = await prisma.user.create({
      data: { name: "Bob", email: `bob-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });

    await ticketsService.transferTicket(tickets[0].id, buyerUserId, { toEmail: bob.email! });

    // (1) carteira do Bob: vê SÓ o ingresso recebido, e SEM o token do pedido do comprador
    const carteiraBob = await ticketsService.findByUser(bob.id);
    assert.equal(carteiraBob.length, 1, "Bob vê só o ingresso que recebeu");
    assert.equal(
      carteiraBob[0].orderPublicToken,
      null,
      "token do pedido NÃO vaza para quem só recebeu",
    );

    // (2) mesmo que o Bob descobrisse o token, a visão por pedido não mostra os
    // ingressos que continuaram com o comprador para ELE roubar? Ele nem tem o
    // token — mas o comprador (dono do token) NÃO deve mais ver o do Bob:
    const visaoComprador = await ticketsService.findByOrderPublicToken(order.publicToken);
    const idsVisiveis = visaoComprador.tickets.map((t: any) => t.id);
    assert.ok(!idsVisiveis.includes(tickets[0].id), "ingresso transferido some da visão do comprador");
    assert.equal(idsVisiveis.length, 2, "comprador só vê os 2 que ainda são dele");

    // (3) Bob (dono do ingresso recebido) não consegue transferir os OUTROS do comprador
    await assert.rejects(
      () => ticketsService.transferTicket(tickets[1].id, bob.id, { toEmail: bob.email! }),
      /dono atual/i,
      "Bob não transfere ingresso que não é dele",
    );
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});

test("comprador NÃO reclama de volta um ingresso já presenteado", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const { buyerUserId, tickets } = await buildPaidOrder(event.id, lot.id);
    const ticket = tickets[0];
    const ticketsService = new TicketsService();
    const bob = await prisma.user.create({
      data: { name: "Bob", email: `bob-${Math.random().toString(36).slice(2, 8)}@example.com` },
    });

    await ticketsService.transferTicket(ticket.id, buyerUserId, { toEmail: bob.email! });

    // comprador tenta transferir de novo (para si ou outro) — agora não é dono
    await assert.rejects(
      () => ticketsService.transferTicket(ticket.id, buyerUserId, { toEmail: "carol@example.com" }),
      /dono atual/i,
    );

    const aindaBob = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(aindaBob.ownerUserId, bob.id, "posse continua com o Bob");
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});
