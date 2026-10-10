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
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Pedido de R$ 0 no checkout online (2026-10-10): antes nascia PAYMENT_PENDING e
// o comprador batia em "pagamento mínimo de R$ 5,00" sem saída. Agora nasce pago
// e segue a mesma emissão da cortesia (outbox order.paid), sem lançamento no ledger.

after(async () => {
  await closeRedisConnection();
});

function servicos() {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  return { reservations, orders };
}

async function limpar(organizationId: string, orderIds: string[]) {
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: orderIds } } });
  await prisma.couponRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
  await cleanupFixtureEvent(organizationId);
}

async function conferirPagoSemCobranca(orderId: string, organizationId: string, lotId: string, quantidade: number) {
  const pedido = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(pedido.status, "PAID", "pedido de R$ 0 nasce pago");
  assert.equal(pedido.totalCents, 0);
  assert.ok(pedido.paidAt, "paidAt preenchido");
  assert.equal(pedido.expiresAt, null, "sem prazo de pagamento");

  const pagamentos = await prisma.payment.count({ where: { orderId } });
  assert.equal(pagamentos, 0, "nenhuma cobrança no gateway");

  const lote = await prisma.ticketLot.findUniqueOrThrow({ where: { id: lotId } });
  assert.equal(lote.soldCount, quantidade, "estoque vira vendido na hora");
  assert.equal(lote.reservedCount, 0, "nada fica preso em reservado");

  const emissao = await prisma.outboxEvent.count({
    where: { aggregateId: orderId, eventType: "order.paid" },
  });
  assert.equal(emissao, 1, "o worker recebe order.paid para emitir o ingresso");

  const lancamentos = await prisma.ledgerEntry.count({
    where: { ledgerAccount: { organizationId } },
  });
  assert.equal(lancamentos, 0, "R$ 0 não gera venda nem taxa no extrato do produtor");
}

test("lote de R$ 0: o pedido nasce pago, sem cobrança, e vai para emissão", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 10, priceCents: 0, feeCents: 0 });
  const ids: string[] = [];
  try {
    const { reservations, orders } = servicos();
    const reserva = await reservations.create(undefined, {
      eventId: event.id,
      items: [{ ticketLotId: lot.id, quantity: 2 }],
    });
    const pedido = await orders.createFromReservation(undefined, {
      reservationId: reserva.id,
      contactEmail: "teste-integracao@example.com",
    });
    ids.push(pedido.id);
    assert.equal(pedido.status, "PAID");
    await conferirPagoSemCobranca(pedido.id, organization.id, lot.id, 2);
  } finally {
    await limpar(organization.id, ids);
  }
});

test("cupom de 100%: o pedido zera e também nasce pago", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 10, priceCents: 5000, feeCents: 500 });
  const ids: string[] = [];
  try {
    await prisma.coupon.create({
      data: { eventId: event.id, code: "CEMPORCENTO", discountType: "PERCENT", discountValue: 100 },
    });
    const { reservations, orders } = servicos();
    const reserva = await reservations.create(undefined, {
      eventId: event.id,
      items: [{ ticketLotId: lot.id, quantity: 1 }],
    });
    const pedido = await orders.createFromReservation(undefined, {
      reservationId: reserva.id,
      contactEmail: "teste-integracao@example.com",
      couponCode: "CEMPORCENTO",
    });
    ids.push(pedido.id);
    await conferirPagoSemCobranca(pedido.id, organization.id, lot.id, 1);
    const resgates = await prisma.couponRedemption.count({ where: { orderId: pedido.id } });
    assert.equal(resgates, 1, "o uso do cupom continua registrado");
  } finally {
    await limpar(organization.id, ids);
  }
});

test("proteção de reembolso marcada num ingresso grátis é ignorada", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 10, priceCents: 0, feeCents: 0 });
  const ids: string[] = [];
  try {
    const { reservations, orders } = servicos();
    const reserva = await reservations.create(undefined, {
      eventId: event.id,
      items: [{ ticketLotId: lot.id, quantity: 1 }],
    });
    const pedido = await orders.createFromReservation(undefined, {
      reservationId: reserva.id,
      contactEmail: "teste-integracao@example.com",
      purchaseProtection: true,
    });
    ids.push(pedido.id);
    const salvo = await prisma.order.findUniqueOrThrow({ where: { id: pedido.id } });
    assert.equal(salvo.protectionPurchased, false);
    assert.equal(salvo.protectionFeeCents, 0);
    await conferirPagoSemCobranca(pedido.id, organization.id, lot.id, 1);
  } finally {
    await limpar(organization.id, ids);
  }
});

test("ingresso pago continua indo para pagamento (sem regressão)", async () => {
  const { organization, event, lot } = await createFixtureEvent({ lotCapacity: 10, priceCents: 5000, feeCents: 500 });
  const ids: string[] = [];
  try {
    const { reservations, orders } = servicos();
    const reserva = await reservations.create(undefined, {
      eventId: event.id,
      items: [{ ticketLotId: lot.id, quantity: 1 }],
    });
    const pedido = await orders.createFromReservation(undefined, {
      reservationId: reserva.id,
      contactEmail: "teste-integracao@example.com",
    });
    ids.push(pedido.id);
    assert.equal(pedido.status, "PAYMENT_PENDING");
    assert.equal(pedido.totalCents, 5500);
    assert.ok(pedido.expiresAt, "pedido pago tem prazo para pagar");
    const lote = await prisma.ticketLot.findUniqueOrThrow({ where: { id: lot.id } });
    assert.equal(lote.soldCount, 0, "venda só confirma quando o pagamento aprovar");
    const emissao = await prisma.outboxEvent.count({ where: { aggregateId: pedido.id, eventType: "order.paid" } });
    assert.equal(emissao, 0);
  } finally {
    await limpar(organization.id, ids);
  }
});
