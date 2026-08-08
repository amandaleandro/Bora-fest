import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../catalog/catalog.service";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

test("público vê o nome comercial e os campos estruturados; nome civil não trafega", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 249 });
  try {
    const member = await prisma.user.create({
      data: { email: `id-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });
    await prisma.organizationMember.create({
      data: {
        organizationId: fixture.organization.id,
        userId: member.id,
        roleId: fixture.ownerRoleId,
        status: "ACTIVE",
      },
    });

    // produtor define o nome comercial via serviço (mesmo caminho do PATCH)
    const orgs = new OrganizationsService(new OrgAccessService());
    const updated = await orgs.update(fixture.organization.id, member.id, {
      displayName: "Atlética Fantasma",
    });
    assert.equal(updated.displayName, "Atlética Fantasma");

    await prisma.event.update({
      where: { id: fixture.event.id },
      data: {
        lineup: "DJ Alok\nBanda XPTO",
        amenities: "Open bar até 22h\nCopo oficial",
        minAge: 18,
      },
    });

    const catalog = new CatalogService(new OrgAccessService(), new InventoryService());
    const pub = await catalog.getPublicEvent(fixture.event.slug);
    assert.equal(pub.organization.name, "Atlética Fantasma", "público vê o nome comercial");
    assert.ok(!("displayName" in pub.organization), "campo interno não trafega");
    assert.equal(pub.lineup, "DJ Alok\nBanda XPTO");
    assert.equal(pub.amenities, "Open bar até 22h\nCopo oficial");
    assert.equal(pub.minAge, 18);

    // sem nome comercial, cai no nome cadastral (comportamento antigo)
    await orgs.update(fixture.organization.id, member.id, { displayName: null });
    const semNome = await catalog.getPublicEvent(fixture.event.slug);
    assert.equal(semNome.organization.name, fixture.organization.name);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
