import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { OrganizationsService } from "../organizations/organizations.service";
import { OrgAccessService } from "../common/org-access.service";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { IdempotencyService } from "../common/idempotency.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

const orgs = new OrganizationsService(new OrgAccessService());

async function dono(organizationId: string, ownerRoleId: string) {
  const user = await prisma.user.create({
    data: { email: `pr-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
  });
  await prisma.organizationMember.create({
    data: { organizationId, userId: user.id, roleId: ownerRoleId, status: "ACTIVE" },
  });
  return user;
}

async function comprarComPromoter(eventId: string, lotId: string, promoterSlug?: string) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  const payments = new PaymentsService(new IdempotencyService());
  const reservation = await reservations.create(undefined, {
    eventId,
    items: [{ ticketLotId: lotId, quantity: 2 }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: `pr-buyer-${Math.random().toString(36).slice(2, 6)}@borafest.dev`,
    promoterSlug,
  } as never);
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");
  return { order, payment };
}

test("promoter v2 completo: busca → convite → aceite → venda pelo link → comissão na carteira → estorno devolve", async () => {
  const anfitria = await createFixtureEvent({ lotCapacity: 10, priceCents: 5000, feeCents: 0 });
  const promoter = await createFixtureEvent({ lotCapacity: 1, priceCents: 1000, feeCents: 0 });
  try {
    const donoAnfitria = await dono(anfitria.organization.id, anfitria.ownerRoleId);
    const donoPromoter = await dono(promoter.organization.id, promoter.ownerRoleId);

    // busca por nome e por documento exato (mascarado na resposta)
    const porNome = await orgs.searchOrganizations(donoAnfitria.id, promoter.organization.name.slice(0, 12));
    assert.ok(porNome.some((r) => r.id === promoter.organization.id), "acha por nome");
    const porDoc = await orgs.searchOrganizations(donoAnfitria.id, promoter.organization.document);
    assert.ok(porDoc.some((r) => r.id === promoter.organization.id), "acha por documento");
    assert.ok(porDoc[0].documentMasked.startsWith("***"), "documento volta mascarado");

    // convite com 10% e aceite pelo dono do promoter
    const link = await orgs.invitePromoter(anfitria.organization.id, donoAnfitria.id, {
      promoterOrgId: promoter.organization.id,
      commissionBps: 1000,
    });
    const convites = await orgs.listMyPromoterInvites(donoPromoter.id);
    assert.ok(convites.some((c) => c.id === link.id), "convite aparece para o promoter");
    await orgs.respondPromoterInvite(link.id, donoPromoter.id, true);

    // venda pelo link rastreável: 2× R$50 → comissão 10% = R$10
    const { order, payment } = await comprarComPromoter(
      anfitria.event.id,
      anfitria.lot.id,
      link.slug,
    );
    const pedido = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(pedido.promoterLinkId, link.id);
    assert.equal(pedido.promoterCommissionCents, 1000);

    // split no caixa: débito na anfitriã, crédito na carteira do promoter
    const contaPromoter = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { organizationId: promoter.organization.id },
    });
    const credito = await prisma.ledgerEntry.findFirstOrThrow({
      where: { ledgerAccountId: contaPromoter.id, type: "COMMISSION_CREDIT", referenceId: payment.id },
    });
    assert.equal(credito.amountCents, 1000);
    assert.ok(credito.availableAt > new Date(), "comissão amadurece D+2 pós-evento, não antes");
    const contaAnfitria = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { organizationId: anfitria.organization.id },
    });
    const debito = await prisma.ledgerEntry.findFirstOrThrow({
      where: { ledgerAccountId: contaAnfitria.id, type: "COMMISSION_DEBIT", referenceId: payment.id },
    });
    assert.equal(debito.amountCents, -1000);

    // painel do promoter mostra a venda e a comissão
    const engajamentos = await orgs.listMyPromoterEngagements(donoPromoter.id);
    const meu = engajamentos.find((e) => e.id === link.id);
    assert.equal(meu?.paidOrders, 1);
    assert.equal(meu?.commissionCents, 1000);

    // estorno total devolve a comissão (clawback idempotente)
    await applyGatewayStatus(payment.id, "REFUNDED");
    const saldoPromoter = await prisma.ledgerEntry.aggregate({
      where: { ledgerAccountId: contaPromoter.id },
      _sum: { amountCents: true },
    });
    assert.equal(saldoPromoter._sum.amountCents, 0, "estorno zera a comissão do promoter");
  } finally {
    await prisma.promoterLink.deleteMany({
      where: { organizationId: anfitria.organization.id },
    });
    await cleanupFixtureEvent(anfitria.organization.id);
    await cleanupFixtureEvent(promoter.organization.id);
  }
});

test("promoter só-contabiliza: vendas contam, dinheiro não aparece nem circula", async () => {
  const anfitria = await createFixtureEvent({ lotCapacity: 10, priceCents: 5000, feeCents: 0 });
  const promoter = await createFixtureEvent({ lotCapacity: 1, priceCents: 1000, feeCents: 0 });
  try {
    const donoAnfitria = await dono(anfitria.organization.id, anfitria.ownerRoleId);
    const donoPromoter = await dono(promoter.organization.id, promoter.ownerRoleId);
    const link = await orgs.invitePromoter(anfitria.organization.id, donoAnfitria.id, {
      promoterOrgId: promoter.organization.id,
      commissionBps: 0,
    });
    await orgs.respondPromoterInvite(link.id, donoPromoter.id, true);

    const { order, payment } = await comprarComPromoter(
      anfitria.event.id,
      anfitria.lot.id,
      link.slug,
    );
    const pedido = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(pedido.promoterLinkId, link.id, "venda atribuída mesmo sem comissão");
    assert.equal(pedido.promoterCommissionCents, 0);

    const comissoes = await prisma.ledgerEntry.count({
      where: { referenceId: payment.id, type: { in: ["COMMISSION_CREDIT", "COMMISSION_DEBIT"] } },
    });
    assert.equal(comissoes, 0, "sem comissão não há lançamento no caixa");

    // o payload do promoter NÃO menciona dinheiro (a UI nunca diz "você não recebe")
    const engajamentos = await orgs.listMyPromoterEngagements(donoPromoter.id);
    const meu = engajamentos.find((e) => e.id === link.id);
    assert.equal(meu?.paidOrders, 1);
    assert.ok(!("commissionBps" in (meu ?? {})), "payload sem campos de dinheiro");
  } finally {
    await prisma.promoterLink.deleteMany({
      where: { organizationId: anfitria.organization.id },
    });
    await cleanupFixtureEvent(anfitria.organization.id);
    await cleanupFixtureEvent(promoter.organization.id);
  }
});
