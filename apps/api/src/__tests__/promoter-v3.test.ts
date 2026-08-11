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

async function donoDaCasa(fixture: Awaited<ReturnType<typeof createFixtureEvent>>) {
  const user = await prisma.user.create({
    data: { email: `casa-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
  });
  await prisma.organizationMember.create({
    data: {
      organizationId: fixture.organization.id,
      userId: user.id,
      roleId: fixture.ownerRoleId,
      status: "ACTIVE",
    },
  });
  return user;
}

/** compra atribuída por link de promoter (?pr=) ou de vendedor (?vd=) */
async function comprar(
  eventId: string,
  lotId: string,
  quantity: number,
  attrib: { promoterSlug?: string; sellerSlug?: string },
) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  const payments = new PaymentsService(new IdempotencyService());
  const reservation = await reservations.create(undefined, {
    eventId,
    items: [{ ticketLotId: lotId, quantity }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: `c-${Math.random().toString(36).slice(2, 8)}@borafest.dev`,
    ...attrib,
  } as never);
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");
  return { order: await prisma.order.findUniqueOrThrow({ where: { id: order.id } }), payment };
}

async function limpar(fixture: Awaited<ReturnType<typeof createFixtureEvent>>, emails: string[]) {
  await prisma.promoterLink.deleteMany({ where: { organizationId: fixture.organization.id } });
  await cleanupFixtureEvent(fixture.organization.id);
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
}

test("SEM comissão: vendas contam para promoter e vendedor, mas o dinheiro fica TODO com a casa", async () => {
  const f = await createFixtureEvent({ lotCapacity: 20, priceCents: 10_000, feeCents: 0 });
  const emailPromoter = `atletica-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  const emailVendedor = `vend-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  try {
    const casa = await donoDaCasa(f);

    // casa convida a atlética SEM comissão (só contabiliza) — conta simples criada na hora
    const link = await orgs.invitePromoter(f.organization.id, casa.id, {
      email: emailPromoter,
      commissionType: "NONE",
    });
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: emailPromoter } });
    assert.equal(promoter.passwordHash, null, "promoter é conta simples — sem senha, sem produtor");
    await orgs.respondPromoterInvite(link.id, promoter.id, true);

    // atlética convida seu vendedor
    const vendedor = await orgs.inviteSeller(link.id, promoter.id, { email: emailVendedor });
    const vendedorUser = await prisma.user.findUniqueOrThrow({ where: { email: emailVendedor } });
    await orgs.respondSellerInvite(vendedor.id, vendedorUser.id, true);

    // venda pelo link do VENDEDOR (2 ingressos = R$ 200)
    const { order, payment } = await comprar(f.event.id, f.lot.id, 2, { sellerSlug: vendedor.slug });
    assert.equal(order.promoterLinkId, link.id, "vendedor implica o promoter dele");
    assert.equal(order.promoterSellerId, vendedor.id);
    assert.equal(order.promoterCommissionCents, 0, "sem comissão definida = zero");

    // NENHUM lançamento de comissão: o dinheiro é todo da casa
    const comissoes = await prisma.ledgerEntry.count({
      where: { referenceId: payment.id, type: { in: ["COMMISSION_CREDIT", "COMMISSION_DEBIT"] } },
    });
    assert.equal(comissoes, 0, "sem comissão, nada sai do caixa da casa");
    const contaCasa = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { organizationId: f.organization.id },
    });
    const saldoCasa = await prisma.ledgerEntry.aggregate({
      where: { ledgerAccountId: contaCasa.id },
      _sum: { amountCents: true },
    });
    assert.equal(saldoCasa._sum.amountCents, 20_000, "casa fica com os R$ 200 (taxa zero na fixture)");
    const carteiraPromoter = await prisma.ledgerAccount.findUnique({ where: { userId: promoter.id } });
    assert.equal(carteiraPromoter, null, "promoter sem comissão nem tem carteira");

    // mas a CONTABILIZAÇÃO existe em cascata
    const doVendedor = await orgs.listMySellerEngagements(vendedorUser.id);
    assert.equal(doVendedor[0].paidOrders, 1);
    assert.equal(doVendedor[0].soldCents, 20_000, "vendedor vê quanto vendeu");
    const doPromoter = await orgs.listSellersOfPromoter(link.id, promoter.id);
    assert.equal(doPromoter[0].soldCents, 20_000, "promoter vê por vendedor");
    const daCasa = await orgs.listPromoters(f.organization.id, casa.id);
    assert.equal(daCasa[0].soldCents, 20_000, "casa vê por promoter");
    assert.equal(daCasa[0].sellers, 1);
  } finally {
    await limpar(f, [emailPromoter, emailVendedor]);
  }
});

test("comissão FIXA por ingresso: split cai na carteira do PROMOTER (vendedor nunca recebe)", async () => {
  const f = await createFixtureEvent({ lotCapacity: 20, priceCents: 10_000, feeCents: 0 });
  const emailPromoter = `p-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  const emailVendedor = `v-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  try {
    const casa = await donoDaCasa(f);
    // R$ 5 por ingresso
    const link = await orgs.invitePromoter(f.organization.id, casa.id, {
      email: emailPromoter,
      commissionType: "FIXED",
      commissionFixedCents: 500,
    });
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: emailPromoter } });
    await orgs.respondPromoterInvite(link.id, promoter.id, true);
    const vendedor = await orgs.inviteSeller(link.id, promoter.id, { email: emailVendedor });
    const vendedorUser = await prisma.user.findUniqueOrThrow({ where: { email: emailVendedor } });
    await orgs.respondSellerInvite(vendedor.id, vendedorUser.id, true);

    // 3 ingressos → 3 × R$ 5 = R$ 15 de comissão
    const { order, payment } = await comprar(f.event.id, f.lot.id, 3, { sellerSlug: vendedor.slug });
    assert.equal(order.promoterCommissionCents, 1500, "fixa = valor × ingressos");

    const carteiraPromoter = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { userId: promoter.id },
    });
    const credito = await prisma.ledgerEntry.findFirstOrThrow({
      where: { ledgerAccountId: carteiraPromoter.id, type: "COMMISSION_CREDIT", referenceId: payment.id },
    });
    assert.equal(credito.amountCents, 1500, "comissão na carteira do PROMOTER (pessoa)");
    assert.ok(credito.availableAt > new Date(), "matura D+2 pós-evento, como a venda");

    const carteiraVendedor = await prisma.ledgerAccount.findUnique({ where: { userId: vendedorUser.id } });
    assert.equal(carteiraVendedor, null, "VENDEDOR nunca recebe pela plataforma");

    // casa: crédito da venda menos a comissão
    const contaCasa = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { organizationId: f.organization.id },
    });
    const saldoCasa = await prisma.ledgerEntry.aggregate({
      where: { ledgerAccountId: contaCasa.id },
      _sum: { amountCents: true },
    });
    assert.equal(saldoCasa._sum.amountCents, 30_000 - 1500, "casa fica com o resto");

    // estorno devolve a comissão
    await applyGatewayStatus(payment.id, "REFUNDED");
    const saldoPromoter = await prisma.ledgerEntry.aggregate({
      where: { ledgerAccountId: carteiraPromoter.id },
      _sum: { amountCents: true },
    });
    assert.equal(saldoPromoter._sum.amountCents, 0, "estorno zera a comissão do promoter");
  } finally {
    await limpar(f, [emailPromoter, emailVendedor]);
  }
});

test("comissão PERCENTUAL e link do promoter direto (sem vendedor)", async () => {
  const f = await createFixtureEvent({ lotCapacity: 20, priceCents: 10_000, feeCents: 0 });
  const emailPromoter = `pc-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  try {
    const casa = await donoDaCasa(f);
    const link = await orgs.invitePromoter(f.organization.id, casa.id, {
      email: emailPromoter,
      commissionType: "PERCENT",
      commissionBps: 1000, // 10%
    });
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: emailPromoter } });
    await orgs.respondPromoterInvite(link.id, promoter.id, true);

    const { order, payment } = await comprar(f.event.id, f.lot.id, 2, { promoterSlug: link.slug });
    assert.equal(order.promoterCommissionCents, 2000, "10% de R$ 200");
    assert.equal(order.promoterSellerId, null, "sem vendedor nesta venda");

    const carteira = await prisma.ledgerAccount.findUniqueOrThrow({ where: { userId: promoter.id } });
    const credito = await prisma.ledgerEntry.findFirstOrThrow({
      where: { ledgerAccountId: carteira.id, type: "COMMISSION_CREDIT", referenceId: payment.id },
    });
    assert.equal(credito.amountCents, 2000);
  } finally {
    await limpar(f, [emailPromoter]);
  }
});

