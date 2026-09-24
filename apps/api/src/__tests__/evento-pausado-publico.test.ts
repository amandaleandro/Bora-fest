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

// Vendas pausadas (2026-09-24): quem já tem o link precisa ver "vendas pausadas",
// não "página não existe" — o detalhe continua servido; lista e home escondem.
test("evento com vendas pausadas: detalhe público responde, listagens escondem", async () => {
  const catalog = new CatalogService(new OrgAccessService(), new InventoryService());
  const fixture = await createFixtureEvent({ lotCapacity: 10, priceCents: 2000, feeCents: 100 });
  try {
    await prisma.event.update({ where: { id: fixture.event.id }, data: { status: "SALES_PAUSED" } });

    const detalhe = await catalog.getPublicEvent(fixture.event.slug);
    assert.equal(detalhe.status, "SALES_PAUSED");
    assert.equal(detalhe.slug, fixture.event.slug);

    const lista = await catalog.listPublicEvents({ page: 1, pageSize: 50 });
    assert.equal(lista.events.some((e) => e.slug === fixture.event.slug), false, "lista pública não mostra pausado");

    const home = await catalog.getHomeSections();
    const naHome = [...home.highlights, ...home.upcoming, ...home.shelves.flatMap((s) => s.events)];
    assert.equal(naHome.some((e) => e.slug === fixture.event.slug), false, "home não mostra pausado");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
