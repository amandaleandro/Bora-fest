import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, type OrderStatus } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { DashboardService } from "../dashboard/dashboard.service";
import { PromoterPerformanceService } from "../promoter-performance/promoter-performance.service";
import { ReservationsService } from "../reservations/reservations.service";
import { OrdersService } from "../orders/orders.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { cancelarPedidoGratis } from "../common/cancelar-pedido-gratis";
import { baldeDoPedido } from "../common/conta-como-venda";
import {
  CABECALHO_MEIA,
  SITUACAO_SEM_INGRESSO,
  canalDoPedido,
  linhasDaMeia,
  quantidadeDeMeia,
  textoSeguroParaPlanilha,
  type ItemDeMeia,
} from "../dashboard/relatorio-meia";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// RELATÓRIOS (2026-10-12), aba "Relatórios" do protótipo aprovado.
//  (1) Meia-entrada (Decreto 8.537/2015): o dado já era gravado em cada item do
//      pedido, mas nenhum relatório o mostrava — só o fechamento do PDV. Agora
//      os CSVs de pedidos e participantes têm a coluna "meia" e existe o CSV de
//      meia-entrada, um ingresso por linha.
//  (2) Promoter: quem divulgou evento grátis aparecia com zero. A coluna
//      "Grátis" (pegaram / entraram) separa o R$ 0 fora da lista sem mexer em
//      venda nem em lista.
// Toda garantia provada no banco, pela rota de verdade.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);

/** CSV dos exports: cabeçalho sem aspas, células entre aspas com "" dentro. */
function lerCsv(csv: string): string[][] {
  return csv
    .split("\n")
    .map((linha) => [...linha.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map((m) => (m[1] ?? m[2] ?? "").replace(/""/g, '"')));
}

// ---- regra pura ---------------------------------------------------------------

test("baldes: com valor é venda; R$ 0 da lista é lista; R$ 0 fora da lista é grátis", () => {
  assert.equal(baldeDoPedido({ totalCents: 5000, daLista: false }), "venda");
  assert.equal(baldeDoPedido({ totalCents: 0, daLista: true }), "lista");
  assert.equal(baldeDoPedido({ totalCents: 0, daLista: false }), "gratis");
});

test("canal: pedido com vendedor é porta; sem vendedor é site", () => {
  assert.equal(canalDoPedido({ soldByUserId: "algum-vendedor" }), "porta");
  assert.equal(canalDoPedido({ soldByUserId: null }), "site");
});

test("planilha: nome que começa com = + - @ não vira fórmula; o resto passa igual", () => {
  assert.equal(textoSeguroParaPlanilha('=HYPERLINK("x")'), `'=HYPERLINK("x")`);
  assert.equal(textoSeguroParaPlanilha("+5534"), "'+5534");
  assert.equal(textoSeguroParaPlanilha("-Ana"), "'-Ana");
  assert.equal(textoSeguroParaPlanilha("@ana"), "'@ana");
  assert.equal(textoSeguroParaPlanilha("Ana Souza"), "Ana Souza");
  assert.equal(textoSeguroParaPlanilha(""), "");
});

test("meia do pedido: soma só os itens de meia", () => {
  assert.equal(
    quantidadeDeMeia([
      { quantity: 1, halfPrice: false },
      { quantity: 2, halfPrice: true },
      { quantity: 3, halfPrice: true },
    ]),
    5,
  );
  assert.equal(quantidadeDeMeia([{ quantity: 4, halfPrice: false }]), 0);
});

test("linhas da meia: emitido sai com código; pago sem ingresso aparece; não pago não entra", () => {
  const quando = new Date("2026-10-10T22:00:00.000Z");
  const lote = { name: "1º lote", ticketType: { name: "Pista" } };
  const pedido = (extra: Partial<ItemDeMeia["order"]>): ItemDeMeia["order"] => ({
    publicToken: "p",
    status: "FULFILLED",
    createdAt: quando,
    paidAt: quando,
    contactName: "Comprador",
    soldByUserId: null,
    ...extra,
  });
  const linhas = linhasDaMeia([
    {
      quantity: 2,
      ticketLot: lote,
      order: pedido({ publicToken: "p1" }),
      tickets: [
        { code: "A1", status: "CHECKED_IN", attendeeName: "Maria" },
        { code: "A2", status: "ACTIVE", attendeeName: null },
      ],
    },
    {
      quantity: 2,
      ticketLot: lote,
      order: pedido({ publicToken: "p2", status: "PAID", soldByUserId: "vendedor", contactName: "=1+1" }),
      tickets: [{ code: "B1", status: "ACTIVE", attendeeName: null }],
    },
    {
      quantity: 1,
      ticketLot: lote,
      order: pedido({ publicToken: "p3", status: "PAYMENT_PENDING", paidAt: null }),
      tickets: [],
    },
  ]);

  assert.equal(linhas.length, 4, "2 emitidos + 1 emitido + 1 pago sem ingresso; o pendente fica fora");
  assert.deepEqual(linhas[0], [quando.toISOString(), "Pista", "1º lote", "Maria", "A1", "site", "usado na entrada", "p1"]);
  assert.equal(linhas[1]?.[3], "Comprador", "sem nome no ingresso, vale o nome do pedido");
  assert.equal(linhas[1]?.[6], "válido");
  assert.deepEqual(linhas[3], [quando.toISOString(), "Pista", "1º lote", "'=1+1", "", "porta", SITUACAO_SEM_INGRESSO, "p2"]);
});

// ---- meia-entrada contra o banco ----------------------------------------------

async function montarMeia() {
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 4000, feeCents: 0 });
  await prisma.ticketLot.update({ where: { id: fx.lot.id }, data: { halfPriceEnabled: true } });
  const dono = await prisma.user.create({ data: { email: `dono-meia-${rand()}@borafest.dev`, name: "Produção" } });
  const vendedor = await prisma.user.create({ data: { email: `vend-meia-${rand()}@borafest.dev`, name: "Vendedor" } });
  const sellerRole = await prisma.role.findUniqueOrThrow({ where: { key: "seller" } });
  await prisma.organizationMember.createMany({
    data: [
      { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
      { organizationId: fx.organization.id, userId: vendedor.id, roleId: sellerRole.id, status: "ACTIVE" },
    ],
  });
  return { fx, dono, vendedor, dashboard: new DashboardService(new OrgAccessService()) };
}
type CtxMeia = Awaited<ReturnType<typeof montarMeia>>;

