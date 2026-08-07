import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { generateEventKeyPair, generateTicketCode, signTicketToken } from "@borafest/tickets";
import { randomBytes, randomUUID } from "crypto";
import { GuestListService } from "../guest-list/guest-list.service";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

/**
 * Simula o processamento do outbox `order.paid` que, em produção, roda no
 * worker (apps/worker/src/issue-tickets.ts) — mesma lógica: gera o código,
 * assina o QR com a chave do evento e cria o Ticket ligado ao pedido-tronco.
 * Reproduzido aqui para não acoplar o pacote da API ao app do worker; o
 * comportamento testado (pedido PAID de R$ 0 + outbox pendente) é o mesmo
 * contrato consumido pelo worker real.
 */
async function processGuestListOutbox(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true, event: { include: { signingKey: true } } },
  });

  let signingKey = order.event.signingKey;
  if (!signingKey) {
    const pair = generateEventKeyPair();
    signingKey = await prisma.eventSigningKey.create({
      data: { eventId: order.eventId, publicKeyPem: pair.publicKeyPem, privateKeyPem: pair.privateKeyPem },
    });
  }

  const item = order.items[0];
  const ticketId = randomUUID();
  const qrToken = signTicketToken(
    {
      v: 1,
      eid: order.eventId,
      tid: ticketId,
      lid: item.ticketLotId,
      n: randomBytes(8).toString("base64url"),
      iat: Math.floor(Date.now() / 1000),
    },
    signingKey.privateKeyPem,
  );

  const ticket = await prisma.ticket.create({
    data: {
      id: ticketId,
      orderId: order.id,
      orderItemId: item.id,
      eventId: order.eventId,
      ticketLotId: item.ticketLotId,
      seq: 1,
      code: generateTicketCode(),
      qrToken,
      status: "ACTIVE",
      attendeeName: order.contactName,
      attendeeEmail: order.contactEmail,
    },
  });

  await prisma.order.updateMany({ where: { id: order.id, status: "PAID" }, data: { status: "FULFILLED" } });
  await prisma.outboxEvent.updateMany({
    where: { aggregateId: order.id, eventType: "order.paid" },
    data: { status: "PROCESSED", processedAt: new Date() },
  });

  return ticket;
}

function buildService() {
  return new GuestListService(new OrgAccessService(), new InventoryService());
}

async function addOwnerMembership(organizationId: string, userId: string, ownerRoleId: string) {
  await prisma.organizationMember.create({
    data: { organizationId, userId, roleId: ownerRoleId, status: "ACTIVE" },
  });
}

test("lista de convidados: cadastro reserva o lote, gera pedido de R$0 e emite ticket escaneável via outbox", async () => {
  const { organization, event, lot, ownerRoleId } = await createFixtureEvent({ lotCapacity: 5 });

  try {
    const user = await prisma.user.create({ data: { name: "Produtor", email: `dono-${randomUUID()}@example.com` } });
    await addOwnerMembership(organization.id, user.id, ownerRoleId);

    const service = buildService();
    const entry = await service.create(user.id, event.id, {
      ticketLotId: lot.id,
      guestName: "Fulano Convidado",
    });

    assert.equal(entry.status, "CONFIRMED");
    assert.ok(entry.orderId, "deveria ter criado o pedido-tronco");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: entry.orderId! } });
    assert.equal(order.status, "PAID");
    assert.equal(order.totalCents, 0);

    const outbox = await prisma.outboxEvent.findFirst({ where: { aggregateId: order.id, eventType: "order.paid" } });
    assert.ok(outbox, "deveria ter enfileirado order.paid — mesma máquina das cortesias/vendas pagas");

    const lotAfterReserve = await prisma.ticketLot.findUniqueOrThrow({ where: { id: lot.id } });
    assert.equal(lotAfterReserve.soldCount, 1, "capacidade consumida imediatamente (confirmSale)");

    // processa o outbox como o worker real faria
    const ticket = await processGuestListOutbox(order.id);
    assert.equal(ticket.status, "ACTIVE");
    assert.ok(ticket.qrToken, "ticket deve ter QR assinado — escaneável na portaria");

    const listed = await service.list(user.id, event.id);
    const found = listed.find((e: any) => e.id === entry.id);
    assert.ok(found, "entrada deve aparecer na listagem");
    assert.equal((found as any).ticket?.id, ticket.id, "listagem deve refletir o ticket já emitido");
    assert.equal((found as any).ticket?.status, "ACTIVE");
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});

test("lista de convidados: lote cheio é recusado com lista cheia", async () => {
  const { organization, event, lot, ownerRoleId } = await createFixtureEvent({ lotCapacity: 1 });

  try {
    const user = await prisma.user.create({ data: { name: "Produtor", email: `dono-${randomUUID()}@example.com` } });
    await addOwnerMembership(organization.id, user.id, ownerRoleId);

    const service = buildService();
    await service.create(user.id, event.id, { ticketLotId: lot.id, guestName: "Primeiro Convidado" });

    await assert.rejects(
      () => service.create(user.id, event.id, { ticketLotId: lot.id, guestName: "Segundo Convidado" }),
      /lista cheia/i,
    );

    const lotAfter = await prisma.ticketLot.findUniqueOrThrow({ where: { id: lot.id } });
    assert.equal(lotAfter.soldCount, 1, "segunda tentativa não deveria ter consumido capacidade");
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});

test("lista de convidados: cancelar devolve a capacidade do lote e revoga o ticket emitido", async () => {
  const { organization, event, lot, ownerRoleId } = await createFixtureEvent({ lotCapacity: 2 });

  try {
    const user = await prisma.user.create({ data: { name: "Produtor", email: `dono-${randomUUID()}@example.com` } });
    await addOwnerMembership(organization.id, user.id, ownerRoleId);

    const service = buildService();
    const entry = await service.create(user.id, event.id, { ticketLotId: lot.id, guestName: "Convidado A" });
    const ticket = await processGuestListOutbox(entry.orderId!);

    const canceled = await service.cancel(user.id, event.id, entry.id);
    assert.equal(canceled.status, "CANCELED");

    const lotAfter = await prisma.ticketLot.findUniqueOrThrow({ where: { id: lot.id } });
    assert.equal(lotAfter.soldCount, 0, "capacidade deve voltar após o cancelamento");

    const ticketAfter = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(ticketAfter.status, "CANCELED");
    assert.ok(ticketAfter.canceledAt);

    // capacidade liberada permite novo cadastro
    const secondEntry = await service.create(user.id, event.id, { ticketLotId: lot.id, guestName: "Convidado B" });
    assert.equal(secondEntry.status, "CONFIRMED");
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});
