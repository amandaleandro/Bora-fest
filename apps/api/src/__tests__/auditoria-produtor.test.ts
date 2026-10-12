import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { OrgAccessService } from "../common/org-access.service";
import { EventsService } from "../events/events.service";
import { CatalogService } from "../catalog/catalog.service";
import { InventoryService } from "../inventory/inventory.service";
import { alteracoesDoEvento } from "../common/auditoria-produtor";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Rastro das ações do produtor (2026-10-12): publicar, pausar, reabrir e editar
// evento, e criar, ativar, encerrar e apagar lote não gravavam nada na
// auditoria. Numa disputa ("quem fechou o lote?", "quem mudou a data?") não
// havia como provar. Cada ação grava ator, organização, ação, entidade e o que
// mudou — e o segredo (token do CAPI, código do convite) nunca vai junto.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 20, priceCents: 3000, feeCents: 300 });
  const dono = await prisma.user.create({ data: { email: `dono-${rand()}@borafest.dev` } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  const events = new EventsService(new OrgAccessService());
  const catalog = new CatalogService(new OrgAccessService(), new InventoryService());
  return { fx, dono, events, catalog };
}

type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx) {
  const organizationId = ctx.fx.organization.id;
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.organizationMember.deleteMany({ where: { organizationId } });
  await cleanupFixtureEvent(organizationId);
  await prisma.user.delete({ where: { id: ctx.dono.id } }).catch(() => undefined);
}

function registros(entityId: string, action: string) {
  return prisma.auditLog.findMany({ where: { entityId, action }, orderBy: { createdAt: "asc" } });
}

test("publicar, pausar e reabrir vendas gravam quem fez e de qual estado para qual", async () => {
  const ctx = await montar();
  try {
    const eventId = ctx.fx.event.id;
    await prisma.event.update({ where: { id: eventId }, data: { status: "DRAFT", publishedAt: null } });

    await ctx.events.publish(eventId, ctx.dono.id);
    const [publicou] = await registros(eventId, "event.publish");
    assert.ok(publicou, "publicar fica na auditoria");
    assert.equal(publicou.actorUserId, ctx.dono.id);
    assert.equal(publicou.organizationId, ctx.fx.organization.id);
    assert.equal(publicou.entityType, "event");
    assert.deepEqual(publicou.metadata, { de: "DRAFT", para: "PUBLISHED" });

    // clicar de novo em Publicar não muda nada e não suja o histórico
    await ctx.events.publish(eventId, ctx.dono.id);
    assert.equal((await registros(eventId, "event.publish")).length, 1);

    await ctx.events.unpublish(eventId, ctx.dono.id);
    const [pausou] = await registros(eventId, "event.pause");
    assert.ok(pausou, "pausar fica na auditoria");
    assert.equal(pausou.actorUserId, ctx.dono.id);
    assert.deepEqual(pausou.metadata, { de: "PUBLISHED", para: "SALES_PAUSED" });

    await ctx.events.republish(eventId, ctx.dono.id);
    const [reabriu] = await registros(eventId, "event.republish");
    assert.ok(reabriu, "reabrir vendas fica na auditoria");
    assert.deepEqual(reabriu.metadata, { de: "SALES_PAUSED", para: "PUBLISHED" });
  } finally {
    await desmontar(ctx);
  }
});

test("editar o evento grava os campos mudados com antes e depois; segredo e texto longo só marcam", async () => {
  const ctx = await montar();
  try {
    const eventId = ctx.fx.event.id;
    const tituloAntigo = ctx.fx.event.title;
    // meia hora depois: segue antes do fim do evento da fixture
    const novaData = new Date(ctx.fx.event.startsAt.getTime() + 30 * 60_000);
    const segredo = `capi-${rand()}-segredo`;
    const descricao = `Descrição nova ${rand()}`;

    await ctx.events.update(eventId, ctx.dono.id, {
      title: "Título novo",
      startsAt: novaData.toISOString(),
      metaCapiToken: segredo,
      description: descricao,
    });

    const [editou] = await registros(eventId, "event.update");
    assert.ok(editou, "editar fica na auditoria");
    assert.equal(editou.actorUserId, ctx.dono.id);
    assert.equal(editou.organizationId, ctx.fx.organization.id);
    const meta = editou.metadata as unknown as {
      campos: string[];
      antes: Record<string, unknown>;
      depois: Record<string, unknown>;
    };
    for (const campo of ["title", "startsAt", "metaCapiToken", "description"]) {
      assert.ok(meta.campos.includes(campo), `campo ${campo} registrado como mudado`);
    }
    assert.equal(meta.antes.title, tituloAntigo);
    assert.equal(meta.depois.title, "Título novo");
    assert.equal(meta.antes.startsAt, ctx.fx.event.startsAt.toISOString());
    assert.equal(meta.depois.startsAt, novaData.toISOString());
    const texto = JSON.stringify(editou.metadata);
    assert.ok(!texto.includes(segredo), "o token do CAPI nunca vai para a auditoria");
    assert.ok(!texto.includes(descricao), "texto longo só marca que mudou");

    // salvar de novo sem mudar nada não cria outro registro
    await ctx.events.update(eventId, ctx.dono.id, {
      title: "Título novo",
      startsAt: novaData.toISOString(),
      metaCapiToken: segredo,
      description: descricao,
    });
    assert.equal((await registros(eventId, "event.update")).length, 1);
  } finally {
    await desmontar(ctx);
  }
});

