import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { EventsService } from "../events/events.service";
import { OrgAccessService } from "../common/org-access.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

test("janela de vendas: não publica nem republica evento vencido e protege PATCH parcial de datas", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5 });
  const owner = await prisma.user.create({
    data: { email: `sales-window-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
  });

  try {
    await prisma.organizationMember.create({
      data: {
        organizationId: fixture.organization.id,
        userId: owner.id,
        roleId: fixture.ownerRoleId,
        status: "ACTIVE",
      },
    });

    const events = new EventsService(new OrgAccessService());
    const passado = new Date(Date.now() - 3_600_000);
    const antesDoPassado = new Date(Date.now() - 7_200_000);

    const draftVencido = await prisma.event.create({
      data: {
        organizationId: fixture.organization.id,
        title: "Draft vencido",
        slug: `draft-vencido-${Math.random().toString(36).slice(2, 8)}`,
        status: "DRAFT",
        startsAt: antesDoPassado,
        endsAt: passado,
        timezone: "America/Sao_Paulo",
      },
    });

    await assert.rejects(
      () => events.publish(draftVencido.id, owner.id),
      /Atualize a data do evento antes de abrir as vendas/,
      "evento vencido em DRAFT não pode ser publicado",
    );

    const pausadoVencido = await prisma.event.create({
      data: {
        organizationId: fixture.organization.id,
        title: "Pausado vencido",
        slug: `pausado-vencido-${Math.random().toString(36).slice(2, 8)}`,
        status: "SALES_PAUSED",
        startsAt: antesDoPassado,
        endsAt: passado,
        timezone: "America/Sao_Paulo",
      },
    });

    await assert.rejects(
      () => events.republish(pausadoVencido.id, owner.id),
      /Atualize a data do evento antes de abrir as vendas/,
      "evento vencido com vendas pausadas não pode ser reaberto",
    );

    const futuro = await prisma.event.create({
      data: {
        organizationId: fixture.organization.id,
        title: "Evento futuro",
        slug: `evento-futuro-${Math.random().toString(36).slice(2, 8)}`,
        status: "DRAFT",
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 90_000_000),
        timezone: "America/Sao_Paulo",
      },
    });

    await assert.rejects(
      () =>
        events.update(futuro.id, owner.id, {
          startsAt: new Date(Date.now() + 100_000_000).toISOString(),
        } as any),
      /O término do evento precisa ser posterior ao início/,
      "alterar apenas startsAt também precisa comparar com endsAt persistido",
    );

    const publicado = await events.publish(futuro.id, owner.id);
    assert.equal(publicado.status, "PUBLISHED", "evento futuro válido continua publicando normalmente");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
    await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  }
});
