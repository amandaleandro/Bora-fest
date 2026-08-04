import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { EventsService } from "../events/events.service";
import { DashboardService } from "../dashboard/dashboard.service";
import { OrgAccessService } from "../common/org-access.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

test("local do evento: cria inline, reaproveita por nome+cidade e sai no dashboard", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5 });
  try {
    const member = await prisma.user.create({
      data: { email: `local-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });
    await prisma.organizationMember.create({
      data: {
        organizationId: fixture.organization.id,
        userId: member.id,
        roleId: fixture.ownerRoleId,
        status: "ACTIVE",
      },
    });

    const events = new EventsService(new OrgAccessService());

    // criação com local inline
    const created = await events.create(fixture.organization.id, member.id, {
      title: "Festa com Local",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 90_000_000).toISOString(),
      timezone: "America/Sao_Paulo",
      venue: { name: "Armazém 77", address: "Rua das Docas, 77", city: "Santos", state: "sp" },
    } as any);
    assert.ok(created.venueId, "evento nasce vinculado a um local");
    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: created.venueId! } });
    assert.equal(venue.city, "Santos");
    assert.equal(venue.state, "SP", "UF normalizada para maiúsculas");

    // edição do mesmo local (nome+cidade iguais) NÃO duplica — atualiza
    await events.update(created.id, member.id, {
      venue: { name: "Armazém 77", address: "Rua das Docas, 90", city: "Santos", state: "SP" },
    } as any);
    const count = await prisma.venue.count({
      where: { organizationId: fixture.organization.id, name: "Armazém 77" },
    });
    assert.equal(count, 1, "mesmo lugar editado não vira local duplicado");
    const updated = await prisma.venue.findUniqueOrThrow({ where: { id: created.venueId! } });
    assert.equal(updated.address, "Rua das Docas, 90");

    // dashboard devolve bannerUrl e o local (fix do banner sumindo no F5)
    const dashboards = new DashboardService(new OrgAccessService());
    const dash = await dashboards.getDashboard(created.id, member.id);
    assert.equal((dash.event as any).venue.name, "Armazém 77");
    assert.ok("bannerUrl" in dash.event, "payload traz bannerUrl (mesmo que null)");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
