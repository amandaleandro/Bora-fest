import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../catalog/catalog.service";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Ingresso restrito (2026-10-10): link de convidado, exclusivo do promoter,
// evento privado e limite por CPF. Toda trava é provada na RESERVA/PEDIDO, não
// só na tela — o lote do promoter era só escondido e reservava sem o link.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);

/** CPF válido aleatório: cada execução usa CPFs que nenhum usuário antigo tem. */
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
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 0, feeCents: 0 });
  const dono = await prisma.user.create({ data: { email: `dono-${rand()}@borafest.dev` } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  const catalog = new CatalogService(new OrgAccessService(), new InventoryService());
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  return { fx, dono, catalog, reservations, orders, emails: [] as string[], usuarios: [dono.id] };
}

async function desmontar(ctx: Awaited<ReturnType<typeof montar>>) {
  const pedidos = await prisma.order.findMany({ where: { eventId: ctx.fx.event.id }, select: { id: true } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: pedidos.map((p) => p.id) } } });
  await prisma.promoterLink.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  await cleanupFixtureEvent(ctx.fx.organization.id);
  await prisma.user.deleteMany({ where: { email: { in: ctx.emails } } }).catch(() => undefined);
  for (const id of ctx.usuarios) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

async function lote(ctx: Awaited<ReturnType<typeof montar>>, extra: Record<string, unknown>) {
  const criado = await ctx.catalog.createLot(ctx.fx.ticketType.id, ctx.dono.id, {
    name: `Lote ${rand()}`,
    priceCents: 0,
    feeCents: 0,
    capacity: 10,
    maxPerOrder: 6,
    ...extra,
  } as never);
  await prisma.ticketLot.update({ where: { id: criado.id }, data: { status: "ACTIVE" } });
  return criado;
}

function idsDosLotes(evento: { ticketTypes: Array<{ lots: Array<{ id: string }> }> }) {
  return evento.ticketTypes.flatMap((t) => t.lots.map((l) => l.id));
}

test("lote por link: some do site, abre só com o código atual e o código nunca vaza", async () => {
  const ctx = await montar();
  try {
    const restrito = await lote(ctx, { inviteMode: "LINK" });
    const codigo = restrito.inviteToken!;
    assert.ok(codigo && codigo.length >= 20, "lote por link nasce com código");

    const publico = await ctx.catalog.getPublicEvent(ctx.fx.event.slug);
    assert.ok(!idsDosLotes(publico).includes(restrito.id), "sem o código, o lote não aparece");
    assert.ok(idsDosLotes(publico).includes(ctx.fx.lot.id), "o lote aberto continua aparecendo");

    const comConvite = await ctx.catalog.getPublicEvent(ctx.fx.event.slug, undefined, codigo);
    assert.ok(idsDosLotes(comConvite).includes(restrito.id), "com o código, o lote aparece");
    const todos = comConvite.ticketTypes.flatMap((t) => t.lots) as Array<{ inviteToken: string | null }>;
    assert.ok(todos.every((l) => l.inviteToken === null), "o código nunca sai na resposta pública");

    const semCodigo = await ctx.catalog.getPublicAvailability(ctx.fx.event.slug);
    assert.ok(!semCodigo.some((l) => l.lotId === restrito.id), "estoque do lote restrito não vaza");

    const reservar = (inviteToken?: string) =>
      ctx.reservations.create(undefined, {
        eventId: ctx.fx.event.id,
        items: [{ ticketLotId: restrito.id, quantity: 1 }],
        inviteToken,
      });
    await assert.rejects(reservar(), /só para convidados/);
    await assert.rejects(reservar("codigo-errado-123"), /só para convidados/);
    await reservar(codigo);

    const trocado = await ctx.catalog.rotateInviteLink(restrito.id, ctx.dono.id);
    assert.notEqual(trocado.inviteToken, codigo);
    await assert.rejects(reservar(codigo), /só para convidados/, "trocar o link mata o antigo");
    await reservar(trocado.inviteToken!);
  } finally {
    await desmontar(ctx);
  }
});

