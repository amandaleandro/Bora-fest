// Virada de lote pela data (revisão 2026-10-13): o lote anterior que passa do
// "Para de vender" sem esgotar abre o seguinte (job do worker, a cada minuto),
// e o cadastro recusa como "anterior" um lote que já parou de vender.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { abrirSeguintesDeLotesVencidos, prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../catalog/catalog.service";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

const HORA = 3_600_000;

test("anterior que passou do 'Para de vender' abre o seguinte; em cadeia, uma rodada por vez; idempotente", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 10 });
  try {
    // o lote da fixture é o 1º: parou de vender há 1 hora, sem esgotar
    await prisma.ticketLot.update({ where: { id: fx.lot.id }, data: { endsAt: new Date(Date.now() - HORA) } });
    const lote = (name: string, activateAfterLotId: string, endsAt?: Date) =>
      prisma.ticketLot.create({
        data: {
          ticketTypeId: fx.ticketType.id,
          name,
          priceCents: 3000,
          feeCents: 300,
          capacity: 10,
          status: "DRAFT",
          activateAfterLotId,
          endsAt,
        },
      });
    // o 2º também já venceu (abre e, na rodada seguinte, abre o 3º)
    const segundo = await lote("2º lote", fx.lot.id, new Date(Date.now() - 1000));
    const terceiro = await lote("3º lote", segundo.id);
    const status = async (id: string) => (await prisma.ticketLot.findUniqueOrThrow({ where: { id } })).status;

    const rodada1 = await abrirSeguintesDeLotesVencidos(prisma);
    assert.deepEqual(rodada1.map((l) => l.id), [segundo.id]);
    assert.equal(await status(segundo.id), "ACTIVE");
    assert.equal(await status(terceiro.id), "DRAFT", "um elo por rodada");

    const rodada2 = await abrirSeguintesDeLotesVencidos(prisma);
    assert.ok(rodada2.some((l) => l.id === terceiro.id));
    assert.equal(await status(terceiro.id), "ACTIVE");

    const rodada3 = await abrirSeguintesDeLotesVencidos(prisma);
    assert.equal(rodada3.filter((l) => [segundo.id, terceiro.id].includes(l.id)).length, 0, "não reabre nada");

    const rastro = await prisma.auditLog.findMany({
      where: { action: "lot.activate", entityId: { in: [segundo.id, terceiro.id] } },
    });
    assert.equal(rastro.length, 2, "um registro por lote aberto");
    assert.ok(rastro.every((r) => (r.metadata as { gatilho?: string }).gatilho === "data"));
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: fx.organization.id } });
    await cleanupFixtureEvent(fx.organization.id);
  }
});

test("anterior ainda dentro da data: o seguinte continua guardado", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 10 });
  try {
    await prisma.ticketLot.update({ where: { id: fx.lot.id }, data: { endsAt: new Date(Date.now() + HORA) } });
    const seguinte = await prisma.ticketLot.create({
      data: {
        ticketTypeId: fx.ticketType.id,
        name: "2º lote",
        priceCents: 3000,
        feeCents: 300,
        capacity: 10,
        status: "DRAFT",
        activateAfterLotId: fx.lot.id,
      },
    });
    const abertos = await abrirSeguintesDeLotesVencidos(prisma);
    assert.ok(!abertos.some((l) => l.id === seguinte.id));
    assert.equal((await prisma.ticketLot.findUniqueOrThrow({ where: { id: seguinte.id } })).status, "DRAFT");
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: fx.organization.id } });
    await cleanupFixtureEvent(fx.organization.id);
  }
});

test("cadastro recusa como 'lote anterior' um lote que já parou de vender pela data", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 10 });
  const dono = await prisma.user.create({ data: { email: `dono-virada-${Date.now()}@borafest.dev` } });
  try {
    await prisma.organizationMember.create({
      data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
    });
    await prisma.ticketLot.update({ where: { id: fx.lot.id }, data: { endsAt: new Date(Date.now() - HORA) } });
    const catalog = new CatalogService(new OrgAccessService(), new InventoryService());
    await assert.rejects(
      () =>
        catalog.createLot(fx.ticketType.id, dono.id, {
          name: "2º lote",
          priceCents: 3000,
          capacity: 10,
          activateAfterLotId: fx.lot.id,
        } as never),
      /parou de vender pela data/,
    );
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: fx.organization.id } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: fx.organization.id } });
    await cleanupFixtureEvent(fx.organization.id);
    await prisma.user.delete({ where: { id: dono.id } }).catch(() => undefined);
  }
});

test("evento que já terminou ou foi cancelado: a virada pela data não abre nada", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 10 });
  try {
    await prisma.ticketLot.update({ where: { id: fx.lot.id }, data: { endsAt: new Date(Date.now() - HORA) } });
    const seguinte = await prisma.ticketLot.create({
      data: {
        ticketTypeId: fx.ticketType.id,
        name: "2º lote",
        priceCents: 3000,
        feeCents: 300,
        capacity: 10,
        status: "DRAFT",
        activateAfterLotId: fx.lot.id,
      },
    });
    for (const dados of [
      { status: "CANCELED" as const },
      { status: "PUBLISHED" as const, startsAt: new Date(Date.now() - 5 * HORA), endsAt: new Date(Date.now() - HORA) },
    ]) {
      await prisma.event.update({ where: { id: fx.event.id }, data: dados });
      const abertos = await abrirSeguintesDeLotesVencidos(prisma);
      assert.ok(!abertos.some((l) => l.id === seguinte.id), `evento ${dados.status} não abre lote`);
    }
    assert.equal((await prisma.ticketLot.findUniqueOrThrow({ where: { id: seguinte.id } })).status, "DRAFT");
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: fx.organization.id } });
    await cleanupFixtureEvent(fx.organization.id);
  }
});
