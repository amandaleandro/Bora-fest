import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../catalog/catalog.service";
import { ReservationsService } from "../reservations/reservations.service";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Janela do lote (2026-10-12): o site mostrava "lote termina em", mas a reserva
// não conferia início nem fim do lote — o 1º lote seguia vendendo depois da
// data, e um lote programado para abrir depois já vendia. Agora a reserva
// recusa fora da janela, e a página do evento, a disponibilidade e o card da
// vitrine não oferecem esse lote.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);
const HORA = 3_600_000;

/** Instância nova a cada leitura: o micro-cache da vitrine mora na instância. */
const catalogo = () => new CatalogService(new OrgAccessService(), new InventoryService());

async function montar() {
  // o lote da fixture (R$ 30 + R$ 3) não tem datas: vale o tempo todo
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 3000, feeCents: 300 });
  const cidade = `Janela-${rand()}`;
  const local = await prisma.venue.create({
    data: { organizationId: fx.organization.id, name: "Casa da Janela", city: cidade, state: "MG" },
  });
  await prisma.event.update({ where: { id: fx.event.id }, data: { venueId: local.id } });
  const dono = await prisma.user.create({ data: { email: `dono-${rand()}@borafest.dev` } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });

  const agora = Date.now();
  const lote = (name: string, priceCents: number, janela: { startsAt?: Date; endsAt?: Date }) =>
    prisma.ticketLot.create({
      data: {
        ticketTypeId: fx.ticketType.id,
        name,
        priceCents,
        feeCents: Math.round(priceCents / 10),
        capacity: 20,
        status: "ACTIVE",
        ...janela,
      },
    });
  // os dois fora da janela são os MAIS BARATOS: se vazarem, o card mostra o preço deles
  const futuro = await lote("2º lote (abre amanhã)", 1000, {
    startsAt: new Date(agora + 24 * HORA),
    endsAt: new Date(agora + 36 * HORA),
  });
  const encerrado = await lote("Pré-venda (acabou)", 800, {
    startsAt: new Date(agora - 48 * HORA),
    endsAt: new Date(agora - HORA),
  });
  const aberto = await lote("1º lote", 5000, {
    startsAt: new Date(agora - HORA),
    endsAt: new Date(agora + 48 * HORA),
  });
  return { fx, cidade, dono, futuro, encerrado, aberto };
}

type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx) {
  const organizationId = ctx.fx.organization.id;
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.organizationMember.deleteMany({ where: { organizationId } });
  await cleanupFixtureEvent(organizationId);
  await prisma.venue.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: ctx.dono.id } }).catch(() => undefined);
}

function reservar(ctx: Ctx, ticketLotId: string) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  return reservations.create(undefined, {
    eventId: ctx.fx.event.id,
    items: [{ ticketLotId, quantity: 1 }],
  });
}

test("reserva: lote que ainda não abriu e lote que já encerrou são recusados, sem prender estoque", async () => {
  const ctx = await montar();
  try {
    await assert.rejects(() => reservar(ctx, ctx.futuro.id), /Este lote ainda não abriu/);
    await assert.rejects(() => reservar(ctx, ctx.encerrado.id), /Este lote já encerrou/);

    for (const lot of [ctx.futuro, ctx.encerrado]) {
      const agora = await prisma.ticketLot.findUniqueOrThrow({ where: { id: lot.id } });
      assert.equal(agora.reservedCount, 0, `${lot.name}: recusa não prende vaga`);
    }
    assert.equal(await prisma.reservation.count({ where: { eventId: ctx.fx.event.id } }), 0);

    // dentro da janela e sem datas seguem reservando normalmente
    const noPrazo = await reservar(ctx, ctx.aberto.id);
    assert.equal(noPrazo.items[0]?.ticketLotId, ctx.aberto.id);
    const semDatas = await reservar(ctx, ctx.fx.lot.id);
    assert.equal(semDatas.items[0]?.ticketLotId, ctx.fx.lot.id);
  } finally {
    await desmontar(ctx);
  }
});

test("site: página do evento e disponibilidade não oferecem lote fora da janela", async () => {
  const ctx = await montar();
  try {
    const evento = await catalogo().getPublicEvent(ctx.fx.event.slug);
    const ids = evento.ticketTypes.flatMap((t) => t.lots.map((l) => l.id));
    assert.ok(ids.includes(ctx.aberto.id), "lote dentro da janela aparece");
    assert.ok(ids.includes(ctx.fx.lot.id), "lote sem datas aparece");
    assert.ok(!ids.includes(ctx.futuro.id), "lote que ainda não abriu não aparece");
    assert.ok(!ids.includes(ctx.encerrado.id), "lote encerrado não aparece");

    const disponivel = await catalogo().getPublicAvailability(ctx.fx.event.slug);
    const idsDisponiveis = disponivel.map((d) => d.lotId);
    assert.ok(!idsDisponiveis.includes(ctx.futuro.id));
    assert.ok(!idsDisponiveis.includes(ctx.encerrado.id));
    assert.ok(idsDisponiveis.includes(ctx.aberto.id));
  } finally {
    await desmontar(ctx);
  }
});

test("vitrine: preço e 'lote termina em' do card ignoram lote fora da janela", async () => {
  const ctx = await montar();
  try {
    const lista = await catalogo().listPublicEvents({ page: 1, pageSize: 10, city: ctx.cidade });
    const card = lista.events.find((e) => e.id === ctx.fx.event.id);
    assert.ok(card, "o evento está na vitrine");
    // mais barato À VENDA é o da fixture: R$ 30 + R$ 3 de taxa (não o de R$ 8 encerrado nem o de R$ 10 futuro)
    assert.equal(card.fromPriceCents, 3300);
    // o fim que vale é o do 1º lote aberto, não o do 2º lote que nem abriu
    assert.equal(card.currentLotEndsAt?.getTime(), ctx.aberto.endsAt?.getTime());
  } finally {
    await desmontar(ctx);
  }
});

test("cadastro: lote com fim antes do início é recusado", async () => {
  const ctx = await montar();
  try {
    const inicio = new Date(Date.now() + 24 * HORA);
    await assert.rejects(
      () =>
        catalogo().createLot(ctx.fx.ticketType.id, ctx.dono.id, {
          name: "Lote ao contrário",
          priceCents: 3000,
          capacity: 10,
          maxPerOrder: 4,
          startsAt: inicio.toISOString(),
          endsAt: new Date(inicio.getTime() - HORA).toISOString(),
        } as never),
      /fim das vendas do lote precisa ser depois do início/,
    );
    assert.equal(await prisma.ticketLot.count({ where: { name: "Lote ao contrário", ticketTypeId: ctx.fx.ticketType.id } }), 0);
  } finally {
    await desmontar(ctx);
  }
});
