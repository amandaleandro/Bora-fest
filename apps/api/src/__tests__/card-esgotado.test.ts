import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../catalog/catalog.service";
import { HousesService } from "../houses/houses.service";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Card "Esgotado" (2026-10-12): o card de evento todo vendido ficava sem preço
// e o destaque da home completava com "Garanta seu lugar". A API passou a
// mandar `soldOut` no card — todo lote ACTIVE à venda sem estoque — nas quatro
// vitrines: lista pública, home, perfil da Casa e descoberta de Casas.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);

/** instância nova a cada leitura: o micro-cache da vitrine mora na instância */
const catalogo = () => new CatalogService(new OrgAccessService(), new InventoryService());
const casas = new HousesService();

type Card = { id: string; fromPriceCents: number | null; soldOut?: boolean };

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 5, priceCents: 2000, feeCents: 200 });
  const cidade = `Esgotado-${rand()}`;
  const local = await prisma.venue.create({
    data: { organizationId: fx.organization.id, name: "Casa do Esgotado", city: cidade, state: "MG" },
  });
  await prisma.event.update({ where: { id: fx.event.id }, data: { venueId: local.id } });
  const segundo = await prisma.ticketLot.create({
    data: {
      ticketTypeId: fx.ticketType.id,
      name: "Segundo lote",
      priceCents: 3000,
      feeCents: 300,
      capacity: 10,
      status: "ACTIVE",
    },
  });
  return { fx, cidade, segundo };
}

async function cards(ctx: Awaited<ReturnType<typeof montar>>): Promise<Record<string, Card | undefined>> {
  const doEvento = (lista: Card[]) => lista.find((e) => e.id === ctx.fx.event.id);
  const lista = await catalogo().listPublicEvents({ page: 1, pageSize: 10, city: ctx.cidade });
  const home = await catalogo().getHomeSections(ctx.cidade);
  const perfil = await casas.getPublicHouse(ctx.fx.organization.slug);
  const descoberta = await casas.listPublicHouses(1, 10, ctx.cidade);
  return {
    lista: doEvento(lista.events),
    home: doEvento([...home.highlights, ...home.shelves.flatMap((s) => s.events), ...home.upcoming]),
    casa: doEvento(perfil.events),
    descoberta: descoberta.houses.find((h) => h.id === ctx.fx.organization.id)?.nextEvent ?? undefined,
  };
}

function confere(vitrines: Record<string, Card | undefined>, esgotado: boolean, situacao: string) {
  for (const [onde, card] of Object.entries(vitrines)) {
    assert.ok(card, `${onde}: o evento continua na vitrine (${situacao})`);
    assert.equal(card.soldOut, esgotado, `${onde}: soldOut (${situacao})`);
  }
}

test("card: só vira 'Esgotado' quando TODO lote à venda acabou", async () => {
  const ctx = await montar();
  try {
    confere(await cards(ctx), false, "dois lotes com vaga");

    // um lote acabou, o outro tem vaga: não é esgotado
    await prisma.ticketLot.update({ where: { id: ctx.fx.lot.id }, data: { soldCount: 5 } });
    confere(await cards(ctx), false, "primeiro lote esgotado, segundo com vaga");

    // reservado também ocupa vaga — a mesma conta do preço do card
    await prisma.ticketLot.update({ where: { id: ctx.segundo.id }, data: { soldCount: 8, reservedCount: 2 } });
    confere(await cards(ctx), true, "últimas vagas em reserva");

    // reserva expirou e a vaga voltou: deixa de ser esgotado
    await prisma.ticketLot.update({ where: { id: ctx.segundo.id }, data: { reservedCount: 1 } });
    confere(await cards(ctx), false, "uma vaga de volta");
  } finally {
    await cleanupFixtureEvent(ctx.fx.organization.id);
  }
});

test("card: lote fechado não conta — evento só com lote CLOSED não é 'Esgotado'", async () => {
  const ctx = await montar();
  try {
    // os dois lotes fechados pelo produtor: não há lote à venda, e "esgotado"
    // seria mentira (ninguém comprou tudo)
    await prisma.ticketLot.updateMany({
      where: { id: { in: [ctx.fx.lot.id, ctx.segundo.id] } },
      data: { status: "CLOSED" },
    });
    confere(await cards(ctx), false, "todos os lotes fechados");

    // reabre um, esgotado: agora sim
    await prisma.ticketLot.update({ where: { id: ctx.segundo.id }, data: { status: "ACTIVE", soldCount: 10 } });
    confere(await cards(ctx), true, "único lote ativo esgotado");
  } finally {
    await cleanupFixtureEvent(ctx.fx.organization.id);
  }
});