async function desmontarMeia(ctx: CtxMeia) {
  const orgId = ctx.fx.organization.id;
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
  await cleanupFixtureEvent(orgId);
  for (const id of [ctx.dono.id, ctx.vendedor.id]) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

/** Pedido gravado como fica depois de pago (ou não), com itens de inteira e de meia. */
async function pedidoComItens(
  ctx: CtxMeia,
  input: {
    status: OrderStatus;
    contactName: string;
    soldByUserId?: string;
    itens: Array<{ quantidade: number; meia: boolean }>;
  },
) {
  const reserva = await prisma.reservation.create({
    data: { eventId: ctx.fx.event.id, status: "CONVERTED", expiresAt: new Date(Date.now() + 60_000) },
  });
  const pedido = await prisma.order.create({
    data: {
      eventId: ctx.fx.event.id,
      reservationId: reserva.id,
      contactName: input.contactName,
      contactEmail: `comprador-${rand()}@example.com`,
      status: input.status,
      totalCents: input.itens.reduce((soma, i) => soma + i.quantidade * (i.meia ? 2000 : 4000), 0),
      soldByUserId: input.soldByUserId,
      paidAt: input.status === "PAYMENT_PENDING" ? null : new Date(),
    },
  });
  const itens = [];
  for (const i of input.itens) {
    itens.push(
      await prisma.orderItem.create({
        data: {
          orderId: pedido.id,
          ticketLotId: ctx.fx.lot.id,
          quantity: i.quantidade,
          priceCents: i.meia ? 2000 : 4000,
          feeCents: 0,
          halfPrice: i.meia,
        },
      }),
    );
  }
  return { pedido, itens };
}

/** Emite os ingressos de um item como o worker faria, cada um com a situação pedida. */
async function emitirItem(
  ctx: CtxMeia,
  pedidoId: string,
  itemId: string,
  ingressos: Array<{ status: "ACTIVE" | "CHECKED_IN" | "REFUNDED"; nome?: string }>,
) {
  const codigos: string[] = [];
  for (let seq = 1; seq <= ingressos.length; seq += 1) {
    const ingresso = ingressos[seq - 1]!;
    const code = `MEIA-${rand()}-${seq}`.toUpperCase();
    await prisma.ticket.create({
      data: {
        orderId: pedidoId,
        orderItemId: itemId,
        eventId: ctx.fx.event.id,
        ticketLotId: ctx.fx.lot.id,
        seq,
        code,
        qrToken: `tok-meia-${rand()}-${seq}`,
        status: ingresso.status,
        attendeeName: ingresso.nome ?? null,
        checkedInAt: ingresso.status === "CHECKED_IN" ? new Date() : undefined,
      },
    });
    codigos.push(code);
  }
  return codigos;
}

test("meia-entrada: um ingresso de meia por linha, com canal e situação; colunas novas nos outros CSVs", async () => {
  const ctx = await montarMeia();
  try {
    // site: 1 inteira + 2 meias (uma já entrou)
    const site = await pedidoComItens(ctx, {
      status: "FULFILLED",
      contactName: "Comprador do Site",
      itens: [
        { quantidade: 1, meia: false },
        { quantidade: 2, meia: true },
      ],
    });
    const [codigoInteira] = await emitirItem(ctx, site.pedido.id, site.itens[0]!.id, [{ status: "ACTIVE" }]);
    const codigosMeiaSite = await emitirItem(ctx, site.pedido.id, site.itens[1]!.id, [
      { status: "CHECKED_IN", nome: "Maria Meia" },
      { status: "ACTIVE" },
    ]);

    // porta: 1 meia vendida no PDV
    const porta = await pedidoComItens(ctx, {
      status: "FULFILLED",
      contactName: "Porta · 21:40",
      soldByUserId: ctx.dono.id,
      itens: [{ quantidade: 1, meia: true }],
    });
    const [codigoPorta] = await emitirItem(ctx, porta.pedido.id, porta.itens[0]!.id, [{ status: "ACTIVE" }]);

    // pago, mas o worker ainda não emitiu — e o nome tenta virar fórmula
    const semEmissao = await pedidoComItens(ctx, {
      status: "PAID",
      contactName: '=HYPERLINK("http://x")',
      itens: [{ quantidade: 1, meia: true }],
    });

    // Pix pendente: não é venda, não tem ingresso
    const pendente = await pedidoComItens(ctx, {
      status: "PAYMENT_PENDING",
      contactName: "Ainda Pagando",
      itens: [{ quantidade: 1, meia: true }],
    });

    // vendido e depois reembolsado: aparece, com a situação escrita
    const reembolsado = await pedidoComItens(ctx, {
      status: "REFUNDED",
      contactName: "Desistiu",
      itens: [{ quantidade: 1, meia: true }],
    });
    const [codigoReembolsado] = await emitirItem(ctx, reembolsado.pedido.id, reembolsado.itens[0]!.id, [
      { status: "REFUNDED" },
    ]);

    // ---- CSV de meia-entrada
    const meia = lerCsv(await ctx.dashboard.exportMeiaEntradaCsv(ctx.fx.event.id, ctx.dono.id));
    assert.deepEqual(meia[0], CABECALHO_MEIA.split(","));
    const linhas = meia.slice(1);
    assert.equal(linhas.length, 5, "2 do site + 1 da porta + 1 pago sem ingresso + 1 reembolsado; o pendente fica fora");
    const coluna = (nome: string) => CABECALHO_MEIA.split(",").indexOf(nome);
    const porCodigo = (codigo: string) => linhas.find((l) => l[coluna("codigo")] === codigo);

    assert.equal(porCodigo(codigoInteira!), undefined, "ingresso inteiro não entra no relatório de meia");
    assert.equal(linhas.filter((l) => l[coluna("pedido")] === pendente.pedido.publicToken).length, 0);

    const maria = porCodigo(codigosMeiaSite[0]!);
    assert.equal(maria?.[coluna("participante")], "Maria Meia");
    assert.equal(maria?.[coluna("situacao")], "usado na entrada");
    assert.equal(maria?.[coluna("canal")], "site");
    assert.equal(maria?.[coluna("tipo")], "Pista");
    assert.equal(maria?.[coluna("lote")], "Lote único");
    assert.equal(porCodigo(codigosMeiaSite[1]!)?.[coluna("participante")], "Comprador do Site");

    assert.equal(porCodigo(codigoPorta!)?.[coluna("canal")], "porta");
    assert.equal(linhas.filter((l) => l[coluna("canal")] === "porta").length, 1);

    const aguardando = linhas.find((l) => l[coluna("pedido")] === semEmissao.pedido.publicToken);
    assert.equal(aguardando?.[coluna("codigo")], "");
    assert.equal(aguardando?.[coluna("situacao")], SITUACAO_SEM_INGRESSO);
    assert.equal(aguardando?.[coluna("participante")], `'=HYPERLINK("http://x")`, "nome vira texto, não fórmula");

    assert.equal(porCodigo(codigoReembolsado!)?.[coluna("situacao")], "reembolsado");

    // ---- CSV de pedidos: coluna "meia" no fim, com a quantidade
    const pedidos = lerCsv(await ctx.dashboard.exportOrdersCsv(ctx.fx.event.id, ctx.dono.id));
    assert.equal(pedidos[0]?.at(-1), "meia");
    assert.equal(pedidos[0]?.length, 12, "as 11 colunas de antes + meia");
    assert.equal(pedidos.length, 6, "cabeçalho + 5 pedidos");
    const linhaDoPedido = (token: string) => pedidos.find((l) => l[0] === token);
    assert.equal(linhaDoPedido(site.pedido.publicToken)?.at(-1), "2");
    assert.equal(linhaDoPedido(site.pedido.publicToken)?.[4], "3", "a coluna itens continua contando tudo");
    assert.equal(linhaDoPedido(porta.pedido.publicToken)?.at(-1), "1");

    // ---- CSV de participantes: coluna "meia" (sim/não) no fim, lista inteira
    const participantes = lerCsv(await ctx.dashboard.exportParticipantsCsv(ctx.fx.event.id, ctx.dono.id));
    assert.equal(participantes[0]?.at(-1), "meia");
    assert.equal(participantes[0]?.length, 8, "as 7 colunas de antes + meia");
    assert.equal(participantes.length, 6, "cabeçalho + 5 ingressos emitidos");
    const participante = (codigo: string) => participantes.find((l) => l[0] === codigo);
    assert.equal(participante(codigoInteira!)?.at(-1), "não");
    assert.equal(participante(codigosMeiaSite[0]!)?.at(-1), "sim");
    assert.equal(participante(codigoPorta!)?.at(-1), "sim");

    // a lista paginada (JSON) segue igual e ganha o campo
    const pagina = await ctx.dashboard.listParticipants(ctx.fx.event.id, ctx.dono.id, { page: 1, pageSize: 50, q: null });
    assert.equal(pagina.total, 5);
    assert.equal(pagina.participants.find((p) => p.code === codigoInteira)?.halfPrice, false);
    assert.equal(pagina.participants.find((p) => p.code === codigoPorta)?.halfPrice, true);
  } finally {
    await desmontarMeia(ctx);
  }
});

test("meia-entrada: mesma permissão dos outros exports — vendedor não baixa", async () => {
  const ctx = await montarMeia();
  try {
    await assert.rejects(() => ctx.dashboard.exportMeiaEntradaCsv(ctx.fx.event.id, ctx.vendedor.id), /Sem permissão/);
    await assert.rejects(
      () => ctx.dashboard.exportMeiaEntradaCsv("00000000-0000-0000-0000-000000000001", ctx.dono.id),
      /Evento não encontrado/,
    );
    // evento sem meia: só o cabeçalho (a tela avisa que não há meia)
    const vazio = await ctx.dashboard.exportMeiaEntradaCsv(ctx.fx.event.id, ctx.dono.id);
    assert.equal(vazio, CABECALHO_MEIA);
  } finally {
    await desmontarMeia(ctx);
  }
});

// ---- promoter: coluna Grátis ----------------------------------------------------

async function montarPromoter() {
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 5000, feeCents: 0 });
  const dono = await prisma.user.create({ data: { email: `dono-gratis-${rand()}@borafest.dev`, name: "Produção" } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  const acesso = new OrgAccessService();
  return {
    fx,
    dono,
    performance: new PromoterPerformanceService(acesso),
    reservations: new ReservationsService(new InventoryService(), new WaitingRoomService()),
    orders: new OrdersService(new CouponsService(acesso), acesso),
    usuarios: [dono.id] as string[],
    emails: [] as string[],
  };
}
type CtxPromoter = Awaited<ReturnType<typeof montarPromoter>>;

async function desmontarPromoter(ctx: CtxPromoter) {
  const orgId = ctx.fx.organization.id;
  const pedidos = await prisma.order.findMany({ where: { eventId: ctx.fx.event.id }, select: { id: true } });
  const ids = pedidos.map((p) => p.id);
  await prisma.notification.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
  await prisma.couponRedemption.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
  await prisma.promoterLink.deleteMany({ where: { organizationId: orgId } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
  await cleanupFixtureEvent(orgId);
  await prisma.user.deleteMany({ where: { email: { in: ctx.emails } } }).catch(() => undefined);
  for (const id of ctx.usuarios) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

async function promoter(ctx: CtxPromoter, nome: string) {
  const pessoa = await prisma.user.create({ data: { email: `promoter-${rand()}@borafest.dev`, name: nome } });
  ctx.usuarios.push(pessoa.id);
  const link = await prisma.promoterLink.create({
    data: {
      organizationId: ctx.fx.organization.id,
      promoterUserId: pessoa.id,
      status: "ACTIVE",
      commissionType: "NONE",
      slug: `pr-${rand()}`,
    },
  });
  return { pessoa, link };
}

async function pedidoDoPromoter(
  ctx: CtxPromoter,
  input: {
    linkId: string;
    lotId: string;
    quantidade: number;
    totalCents: number;
    discountCents?: number;
    status: OrderStatus;
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
      discountCents: input.discountCents ?? 0,
      promoterLinkId: input.linkId,
      paidAt: new Date(),
      items: {
        create: [
          {
            ticketLotId: input.lotId,
            quantity: input.quantidade,
            priceCents: input.quantidade > 0 ? Math.floor(input.totalCents / input.quantidade) : 0,
            feeCents: 0,
          },
        ],
      },
    },
  });
  return pedido;
}

/** Emite os ingressos do pedido (como o worker), cada um com a situação pedida. */
async function emitirPedido(orderId: string, situacoes: Array<"ACTIVE" | "CHECKED_IN">) {
  const pedido = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { eventId: true, items: { select: { id: true, ticketLotId: true } } },
  });
  const item = pedido.items[0]!;
  for (let seq = 1; seq <= situacoes.length; seq += 1) {
    await prisma.ticket.create({
      data: {
        orderId,
        orderItemId: item.id,
        eventId: pedido.eventId,
        ticketLotId: item.ticketLotId,
        seq,
        code: `GRT-${rand()}${seq}`.toUpperCase(),
        qrToken: `tok-grt-${rand()}-${seq}`,
        status: situacoes[seq - 1]!,
        checkedInAt: situacoes[seq - 1] === "CHECKED_IN" ? new Date() : undefined,
      },
    });
  }
}

