import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../catalog/catalog.service";
import { HousesService } from "../houses/houses.service";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Vitrine sem esgotado (2026-10-11): nada no sistema passa o lote para
// "esgotado" — ele segue ACTIVE com o estoque zerado. O card da lista, da home
// e da Casa seguia dizendo "Grátis" (ou "a partir de R$ 20") de um lote que
// ninguém mais consegue pegar. Agora só lote com estoque entra no preço.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);

/**
 * Instância nova a cada leitura: o micro-cache da vitrine (5 s na lista, 60 s
 * na home) mora na instância, e o teste mexe no estoque entre uma leitura e outra.
 */
const catalogo = () => new CatalogService(new OrgAccessService(), new InventoryService());
const casas = new HousesService();

type Card = { id: string; fromPriceCents: number | null; currentLotEndsAt: Date | null };

async function montar() {
  // lote grátis pequeno (o que esgota) + lote pago com estoque, numa cidade só
  // deste teste — a lista filtrada por cidade traz só este evento
  const fx = await createFixtureEvent({ lotCapacity: 5, priceCents: 0, feeCents: 0 });
  const cidade = `Vitrine-${rand()}`;
  const local = await prisma.venue.create({
    data: { organizationId: fx.organization.id, name: "Casa da Vitrine", city: cidade, state: "MG" },
  });
  await prisma.event.update({ where: { id: fx.event.id }, data: { venueId: local.id } });
  // o grátis tem fim marcado: é a urgência "lote atual termina em" do card
  const fimDoGratis = new Date(Date.now() + 12 * 3_600_000);
  await prisma.ticketLot.update({ where: { id: fx.lot.id }, data: { endsAt: fimDoGratis } });
  const pago = await prisma.ticketLot.create({
    data: {
      ticketTypeId: fx.ticketType.id,
      name: "Lote pago",
      priceCents: 3000,
      feeCents: 300,
      capacity: 50,
      status: "ACTIVE",
    },
  });
  return { fx, cidade, pago, fimDoGratis };
}

/** O card do evento em cada vitrine: lista pública, home, perfil da Casa e descoberta de Casas. */
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

function confere(vitrines: Record<string, Card | undefined>, preco: number | null, fim: Date | null, situacao: string) {
  for (const [onde, card] of Object.entries(vitrines)) {
    assert.ok(card, `${onde}: o evento continua na vitrine (${situacao})`);
    assert.equal(card.fromPriceCents, preco, `${onde}: preço do card (${situacao})`);
    assert.equal(
      card.currentLotEndsAt?.getTime() ?? null,
      fim?.getTime() ?? null,
      `${onde}: fim do lote atual (${situacao})`,
    );
  }
}

test("vitrine: lote grátis esgotado sai do card e o preço passa a ser o do lote pago", async () => {
  const ctx = await montar();
  try {
    // grátis com vaga: card "Grátis" (0) e urgência do fim do grátis
    confere(await cards(ctx), 0, ctx.fimDoGratis, "lote grátis com vaga");

    // grátis todo pego: card mostra o pago com a taxa do comprador (R$ 33,00)
    // e a urgência do grátis some — ele não é mais o lote atual
    await prisma.ticketLot.update({ where: { id: ctx.fx.lot.id }, data: { soldCount: 5 } });
    confere(await cards(ctx), 3300, null, "lote grátis esgotado");

    // reservado também ocupa vaga — a mesma conta da reserva e do seletor
    await prisma.ticketLot.update({ where: { id: ctx.fx.lot.id }, data: { soldCount: 3, reservedCount: 2 } });
    confere(await cards(ctx), 3300, null, "últimas vagas do grátis em reserva");

    // a reserva expirou e a vaga voltou: "Grátis" volta
    await prisma.ticketLot.update({ where: { id: ctx.fx.lot.id }, data: { reservedCount: 1 } });
    confere(await cards(ctx), 0, ctx.fimDoGratis, "uma vaga do grátis de volta");
  } finally {
    await cleanupFixtureEvent(ctx.fx.organization.id);
  }
});

test("vitrine: lote pago esgotado também sai do 'a partir de'", async () => {
  const ctx = await montar();
  try {
    // sem o grátis: sobram o de R$ 33 (com taxa) e um mais barato de R$ 22
    await prisma.ticketLot.update({ where: { id: ctx.fx.lot.id }, data: { status: "CLOSED" } });
    const barato = await prisma.ticketLot.create({
      data: {
        ticketTypeId: ctx.fx.ticketType.id,
        name: "Primeiro lote",
        priceCents: 2000,
        feeCents: 200,
        capacity: 10,
        status: "ACTIVE",
      },
    });
    confere(await cards(ctx), 2200, null, "lote de R$ 22 com vaga");

    await prisma.ticketLot.update({ where: { id: barato.id }, data: { soldCount: 10 } });
    confere(await cards(ctx), 3300, null, "lote de R$ 22 esgotado");
  } finally {
    await cleanupFixtureEvent(ctx.fx.organization.id);
  }
});

test("vitrine: tudo esgotado — o evento continua no card, sem preço", async () => {
  const ctx = await montar();
  try {
    await prisma.ticketLot.update({ where: { id: ctx.fx.lot.id }, data: { soldCount: 5 } });
    await prisma.ticketLot.update({ where: { id: ctx.pago.id }, data: { soldCount: 50 } });
    // null = o site mostra o card sem a linha de preço (o mesmo de evento sem lote à venda)
    confere(await cards(ctx), null, null, "todos os lotes esgotados");
  } finally {
    await cleanupFixtureEvent(ctx.fx.organization.id);
  }
});
