import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../catalog/catalog.service";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

/** Vendas de mentira com carimbo de tempo real: reserva+pedido+ingressos direto no banco. */
async function fabricateSales(
  fixture: Awaited<ReturnType<typeof createFixtureEvent>>,
  quantidade: number,
  issuedAt: Date,
) {
  const reservation = await prisma.reservation.create({
    data: { eventId: fixture.event.id, status: "CONVERTED", expiresAt: new Date(Date.now() + 60_000) },
  });
  const order = await prisma.order.create({
    data: {
      eventId: fixture.event.id,
      reservationId: reservation.id,
      contactEmail: `home-${Math.random().toString(36).slice(2, 8)}@borafest.dev`,
      status: "PAID",
      totalCents: 1000 * quantidade,
    },
  });
  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      ticketLotId: fixture.lot.id,
      quantity: quantidade,
      priceCents: 1000,
      feeCents: 0,
    },
  });
  await prisma.ticket.createMany({
    data: Array.from({ length: quantidade }, (_, i) => ({
      orderId: order.id,
      orderItemId: item.id,
      eventId: fixture.event.id,
      ticketLotId: fixture.lot.id,
      seq: i + 1,
      code: `HOME-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      qrToken: `qr-${Math.random().toString(36).slice(2, 12)}`,
      status: "ISSUED",
      issuedAt,
    })),
  });
}

test("home viva: placar com peso na noite, Em alta honesto e prateleira por densidade", async () => {
  const catalog = new CatalogService(new OrgAccessService(), new InventoryService());
  const agora = Date.now();
  const fixtures = [] as Array<Awaited<ReturnType<typeof createFixtureEvent>>>;
  try {
    // 4 eventos FESTAS (prateleira nasce com 3+) + 1 SHOWS (fica fora de prateleira)
    for (let i = 0; i < 5; i++) {
      const f = await createFixtureEvent({ lotCapacity: 50, priceCents: 1000, feeCents: 0 });
      fixtures.push(f);
      await prisma.event.update({
        where: { id: f.event.id },
        data: { category: i < 4 ? "FESTAS" : "SHOWS" },
      });
    }
    const [quente, morno, semana, frio] = fixtures;

    // quente: 2 vendas HOJE (2×3 + 2×1 = 8 pontos)
    await fabricateSales(quente, 2, new Date(agora - 3600_000));
    // morno: 1 venda hoje (1×3 + 1 = 4 pontos)
    await fabricateSales(morno, 1, new Date(agora - 2 * 3600_000));
    // semana: 6 vendas há 5 dias (0×3 + 6×1 = 6 pontos) — semana segura o ranking
    await fabricateSales(semana, 6, new Date(agora - 5 * 24 * 3600_000));

    const home = await catalog.getHomeSections();
    const ids = (lista: Array<{ id: string }>) => lista.map((e) => e.id);

    // Em alta: quente (8) > semana (6) > morno (4); frio não aparece
    const nossos = home.highlights.filter((e) =>
      fixtures.some((f) => f.event.id === e.id),
    );
    assert.deepEqual(ids(nossos).slice(0, 3), [quente.event.id, semana.event.id, morno.event.id]);
    assert.ok(!ids(home.highlights).includes(frio.event.id), "sem venda não é 'em alta'");

    // prateleira FESTAS existe (4 eventos ≥ 3) e vem ordenada por placar
    const festas = home.shelves.find((s) => s.category === "FESTAS");
    assert.ok(festas, "prateleira FESTAS deve nascer com 4 eventos");
    const nossosFestas = festas!.events.filter((e) => fixtures.some((f) => f.event.id === e.id));
    assert.equal(nossosFestas[0].id, quente.event.id, "prateleira ordena por procura");

    // SHOWS (1 evento) NÃO vira prateleira; evento cai em upcoming
    const shows = home.shelves.find((s) => s.category === "SHOWS");
    const showsNoRepo = shows?.events.some((e) => e.id === fixtures[4].event.id) ?? false;
    assert.ok(!showsNoRepo, "categoria com 1 evento não ganha prateleira própria");
    assert.ok(
      ids(home.upcoming).includes(fixtures[4].event.id),
      "evento de categoria rala permanece em Próximos",
    );
  } finally {
    for (const f of fixtures) await cleanupFixtureEvent(f.organization.id);
  }
});

test("Em alta honesto: com venda em só 1 evento, a seção não finge popularidade", async () => {
  const catalog = new CatalogService(new OrgAccessService(), new InventoryService());
  const f = await createFixtureEvent({ lotCapacity: 10, priceCents: 1000, feeCents: 0 });
  try {
    await prisma.event.update({ where: { id: f.event.id }, data: { category: "TEATRO" } });
    await fabricateSales(f, 3, new Date());
    const home = await catalog.getHomeSections();
    const soDoTeste = home.highlights.filter((e) => e.id === f.event.id);
    // ou a seção está vazia, ou (se OUTRO evento do banco também vendeu) ela é legítima —
    // mas nunca uma seção de 1 evento só do teste
    if (home.highlights.length > 0) {
      assert.ok(home.highlights.length >= 2, "Em alta nunca aparece com evento único");
    } else {
      assert.equal(soDoTeste.length, 0);
    }
  } finally {
    await cleanupFixtureEvent(f.organization.id);
  }
});