test("segurança: convite é da PESSOA convidada; ninguém aceita no lugar dela", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  const emailPromoter = `s-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  const emailIntruso = `i-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  try {
    const casa = await donoDaCasa(f);
    const link = await orgs.invitePromoter(f.organization.id, casa.id, {
      email: emailPromoter,
      commissionType: "PERCENT",
      commissionBps: 1000,
    });
    const intruso = await prisma.user.create({ data: { email: emailIntruso } });
    await assert.rejects(
      () => orgs.respondPromoterInvite(link.id, intruso.id, true),
      /não é seu/,
    );
    // e o intruso não enxerga o convite alheio
    const convitesDoIntruso = await orgs.listMyPromoterInvites(intruso.id);
    assert.equal(convitesDoIntruso.length, 0);
  } finally {
    await limpar(f, [emailPromoter, emailIntruso]);
  }
});

test("a mesma conta cresce: comissão do promoter migra para a organização ao completar o cadastro", async () => {
  const f = await createFixtureEvent({ lotCapacity: 20, priceCents: 10_000, feeCents: 0 });
  const emailPromoter = `mig-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  try {
    const casa = await donoDaCasa(f);
    const link = await orgs.invitePromoter(f.organization.id, casa.id, {
      email: emailPromoter,
      commissionType: "FIXED",
      commissionFixedCents: 1000,
    });
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: emailPromoter } });
    await orgs.respondPromoterInvite(link.id, promoter.id, true);
    await comprar(f.event.id, f.lot.id, 2, { promoterSlug: link.slug }); // R$ 20 de comissão

    // carteira de PESSOA com saldo, ainda sem poder sacar
    const carteira = await orgs.getMyWallet(promoter.id);
    assert.equal(carteira.balanceCents, 2000);
    assert.equal(carteira.needsProducerAccount, true);

    // completa o cadastro → vira produtor
    const novaOrg = await orgs.create(promoter.id, {
      name: `Atletica do ${promoter.id.slice(0, 6)}`,
      kind: "COMPANY",
      document: `${Date.now()}`.slice(0, 14),
      producerType: "ATLETICA",
    } as never);

    // a carteira (com saldo e datas) virou da organização
    const carteiraPessoal = await prisma.ledgerAccount.findUnique({ where: { userId: promoter.id } });
    assert.equal(carteiraPessoal, null, "não sobra carteira de pessoa");
    const carteiraOrg = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { organizationId: (novaOrg as { id: string }).id },
    });
    const saldo = await prisma.ledgerEntry.aggregate({
      where: { ledgerAccountId: carteiraOrg.id },
      _sum: { amountCents: true },
    });
    assert.equal(saldo._sum.amountCents, 2000, "comissão acumulada foi junto");

    await prisma.organization.delete({ where: { id: (novaOrg as { id: string }).id } });
  } finally {
    await limpar(f, [emailPromoter]);
  }
});
