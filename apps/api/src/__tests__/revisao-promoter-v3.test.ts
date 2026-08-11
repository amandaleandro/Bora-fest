import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { IdempotencyService } from "../common/idempotency.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
const orgs = new OrganizationsService(new OrgAccessService());

async function dono(organizationId: string, roleId: string) {
  const user = await prisma.user.create({
    data: { email: `rv-${Math.random().toString(36).slice(2, 9)}@borafest.dev` },
  });
  await prisma.organizationMember.create({
    data: { organizationId, userId: user.id, roleId, status: "ACTIVE" },
  });
  return user;
}

async function comprar(eventId: string, lotId: string, qtd: number, promoterSlug?: string) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const payments = new PaymentsService(new IdempotencyService());
  const reservation = await reservations.create(undefined, {
    eventId,
    items: [{ ticketLotId: lotId, quantity: qtd }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: `c-${Math.random().toString(36).slice(2, 8)}@borafest.dev`,
    promoterSlug,
  } as never);
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");
  return { order, payment };
}

async function saldo(where: { organizationId?: string; userId?: string }) {
  const conta = await prisma.ledgerAccount.findFirst({ where });
  if (!conta) return 0;
  const r = await prisma.ledgerEntry.aggregate({
    where: { ledgerAccountId: conta.id },
    _sum: { amountCents: true },
  });
  return r._sum.amountCents ?? 0;
}

test("CRÍTICO: promoter vira produtor e DEPOIS vem o estorno — a casa recupera a comissão", async () => {
  const f = await createFixtureEvent({ lotCapacity: 20, priceCents: 10_000, feeCents: 0 });
  try {
    const casa = await dono(f.organization.id, f.ownerRoleId);
    const promoterUser = await prisma.user.create({
      data: { email: `pro-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });
    const link = await orgs.invitePromoter(f.organization.id, casa.id, {
      email: promoterUser.email!,
      commissionType: "PERCENT",
      commissionBps: 1000, // 10%
    });
    await orgs.respondPromoterInvite(link.id, promoterUser.id, true);

    const { payment } = await comprar(f.event.id, f.lot.id, 1, link.slug);
    assert.equal(await saldo({ userId: promoterUser.id }), 1_000, "comissão na carteira pessoal");

    // promoter completa o cadastro: a carteira migra para a organização dele
    const orgPromoter = await orgs.create(promoterUser.id, {
      name: `Prod ${Math.random().toString(36).slice(2, 7)}`,
      kind: "INDIVIDUAL",
      document: `${Math.floor(10000000000 + Math.random() * 8e10)}`,
      producerType: "INDEPENDENTE",
    } as never);
    const carteiraMigrou = await saldo({ organizationId: (orgPromoter as { id: string }).id });
    assert.equal(carteiraMigrou, 1_000, "carteira migrou com o saldo");

    // ESTORNO TOTAL depois da migração
    await applyGatewayStatus(payment.id, "REFUNDED");
    const casaDepois = await saldo({ organizationId: f.organization.id });
    const promoterDepois = await saldo({ organizationId: (orgPromoter as { id: string }).id });

    // era o bug: o promoter ficava com a comissão e a casa terminava NEGATIVA
    // exatamente nesse valor. Agora zera dos dois lados.
    assert.equal(promoterDepois, 0, "promoter devolve a comissão mesmo após migrar");
    assert.equal(casaDepois, 0, "casa zera — sem prejuízo da comissão");
  } finally {
    await cleanupFixtureEvent(f.organization.id);
  }
});

test("CRÍTICO: estornos parciais não passam do valor pago (teto acumulado)", async () => {
  const f = await createFixtureEvent({ lotCapacity: 10, priceCents: 10_000, feeCents: 0 });
  try {
    const casa = await dono(f.organization.id, f.ownerRoleId);
    const { order, payment } = await comprar(f.event.id, f.lot.id, 1);

    // 1º estorno de R$ 60 (de R$ 100) — passa
    await orders.refundOrder(order.id, casa.id, { amountCents: 6_000, reason: "teste" } as never);
    // 2º de R$ 50 — deve ser BARRADO (só restam R$ 40)
    await assert.rejects(
      () => orders.refundOrder(order.id, casa.id, { amountCents: 5_000, reason: "teste" } as never),
      /acima do disponível|já foi totalmente/,
    );
    const devolvido = await prisma.ledgerEntry.aggregate({
      where: { referenceType: "payment", referenceId: payment.id, type: "REFUND_DEBIT" },
      _sum: { amountCents: true },
    });
    assert.ok(
      Math.abs(devolvido._sum.amountCents ?? 0) <= payment.amountCents,
      "nunca devolve mais que o pago",
    );
  } finally {
    await cleanupFixtureEvent(f.organization.id);
  }
});

test("ALTA: estorno PARCIAL devolve comissão proporcional (casa não fica negativa)", async () => {
  const f = await createFixtureEvent({ lotCapacity: 10, priceCents: 10_000, feeCents: 0 });
  try {
    const casa = await dono(f.organization.id, f.ownerRoleId);
    const promoterUser = await prisma.user.create({
      data: { email: `pp-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });
    const link = await orgs.invitePromoter(f.organization.id, casa.id, {
      email: promoterUser.email!,
      commissionType: "PERCENT",
      commissionBps: 2000, // 20%
    });
    await orgs.respondPromoterInvite(link.id, promoterUser.id, true);

    const { order } = await comprar(f.event.id, f.lot.id, 1, link.slug);
    assert.equal(await saldo({ userId: promoterUser.id }), 2_000);

    // devolve METADE → comissão volta pela metade
    await orders.refundOrder(order.id, casa.id, { amountCents: 5_000, reason: "metade" } as never);
    assert.equal(await saldo({ userId: promoterUser.id }), 1_000, "comissão volta pro-rata");
  } finally {
    await cleanupFixtureEvent(f.organization.id);
  }
});

test("ALTA: comissão FIXA nunca passa do valor dos ingressos da venda", async () => {
  const f = await createFixtureEvent({ lotCapacity: 10, priceCents: 2_000, feeCents: 0 });
  try {
    const casa = await dono(f.organization.id, f.ownerRoleId);
    const promoterUser = await prisma.user.create({
      data: { email: `fx-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });
    // R$ 50 fixos por ingresso num ingresso de R$ 20 (contrato mal feito)
    const link = await orgs.invitePromoter(f.organization.id, casa.id, {
      email: promoterUser.email!,
      commissionType: "FIXED",
      commissionFixedCents: 5_000,
    });
    await orgs.respondPromoterInvite(link.id, promoterUser.id, true);

    const { order } = await comprar(f.event.id, f.lot.id, 1, link.slug);
    const pedido = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(pedido.promoterCommissionCents, 2_000, "comissão limitada ao valor do ingresso");
    assert.ok(await saldo({ organizationId: f.organization.id }) >= 0, "casa nunca fica negativa");
  } finally {
    await cleanupFixtureEvent(f.organization.id);
  }
});