test("criar, ativar, encerrar e apagar lote deixam rastro — e o código do convite não vaza", async () => {
  const ctx = await montar();
  try {
    const lote = await ctx.catalog.createLot(ctx.fx.ticketType.id, ctx.dono.id, {
      name: "Lote convidados",
      priceCents: 3000,
      capacity: 10,
      maxPerOrder: 4,
      inviteMode: "LINK",
    } as never);
    const [criou] = await registros(lote.id, "lot.create");
    assert.ok(criou, "criar lote fica na auditoria");
    assert.equal(criou.actorUserId, ctx.dono.id);
    assert.equal(criou.organizationId, ctx.fx.organization.id);
    assert.equal(criou.entityType, "ticket_lot");
    const meta = criou.metadata as Record<string, unknown>;
    assert.equal(meta.eventId, ctx.fx.event.id);
    assert.equal(meta.name, "Lote convidados");
    assert.equal(meta.priceCents, 3000);
    assert.equal(meta.capacity, 10);
    assert.equal(meta.inviteMode, "LINK");
    assert.ok(lote.inviteToken, "o lote por link tem código");
    assert.ok(!JSON.stringify(criou.metadata).includes(lote.inviteToken!), "o código do convite não vai para o histórico");

    await ctx.catalog.activateLot(lote.id, ctx.dono.id);
    const [ativou] = await registros(lote.id, "lot.activate");
    assert.ok(ativou, "ativar lote fica na auditoria");
    assert.equal(ativou.actorUserId, ctx.dono.id);
    assert.equal((ativou.metadata as Record<string, unknown>).de, "DRAFT");
    assert.equal((ativou.metadata as Record<string, unknown>).para, "ACTIVE");

    await ctx.catalog.closeLot(lote.id, ctx.dono.id);
    const [fechou] = await registros(lote.id, "lot.close");
    assert.ok(fechou, "encerrar lote fica na auditoria — 'quem fechou o lote?'");
    assert.equal(fechou.actorUserId, ctx.dono.id);
    assert.equal((fechou.metadata as Record<string, unknown>).de, "ACTIVE");
    assert.equal((fechou.metadata as Record<string, unknown>).para, "CLOSED");

    const avulso = await ctx.catalog.createLot(ctx.fx.ticketType.id, ctx.dono.id, {
      name: "Lote apagável",
      priceCents: 2500,
      capacity: 5,
      maxPerOrder: 2,
    } as never);
    await ctx.catalog.deleteLot(avulso.id, ctx.dono.id);
    assert.equal(await prisma.ticketLot.count({ where: { id: avulso.id } }), 0, "lote apagado");
    const [apagou] = await registros(avulso.id, "lot.delete");
    assert.ok(apagou, "apagar lote fica na auditoria");
    assert.equal(apagou.actorUserId, ctx.dono.id);
    assert.equal((apagou.metadata as Record<string, unknown>).name, "Lote apagável", "o registro guarda o que o lote era");
  } finally {
    await desmontar(ctx);
  }
});

test("apagar recusado (lote com venda) não deixa registro de apagado", async () => {
  const ctx = await montar();
  try {
    await prisma.ticketLot.update({ where: { id: ctx.fx.lot.id }, data: { soldCount: 1 } });
    await assert.rejects(() => ctx.catalog.deleteLot(ctx.fx.lot.id, ctx.dono.id), /encerre as vendas/);
    assert.equal((await registros(ctx.fx.lot.id, "lot.delete")).length, 0);
  } finally {
    await desmontar(ctx);
  }
});

test("alteracoesDoEvento: mesma data em outro objeto, null e ausente não contam como mudança", () => {
  const data = new Date("2026-12-01T22:00:00.000Z");
  const antes = {
    title: "Festa",
    startsAt: data,
    category: null,
    pixelSettings: { metaPixelId: "123" },
    metaCapiToken: "velho",
  };
  const igual = alteracoesDoEvento(antes, {
    ...antes,
    startsAt: new Date(data.getTime()),
    category: undefined,
    pixelSettings: { metaPixelId: "123" },
  });
  assert.deepEqual(igual.campos, []);

  const mudou = alteracoesDoEvento(antes, { ...antes, metaCapiToken: "novo", pixelSettings: { metaPixelId: "456" } });
  assert.deepEqual(mudou.campos.sort(), ["metaCapiToken", "pixelSettings"]);
  assert.deepEqual(mudou.antes, {}, "segredo e pixels só marcam que mudaram");
  assert.deepEqual(mudou.depois, {});
});
