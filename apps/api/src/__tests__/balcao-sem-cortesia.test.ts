import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../catalog/catalog.service";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// SÓ BALCÃO PRECISA DE PREÇO (2026-10-12): desde 07/09 cortesia não sai na
// porta — o balcão esconde lote grátis e a venda recusa R$ 0. O painel ainda
// dizia "com R$ 0 vira lote de cortesia" e o servidor aceitava criar o lote,
// que nascia morto (some do site e não aparece na porta). Agora a criação
// recusa e aponta a lista de convidados; o resto da regra não muda.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 0, feeCents: 0 });
  const dono = await prisma.user.create({ data: { email: `dono-balcao-${rand()}@borafest.dev` } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  const catalog = new CatalogService(new OrgAccessService(), new InventoryService());
  return { fx, dono, catalog };
}

async function desmontar(ctx: Awaited<ReturnType<typeof montar>>) {
  await prisma.organizationMember.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  await cleanupFixtureEvent(ctx.fx.organization.id);
  await prisma.user.delete({ where: { id: ctx.dono.id } }).catch(() => undefined);
}

function criarLote(ctx: Awaited<ReturnType<typeof montar>>, extra: Record<string, unknown>) {
  return ctx.catalog.createLot(ctx.fx.ticketType.id, ctx.dono.id, {
    name: `Lote ${rand()}`,
    priceCents: 0,
    feeCents: 0,
    capacity: 10,
    maxPerOrder: 6,
    ...extra,
  } as never);
}

test("lote só de balcão com R$ 0 é recusado e aponta a lista de convidados", async () => {
  const ctx = await montar();
  try {
    const nome = `Balcao gratis ${rand()}`;
    await assert.rejects(criarLote(ctx, { name: nome, priceCents: 0, pdvOnly: true }), /Lista de convidados/);
    const gravados = await prisma.ticketLot.count({ where: { ticketTypeId: ctx.fx.ticketType.id, name: nome } });
    assert.equal(gravados, 0, "o lote recusado não foi gravado");
  } finally {
    await desmontar(ctx);
  }
});

test("o resto continua igual: balcão pago passa, R$ 0 no site passa, duas restrições seguem recusadas", async () => {
  const ctx = await montar();
  try {
    const balcao = await criarLote(ctx, { priceCents: 300, pdvOnly: true });
    assert.equal(balcao.pdvOnly, true, "balcão com preço continua valendo (na porta tem dinheiro)");

    const gratisNoSite = await criarLote(ctx, { priceCents: 0 });
    assert.equal(gratisNoSite.priceCents, 0, "lote grátis que aparece no site continua permitido");
    assert.equal(gratisNoSite.pdvOnly, false);

    // a checagem de "uma restrição só" vem antes: a mensagem dela não muda
    await assert.rejects(criarLote(ctx, { pdvOnly: true, inviteMode: "LINK" }), /só uma forma/);
  } finally {
    await desmontar(ctx);
  }
});