test("promoter: Grátis conta lote grátis e cupom 100% pelo link dele (pegaram / entraram); venda e lista não mudam", async () => {
  const ctx = await montarPromoter();
  try {
    const bia = await promoter(ctx, "Bia Promoter");
    const joao = await promoter(ctx, "João Só Grátis");
    const loteGratis = await prisma.ticketLot.create({
      data: {
        ticketTypeId: ctx.fx.ticketType.id,
        name: `Grátis ${rand()}`,
        priceCents: 0,
        feeCents: 0,
        capacity: 30,
        status: "ACTIVE",
      },
    });

    // (A) CAMINHO REAL: lote grátis resgatado no site pelo link da Bia (?pr=)
    const reserva = await ctx.reservations.create(undefined, {
      eventId: ctx.fx.event.id,
      items: [{ ticketLotId: loteGratis.id, quantity: 3 }],
    });
    const email = `gratis-${rand()}@example.com`;
    ctx.emails.push(email);
    const resgate = await ctx.orders.createFromReservation(undefined, {
      reservationId: reserva.id,
      contactEmail: email,
      promoterSlug: bia.link.slug,
      consent: { version: "v2026-07", terms: true, privacy: true },
    });
    assert.equal(resgate.status, "PAID");
    assert.equal(resgate.totalCents, 0);
    assert.equal(resgate.promoterLinkId, bia.link.id, "o grátis nasce com o promoter no pedido");
    await emitirPedido(resgate.id, ["CHECKED_IN", "CHECKED_IN", "ACTIVE"]);

    // (B) grátis de 2 em que 1 já entrou e o produtor cancelou o resto
    const parcial = await pedidoDoPromoter(ctx, {
      linkId: bia.link.id,
      lotId: loteGratis.id,
      quantidade: 2,
      totalCents: 0,
      status: "PAID",
    });
    await emitirPedido(parcial.id, ["CHECKED_IN", "ACTIVE"]);
    const cancelamento = await cancelarPedidoGratis(parcial.id, ctx.dono.id, "teste do relatório");
    assert.equal(cancelamento.ingressosCancelados, 1);
    assert.equal(cancelamento.ingressosUsados, 1);

    // (C) cupom de 100% no lote pago, pago e ainda sem ingresso emitido
    await pedidoDoPromoter(ctx, {
      linkId: bia.link.id,
      lotId: ctx.fx.lot.id,
      quantidade: 1,
      totalCents: 0,
      discountCents: 5000,
      status: "PAID",
    });

    // (D) grátis cancelado por inteiro: não conta
    await pedidoDoPromoter(ctx, {
      linkId: bia.link.id,
      lotId: loteGratis.id,
      quantidade: 2,
      totalCents: 0,
      status: "CANCELED",
    });

    // venda paga que entrou
    const venda = await pedidoDoPromoter(ctx, {
      linkId: bia.link.id,
      lotId: ctx.fx.lot.id,
      quantidade: 1,
      totalCents: 5000,
      status: "PAID",
    });
    await emitirPedido(venda.id, ["CHECKED_IN"]);

    // convidado da lista dela que entrou
    const convidado = await pedidoDoPromoter(ctx, {
      linkId: bia.link.id,
      lotId: ctx.fx.lot.id,
      quantidade: 1,
      totalCents: 0,
      status: "PAID",
    });
    await prisma.guestListEntry.create({
      data: {
        eventId: ctx.fx.event.id,
        ticketLotId: ctx.fx.lot.id,
        orderId: convidado.id,
        addedByUserId: bia.pessoa.id,
        guestName: "Convidado da Bia",
      },
    });
    await emitirPedido(convidado.id, ["CHECKED_IN"]);

    // João: só distribuiu grátis, ninguém entrou ainda
    const doJoao = await pedidoDoPromoter(ctx, {
      linkId: joao.link.id,
      lotId: loteGratis.id,
      quantidade: 2,
      totalCents: 0,
      status: "FULFILLED",
    });
    await emitirPedido(doJoao.id, ["ACTIVE", "ACTIVE"]);

    const relatorio = await ctx.performance.forEvent(ctx.fx.organization.id, ctx.fx.event.id, ctx.dono.id);
    const linhaBia = relatorio.promoters.find((p) => p.id === bia.link.id);
    const linhaJoao = relatorio.promoters.find((p) => p.id === joao.link.id);

    assert.ok(linhaBia, "a Bia aparece no relatório");
    assert.equal(linhaBia?.freeTaken, 5, "3 do lote grátis + 1 que restou do parcial + 1 do cupom 100%; o cancelado não");
    assert.equal(linhaBia?.freeCheckedIn, 3, "2 do lote grátis + 1 do parcial");

    // venda e lista exatamente como antes
    assert.equal(linhaBia?.ticketsSold, 1);
    assert.equal(linhaBia?.paidOrders, 1);
    assert.equal(linhaBia?.grossCents, 5000);
    assert.equal(linhaBia?.soldCheckedIn, 1, "grátis que entrou não vira vendido que entrou");
    assert.equal(linhaBia?.guestsRegistered, 1);
    assert.equal(linhaBia?.guestsCheckedIn, 1, "grátis que entrou não vira convidado que entrou");
    assert.equal(linhaBia?.rank, 1);

    assert.ok(linhaJoao, "quem só distribuiu grátis aparece (antes aparecia com zero em tudo)");
    assert.equal(linhaJoao?.freeTaken, 2);
    assert.equal(linhaJoao?.freeCheckedIn, 0);
    assert.equal(linhaJoao?.ticketsSold, 0);
    assert.equal(linhaJoao?.rank, null, "grátis não entra no ranking de vendas");

    assert.equal(relatorio.summary.freeTaken, 7);
    assert.equal(relatorio.summary.freeCheckedIn, 3);
    assert.equal(relatorio.summary.ticketsSold, 1, "o total de vendidos não incha com grátis");
    assert.equal(relatorio.summary.guestsRegistered, 1);
  } finally {
    await desmontarPromoter(ctx);
  }
});
