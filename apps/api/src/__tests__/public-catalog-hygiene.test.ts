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

test("catálogo público: busca por produtor/atração e exclui organização de homologação em todas as vitrines", async () => {
  const catalog = new CatalogService(new OrgAccessService(), new InventoryService());
  const publicFixture = await createFixtureEvent({ lotCapacity: 20, priceCents: 2000, feeCents: 0 });
  const hiddenFixture = await createFixtureEvent({ lotCapacity: 20, priceCents: 2000, feeCents: 0 });
  const previousExcluded = process.env.PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS;

  try {
    await prisma.organization.update({
      where: { id: publicFixture.organization.id },
      data: { displayName: "Casa Aurora" },
    });
    await prisma.event.update({
      where: { id: publicFixture.event.id },
      data: {
        title: "Noite Principal",
        lineup: "DJ Nebula\nBanda Horizonte",
        category: "FESTAS",
      },
    });
    const venue = await prisma.venue.create({
      data: {
        organizationId: publicFixture.organization.id,
        name: "Galpão Central",
        city: "Uberlândia",
        state: "MG",
      },
    });
    await prisma.event.update({
      where: { id: publicFixture.event.id },
      data: { venueId: venue.id },
    });

    process.env.PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS = hiddenFixture.organization.slug;

    const byProducer = await catalog.listPublicEvents({
      page: 1,
      pageSize: 20,
      query: "Casa Aurora",
    });
    assert.ok(
      byProducer.events.some((event) => event.id === publicFixture.event.id),
      "busca deve encontrar evento pelo nome comercial do produtor/Casa",
    );

    const byLineup = await catalog.listPublicEvents({
      page: 1,
      pageSize: 20,
      query: "DJ Nebula",
    });
    assert.ok(
      byLineup.events.some((event) => event.id === publicFixture.event.id),
      "busca deve encontrar evento por atração/line-up",
    );

    const listing = await catalog.listPublicEvents({ page: 1, pageSize: 50 });
    assert.ok(
      !listing.events.some((event) => event.id === hiddenFixture.event.id),
      "organização de homologação não aparece na lista pública",
    );

    const home = await catalog.getHomeSections();
    const homeIds = [
      ...home.highlights,
      ...home.upcoming,
      ...home.shelves.flatMap((shelf) => shelf.events),
    ].map((event) => event.id);
    assert.ok(!homeIds.includes(hiddenFixture.event.id), "homologação não aparece na home");

    await assert.rejects(
      () => catalog.getPublicEvent(hiddenFixture.event.slug),
      /Evento não encontrado/,
      "URL direta também deve esconder evento da organização de homologação",
    );

    const cities = await catalog.listPublicCities();
    assert.ok(
      cities.some((item) => item.city === "Uberlândia" && item.state === "MG"),
      "cidade do evento público continua disponível",
    );
  } finally {
    if (previousExcluded === undefined) delete process.env.PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS;
    else process.env.PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS = previousExcluded;
    await cleanupFixtureEvent(publicFixture.organization.id);
    await cleanupFixtureEvent(hiddenFixture.organization.id);
  }
});
