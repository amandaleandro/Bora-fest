import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { OrganizationsService } from "../organizations/organizations.service";
import { OrgAccessService } from "../common/org-access.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

test("incidente Amanda: convidar e-mail de membro ATIVO nunca rebaixa papel nem status", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  const orgs = new OrganizationsService(new OrgAccessService());
  const email = `dona-${Math.random().toString(36).slice(2, 8)}@borafest.dev`;
  try {
    const dona = await prisma.user.create({ data: { email } });
    await prisma.organizationMember.create({
      data: {
        organizationId: f.organization.id,
        userId: dona.id,
        roleId: f.ownerRoleId,
        status: "ACTIVE",
      },
    });

    // dona convida o PRÓPRIO e-mail como vendedora (o cenário do incidente)
    await assert.rejects(
      () => orgs.inviteMember(f.organization.id, dona.id, { email, roleKey: "seller" } as never),
      /já é membro/,
    );

    // papel e status intocados — edição continua funcionando
    const membership = await prisma.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: f.organization.id, userId: dona.id } },
      include: { role: true },
    });
    assert.equal(membership.role.key, "owner", "papel preservado");
    assert.equal(membership.status, "ACTIVE", "status preservado");
    await new OrgAccessService().assertPermission(f.organization.id, dona.id, "event:create" as never);

    // convite idempotente do MESMO papel não derruba ninguém
    const outra = await prisma.user.create({
      data: { email: `outra-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });
    await prisma.organizationMember.create({
      data: { organizationId: f.organization.id, userId: outra.id, roleId: f.ownerRoleId, status: "ACTIVE" },
    });
    const denovo = await orgs.inviteMember(f.organization.id, dona.id, {
      email: outra.email!,
      roleKey: "owner",
    } as never);
    assert.equal(denovo.status, "ACTIVE", "mesmo papel = intocado");
  } finally {
    await cleanupFixtureEvent(f.organization.id);
    await prisma.user.deleteMany({ where: { email } });
  }
});