test("lote do promoter: a reserva exige o link de um promoter ativo da casa", async () => {
  const ctx = await montar();
  try {
    const exclusivo = await lote(ctx, { promoterOnly: true });
    const promoter = await prisma.user.create({ data: { email: `promoter-${rand()}@borafest.dev` } });
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
    const reservar = (promoterSlug?: string) =>
      ctx.reservations.create(undefined, {
        eventId: ctx.fx.event.id,
        items: [{ ticketLotId: exclusivo.id, quantity: 1 }],
        promoterSlug,
      });
    await assert.rejects(reservar(), /link de um promoter/);
    await assert.rejects(reservar("slug-que-nao-existe"), /link de um promoter/);
    await reservar(link.slug);
  } finally {
    await desmontar(ctx);
  }
});

test("um lote tem uma restrição só", async () => {
  const ctx = await montar();
  try {
    await assert.rejects(lote(ctx, { pdvOnly: true, inviteMode: "LINK" }), /só uma forma/);
    await assert.rejects(lote(ctx, { promoterOnly: true, inviteMode: "LINK" }), /só uma forma/);
  } finally {
    await desmontar(ctx);
  }
});

test("evento privado: fora da vitrine, mas abre pelo link", async () => {
  const ctx = await montar();
  try {
    await prisma.event.update({ where: { id: ctx.fx.event.id }, data: { isPrivate: true } });
    const vitrine = await ctx.catalog.listPublicEvents({ page: 1, pageSize: 100 });
    assert.ok(!vitrine.events.some((e) => e.slug === ctx.fx.event.slug), "privado não entra na lista pública");
    const pelaUrl = await ctx.catalog.getPublicEvent(ctx.fx.event.slug);
    assert.equal(pelaUrl.id, ctx.fx.event.id, "pelo link o evento abre");
  } finally {
    await desmontar(ctx);
  }
});

test("limite por CPF: um por pessoa, conta criada com CPF e consentimento", async () => {
  const ctx = await montar();
  try {
    const gratis = await lote(ctx, { limitPerCpf: 1 });
    const cpfA = geraCpf();
    const cpfB = geraCpf();
    const emailA = `restrito-a-${rand()}@example.com`;
    const emailA2 = `restrito-a2-${rand()}@example.com`;
    const emailB = `restrito-b-${rand()}@example.com`;
    ctx.emails.push(emailA, emailA2, emailB);
    const reservar = (quantity = 1) =>
      ctx.reservations.create(undefined, { eventId: ctx.fx.event.id, items: [{ ticketLotId: gratis.id, quantity }] });
    const consent = { version: "2026-08", terms: true as const, privacy: true as const };

    await assert.rejects(reservar(2), /limitado a 1 por pessoa/);

    const r1 = await reservar();
    const p1 = await ctx.orders.createFromReservation(undefined, {
      reservationId: r1.id,
      contactEmail: emailA,
      contactName: "Pessoa A",
      contactCpf: cpfA,
      consent,
    });
    assert.equal(p1.status, "PAID");
    const salvo = await prisma.order.findUniqueOrThrow({ where: { id: p1.id } });
    assert.equal(salvo.contactCpf, cpfA, "o CPF fica no pedido");
    assert.equal(salvo.accountCreatedByOrder, true, "quem não tinha conta ganha uma");
    const conta = await prisma.user.findUniqueOrThrow({ where: { email: emailA } });
    assert.equal(conta.cpf, cpfA, "a conta nasce com o CPF do resgate");
    assert.equal(await prisma.consent.count({ where: { orderId: p1.id } }), 2, "termos e privacidade registrados");

    const r2 = await reservar();
    await assert.rejects(
      ctx.orders.createFromReservation(undefined, { reservationId: r2.id, contactEmail: emailA2, contactCpf: cpfA, consent }),
      /já garantiu/,
      "o mesmo CPF não pega de novo, nem com outro e-mail",
    );

    const r3 = await reservar();
    const p3 = await ctx.orders.createFromReservation(undefined, {
      reservationId: r3.id,
      contactEmail: emailB,
      contactCpf: cpfB,
      consent,
    });
    assert.equal(p3.status, "PAID", "outro CPF pega normalmente");

    const r4 = await reservar();
    await assert.rejects(
      ctx.orders.createFromReservation(undefined, { reservationId: r4.id, contactEmail: `sem-cpf-${rand()}@example.com` }),
      /Informe seu CPF/,
    );
  } finally {
    await desmontar(ctx);
  }
});
