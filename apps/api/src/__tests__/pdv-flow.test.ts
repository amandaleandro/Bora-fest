import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { generateEventKeyPair } from "@borafest/tickets";
import { issueTicketsForOrder } from "../../../worker/src/issue-tickets";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
  await prisma.$disconnect();
});

async function member(organizationId: string, roleKey: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const user = await prisma.user.create({
    data: { email: `pdv-${Math.random().toString(36).slice(2, 10)}@example.com` },
  });
  await prisma.organizationMember.create({
    data: { organizationId, userId: user.id, roleId: role.id, status: "ACTIVE" },
  });
  return user;
}

const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());

test("PDV dinheiro: idempotência, estoque, QR restrito e fechamento financeiro", async () => {
  const fixture = await createFixtureEvent({
    lotCapacity: 5,
    priceCents: 3000,
    feeCents: 0,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 3_600_000),
  });
  const key = `pdv-flow-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const seller = await member(fixture.organization.id, "owner");
    const otherSeller = await member(fixture.organization.id, "seller");
    const finance = await member(fixture.organization.id, "finance");
    const operator = await member(fixture.organization.id, "operator");
    const keys = generateEventKeyPair();
    await prisma.eventSigningKey.create({
      data: { eventId: fixture.event.id, publicKeyPem: keys.publicKeyPem, privateKeyPem: keys.privateKeyPem },
    });

    const input = { ticketLotId: fixture.lot.id, quantity: 2, buyerName: "Cliente da Porta" };
    const sale = await orders.createManualSale(fixture.event.id, seller.id, input, key);
    const retry = await orders.createManualSale(fixture.event.id, seller.id, input, key);
    assert.equal(retry.orderId, sale.orderId, "reclique não cria segunda venda");
    await issueTicketsForOrder(sale.orderId);

    const lot = await prisma.ticketLot.findUniqueOrThrow({ where: { id: fixture.lot.id } });
    assert.equal(lot.soldCount, 2);
    assert.equal(lot.reservedCount, 0);
    const ownTickets = await orders.getPdvOrderTickets(fixture.event.id, sale.orderId, seller.id);
    assert.equal(ownTickets.tickets.length, 2);
    assert.ok(ownTickets.tickets.every((ticket) => ticket.qrToken));
    await assert.rejects(
      () => orders.getPdvOrderTickets(fixture.event.id, sale.orderId, otherSeller.id),
      /somente o vendedor/i,
    );
    await assert.rejects(
      () => orders.getPdvOrderTickets(fixture.event.id, sale.orderId, operator.id),
      /sem permissão/i,
    );
    assert.equal((await orders.getPdvOrderTickets(fixture.event.id, sale.orderId, finance.id)).tickets.length, 2);

    const sellerClose = await orders.getPdvFechamento(fixture.event.id, seller.id);
    const financeClose = await orders.getPdvFechamento(fixture.event.id, finance.id);
    assert.equal(sellerClose.dinheiro.totalCents, 6000);
    assert.equal(sellerClose.dinheiro.pedidos, 1);
    assert.equal(sellerClose.pix.pedidos, 0);
    assert.equal(financeClose.dinheiro.totalCents, 6000);
    assert.equal(financeClose.veTudo, true);
    assert.equal((await orders.getPdvFechamento(fixture.event.id, otherSeller.id)).dinheiro.totalCents, 0);
  } finally {
    await prisma.idempotencyKey.deleteMany({ where: { key: { endsWith: `:${key}` } } });
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("PDV Pix pendente: cancelar libera estoque e não entra no caixa", async () => {
  const fixture = await createFixtureEvent({
    lotCapacity: 2,
    priceCents: 3000,
    feeCents: 0,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 3_600_000),
  });
  try {
    const seller = await member(fixture.organization.id, "owner");
    const sale = await orders.createManualPixSale(fixture.event.id, seller.id, {
      ticketLotId: fixture.lot.id,
      quantity: 1,
      buyerName: "Cliente Pix",
    });
    assert.equal((await prisma.ticketLot.findUniqueOrThrow({ where: { id: fixture.lot.id } })).reservedCount, 1);
    assert.equal((await orders.getPdvFechamento(fixture.event.id, seller.id)).pix.pedidos, 0);
    assert.deepEqual(await orders.cancelPdvPendingSale(fixture.event.id, seller.id, sale.orderId), {
      canceled: true,
      status: "CANCELED",
    });
    const lot = await prisma.ticketLot.findUniqueOrThrow({ where: { id: fixture.lot.id } });
    assert.equal(lot.reservedCount, 0);
    assert.equal(lot.soldCount, 0);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
