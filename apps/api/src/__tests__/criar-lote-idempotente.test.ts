// Criar lote com Idempotency-Key (revisão 2026-10-13): a resposta que se perde
// e o "Tentar novamente" do painel não criam um 2º lote já à venda.
import "reflect-metadata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogController } from "../catalog/catalog.controller";
import { CatalogService } from "../catalog/catalog.service";
import { IdempotencyService } from "../common/idempotency.service";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

test("mesma chave e mesmo corpo: um lote só, e as duas respostas são o mesmo lote", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 10 });
  const dono = await prisma.user.create({ data: { email: `dono-idem-${Date.now()}@borafest.dev` } });
  const chave = `teste-lote-${Date.now()}`;
  try {
    await prisma.organizationMember.create({
      data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
    });
    const controller = new CatalogController(
      new CatalogService(new OrgAccessService(), new InventoryService()),
      new IdempotencyService(),
    );
    const corpo = { name: "2º lote", priceCents: 3000, feeCents: 300, capacity: 10, activateNow: true };
    const primeira = (await controller.createLot(fx.ticketType.id, dono.id, corpo, chave)) as { id: string };
    const repetida = (await controller.createLot(fx.ticketType.id, dono.id, corpo, chave)) as { id: string };
    assert.equal(repetida.id, primeira.id, "a repetição devolve o lote já criado");
    assert.equal(await prisma.ticketLot.count({ where: { ticketTypeId: fx.ticketType.id, name: "2º lote" } }), 1);

    // mesma chave com dados diferentes é recusada (não cria nem devolve outro)
    await assert.rejects(() => controller.createLot(fx.ticketType.id, dono.id, { ...corpo, capacity: 20 }, chave));
    assert.equal(await prisma.ticketLot.count({ where: { ticketTypeId: fx.ticketType.id, name: "2º lote" } }), 1);
  } finally {
    await prisma.idempotencyKey.deleteMany({ where: { key: { endsWith: chave } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: fx.organization.id } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: fx.organization.id } });
    await cleanupFixtureEvent(fx.organization.id);
    await prisma.user.delete({ where: { id: dono.id } }).catch(() => undefined);
  }
});
