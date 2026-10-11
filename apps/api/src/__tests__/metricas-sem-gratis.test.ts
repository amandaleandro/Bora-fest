import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { DashboardService } from "../dashboard/dashboard.service";
import { PromoterPerformanceService } from "../promoter-performance/promoter-performance.service";
import { GuestListService } from "../guest-list/guest-list.service";
import { ReservationsService } from "../reservations/reservations.service";
import { OrdersService } from "../orders/orders.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Relatórios sem grátis (2026-10-11). "Por vendedor" e a "Competição
// atléticas/parceiros" contavam convidado da lista e pedido de R$ 0 como venda;
// o relatório de promoter (regra de 15/09: "lista não é venda") não. A mesma
// pessoa aparecia com números opostos em duas telas, e a atlética subia na
// competição enchendo a lista. Primeiro teste dessas duas rotas.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);

/** CPF válido aleatório: a lista exige CPF e cada execução usa um novo. */
function geraCpf(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (base: number[]) => {
    const soma = base.reduce((acc, d, i) => acc + d * (base.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  const d2 = dv([...n, d1]);
  return [...n, d1, d2].join("");
}

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 5000, feeCents: 0 });
  const dono = await prisma.user.create({ data: { email: `dono-${rand()}@borafest.dev`, name: "Produção" } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  const acesso = new OrgAccessService();
  return {
    fx,
    dono,
    dashboard: new DashboardService(acesso),
    performance: new PromoterPerformanceService(acesso),
    lista: new GuestListService(acesso, new InventoryService()),
    reservations: new ReservationsService(new InventoryService(), new WaitingRoomService()),
    orders: new OrdersService(new CouponsService(acesso), acesso),
    usuarios: [dono.id],
    emails: [] as string[],
  };
}
type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx) {
  const orgId = ctx.fx.organization.id;
  const pedidos = await prisma.order.findMany({ where: { eventId: ctx.fx.event.id }, select: { id: true } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: pedidos.map((p) => p.id) } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
  await prisma.promoterLink.deleteMany({ where: { organizationId: orgId } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
  await cleanupFixtureEvent(orgId);
  await prisma.salesPartner.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { email: { in: ctx.emails } } }).catch(() => undefined);
  for (const id of ctx.usuarios) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

/** Atlética ligada ao evento (a lista só aceita parceiro vinculado). */
async function atletica(ctx: Ctx, nome: string) {
  const parceiro = await prisma.salesPartner.create({
    data: {
      organizationId: ctx.fx.organization.id,
      name: `${nome} ${rand()}`,
      slug: `atletica-${rand()}`,
      commissionBps: 1000,
    },
  });
  await prisma.eventSalesPartner.create({ data: { eventId: ctx.fx.event.id, partnerId: parceiro.id } });
  return parceiro;
}

async function loteGratis(ctx: Ctx) {
  return prisma.ticketLot.create({
    data: {
      ticketTypeId: ctx.fx.ticketType.id,
      name: `Grátis ${rand()}`,
      priceCents: 0,
      feeCents: 0,
      capacity: 20,
      status: "ACTIVE",
    },
  });
}

/** Pedido gravado direto, como fica depois que o pagamento (ou o estorno) já aconteceu. */
async function pedidoDireto(
  ctx: Ctx,
  input: {
    status: "PAID" | "REFUNDED";
    ticketLotId: string;
    quantidade: number;
    totalCents: number;
    soldByUserId?: string;
    salesPartnerId?: string;
    partnerCommissionCents?: number;
    promoterLinkId?: string;
  },
) {
  const reserva = await prisma.reservation.create({
    data: { eventId: ctx.fx.event.id, status: "CONVERTED", expiresAt: new Date(Date.now() + 60_000) },
  });
  const pedido = await prisma.order.create({
    data: {
      eventId: ctx.fx.event.id,
      reservationId: reserva.id,
      contactEmail: `comprador-${rand()}@example.com`,
      status: input.status,
      totalCents: input.totalCents,
      soldByUserId: input.soldByUserId,
      salesPartnerId: input.salesPartnerId,
      partnerCommissionCents: input.partnerCommissionCents ?? 0,
      promoterLinkId: input.promoterLinkId,
      paidAt: new Date(),
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: pedido.id,
      ticketLotId: input.ticketLotId,
      quantity: input.quantidade,
      priceCents: input.quantidade > 0 ? Math.floor(input.totalCents / input.quantidade) : 0,
      feeCents: 0,
    },
  });
  return pedido;
}

/**
 * Emite os ingressos do pedido como o worker faria (issue-tickets.ts). Sem
 * isso o ranking não teria o que contar: ele soma ingresso emitido, e o grátis
 * só "inflava" a competição depois de emitido.
 */
async function emitir(orderId: string, status: "ACTIVE" | "CHECKED_IN" = "ACTIVE") {
  const pedido = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { eventId: true, items: { select: { id: true, ticketLotId: true, quantity: true } } },
  });
  for (const item of pedido.items) {
    for (let seq = 1; seq <= item.quantity; seq += 1) {
      await prisma.ticket.create({
        data: {
          orderId,
          orderItemId: item.id,
          eventId: pedido.eventId,
          ticketLotId: item.ticketLotId,
          seq,
          code: `MSG-${rand()}${seq}`,
          qrToken: `tok-msg-${rand()}-${seq}`,
          status,
          checkedInAt: status === "CHECKED_IN" ? new Date() : undefined,
        },
      });
    }
  }
}

/**
 * Cenário das duas telas:
 *  - Atlética Forte: o vendedor dela fez 1 venda paga (2 ingressos, R$ 100,
 *    R$ 10 de comissão) e 1 venda paga estornada; também cadastrou 2
 *    convidados em nome dela e cancelou 1 por erro de digitação.
 *  - Atlética Lista: só tem convidado cadastrado pela produção e lote grátis
 *    resgatado pelo link dela (?p=).
 */
async function cenario(ctx: Ctx) {
  const forte = await atletica(ctx, "Atlética Forte");
  const lotada = await atletica(ctx, "Atlética Lista");

  // vendedor de atlética: tem SALES_PERFORM, então cadastra convidado sem cota
  const sellerRole = await prisma.role.findUniqueOrThrow({ where: { key: "seller" } });
  const vendedor = await prisma.user.create({
    data: { email: `vendedor-${rand()}@borafest.dev`, name: "Vendedor da Forte" },
  });
  ctx.usuarios.push(vendedor.id);
  await prisma.organizationMember.create({
    data: {
      organizationId: ctx.fx.organization.id,
      userId: vendedor.id,
      roleId: sellerRole.id,
      salesPartnerId: forte.id,
      status: "ACTIVE",
    },
  });

  const pago = await pedidoDireto(ctx, {
    status: "PAID",
    ticketLotId: ctx.fx.lot.id,
    quantidade: 2,
    totalCents: 10_000,
    soldByUserId: vendedor.id,
    salesPartnerId: forte.id,
    partnerCommissionCents: 1_000,
  });
  await emitir(pago.id);
  await pedidoDireto(ctx, {
    status: "REFUNDED",
    ticketLotId: ctx.fx.lot.id,
    quantidade: 1,
    totalCents: 5_000,
    soldByUserId: vendedor.id,
    salesPartnerId: forte.id,
    partnerCommissionCents: 500,
  });

  // convidados que o próprio vendedor lança na atlética dele
  for (let i = 0; i < 2; i += 1) {
    const entrada = await ctx.lista.create(vendedor.id, ctx.fx.event.id, {
      ticketLotId: ctx.fx.lot.id,
      guestName: `Convidado Forte ${i}`,
      guestDocument: geraCpf(),
      salesPartnerId: forte.id,
    });
    await emitir(entrada.orderId!);
  }
  const digitadoErrado = await ctx.lista.create(vendedor.id, ctx.fx.event.id, {
    ticketLotId: ctx.fx.lot.id,
    guestName: "Nome Errado",
    guestDocument: geraCpf(),
    salesPartnerId: forte.id,
  });
  await ctx.lista.cancel(vendedor.id, ctx.fx.event.id, digitadoErrado.id);

  // convidados que a produção lança em nome da outra atlética
  for (let i = 0; i < 3; i += 1) {
    const entrada = await ctx.lista.create(ctx.dono.id, ctx.fx.event.id, {
      ticketLotId: ctx.fx.lot.id,
      guestName: `Convidado Lista ${i}`,
      guestDocument: geraCpf(),
      salesPartnerId: lotada.id,
    });
    await emitir(entrada.orderId!);
  }

  // lote grátis resgatado no site pelo link da atlética (?p=)
  const gratis = await loteGratis(ctx);
  const reserva = await ctx.reservations.create(undefined, {
    eventId: ctx.fx.event.id,
    items: [{ ticketLotId: gratis.id, quantity: 2 }],
  });
  const email = `gratis-${rand()}@example.com`;
  ctx.emails.push(email);
  const resgate = await ctx.orders.createFromReservation(undefined, {
    reservationId: reserva.id,
    contactEmail: email,
    partnerSlug: lotada.slug,
    consent: { version: "v2026-07", terms: true, privacy: true },
  });
  // o cenário é real: o grátis nasce pago e com a atlética no pedido
  assert.equal(resgate.status, "PAID");
  assert.equal(resgate.totalCents, 0);
  assert.equal(resgate.salesPartnerId, lotada.id);
  await emitir(resgate.id);

  return { forte, lotada, vendedor };
}

test("competição de atléticas: convidado da lista e grátis pelo link não somam; venda paga soma", async () => {
  const ctx = await montar();
  try {
    const { forte, lotada } = await cenario(ctx);

    const competicao = await ctx.dashboard.listSalesByPartner(ctx.fx.event.id, ctx.dono.id);

    assert.equal(
      competicao.find((l) => l.partnerId === lotada.id),
      undefined,
      "atlética só com convidados e grátis não tem venda — não entra na competição",
    );
    assert.equal(competicao.length, 1);
    const linha = competicao[0];
    assert.equal(linha?.partnerId, forte.id);
    assert.equal(linha?.ticketsSold, 2, "só os 2 ingressos pagos contam ponto, não os convidados");
    assert.equal(linha?.ordersOk, 1);
    assert.equal(linha?.ordersFailed, 1, "a venda paga estornada falhou; o convidado cancelado não");
    assert.equal(linha?.revenueCents, 10_000);
    assert.equal(linha?.commissionCents, 1_000);
  } finally {
    await desmontar(ctx);
  }
});

test("por vendedor: convidado da lista não soma; quem só cadastrou convidado não aparece", async () => {
  const ctx = await montar();
  try {
    const { forte, vendedor } = await cenario(ctx);

    const porVendedor = await ctx.dashboard.listSalesBySeller(ctx.fx.event.id, ctx.dono.id);

    assert.equal(
      porVendedor.find((l) => l.sellerId === ctx.dono.id),
      undefined,
      "a produção só cadastrou convidados — não é vendedor",
    );
    assert.equal(porVendedor.length, 1);
    const linha = porVendedor[0];
    assert.equal(linha?.sellerId, vendedor.id);
    assert.equal(linha?.partnerId, forte.id);
    assert.equal(linha?.ordersOk, 1, "os convidados que ele lançou não viram venda que deu certo");
    assert.equal(linha?.ticketsSold, 2);
    assert.equal(linha?.ordersFailed, 1, "o convidado cancelado não vira venda que falhou");
    assert.equal(linha?.revenueCents, 10_000);
    assert.equal(linha?.commissionCents, 1_000);
  } finally {
    await desmontar(ctx);
  }
});

test("promoter: 'vendidos que entraram' não conta o grátis do link dele", async () => {
  const ctx = await montar();
  try {
    const promoter = await prisma.user.create({
      data: { email: `promoter-${rand()}@borafest.dev`, name: "Promoter do Grátis" },
    });
    ctx.usuarios.push(promoter.id);
    const link = await prisma.promoterLink.create({
      data: {
        organizationId: ctx.fx.organization.id,
        promoterUserId: promoter.id,
        status: "ACTIVE",
        commissionType: "NONE",
        slug: `pr-${rand()}`,
      },
    });

    // 1 ingresso pago que entrou + 1 do lote grátis exclusivo dele que entrou
    const pago = await pedidoDireto(ctx, {
      status: "PAID",
      ticketLotId: ctx.fx.lot.id,
      quantidade: 1,
      totalCents: 5_000,
      promoterLinkId: link.id,
    });
    await emitir(pago.id, "CHECKED_IN");
    const gratis = await loteGratis(ctx);
    const doLinkGratis = await pedidoDireto(ctx, {
      status: "PAID",
      ticketLotId: gratis.id,
      quantidade: 1,
      totalCents: 0,
      promoterLinkId: link.id,
    });
    await emitir(doLinkGratis.id, "CHECKED_IN");

    const relatorio = await ctx.performance.forEvent(ctx.fx.organization.id, ctx.fx.event.id, ctx.dono.id);
    const linha = relatorio.promoters.find((p) => p.id === link.id);
    assert.ok(linha, "o promoter aparece no relatório");
    assert.equal(linha?.ticketsSold, 1);
    assert.equal(linha?.paidOrders, 1);
    assert.equal(linha?.grossCents, 5_000);
    assert.equal(
      linha?.soldCheckedIn,
      1,
      "vendidos que entraram usa a mesma base de vendidos — nunca passa dele",
    );
    assert.equal(linha?.guestsRegistered, 0);
    assert.equal(linha?.guestsCheckedIn, 0, "grátis fora da lista também não é convidado");
    assert.equal(relatorio.summary.soldCheckedIn, 1);
  } finally {
    await desmontar(ctx);
  }
});
