import { after, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { EventRecurrenceService } from "../events/event-recurrence.service";
import { EventsService } from "../events/events.service";
import { OrgAccessService } from "../common/org-access.service";
import { IdempotencyService } from "../common/idempotency.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

// FRENTE SERVIDOR (2026-10-12):
// (1) "Duplicar evento" e "Próxima edição" com clique duplo criavam DUAS
//     edições. Com o cabeçalho Idempotency-Key (padrão da venda na porta), a
//     mesma chave + o mesmo corpo devolvem a MESMA edição; corpo diferente com
//     a mesma chave é recusado; a chamada que chega no meio da 1ª recebe 409.
// (2) Criar evento grava "event.create" na auditoria, na mesma transação.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);
const DIA = 86_400_000;

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 10 });
  const dono = await prisma.user.create({ data: { email: `dono-edicao-${rand()}@borafest.dev` } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  return {
    fx,
    dono,
    recurrence: new EventRecurrenceService(new OrgAccessService(), new IdempotencyService()),
    events: new EventsService(new OrgAccessService()),
  };
}

type Ctx = Awaited<ReturnType<typeof montar>>;

/** Edições criadas a partir do evento da fixture (as cópias). */
async function copias(ctx: Ctx): Promise<string[]> {
  const linhas = await prisma.event.findMany({
    where: { organizationId: ctx.fx.organization.id, id: { not: ctx.fx.event.id } },
    select: { id: true },
  });
  return linhas.map((l) => l.id);
}

async function desmontar(ctx: Ctx) {
  const organizationId = ctx.fx.organization.id;
  const outros = await copias(ctx);
  // as cópias saem antes: o cleanup do helper só limpa o PRIMEIRO evento que achar
  await prisma.eventAddOn.deleteMany({ where: { eventId: { in: outros } } });
  await prisma.ticketLot.deleteMany({ where: { ticketType: { eventId: { in: outros } } } });
  await prisma.ticketType.deleteMany({ where: { eventId: { in: outros } } });
  await prisma.event.deleteMany({ where: { id: { in: outros } } });
  await prisma.idempotencyKey.deleteMany({
    where: {
      OR: [
        { scope: `event-duplicate:${ctx.fx.event.id}:${ctx.dono.id}` },
        { scope: `event-next-edition:${ctx.fx.event.id}:${ctx.dono.id}` },
      ],
    },
  });
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.organizationMember.deleteMany({ where: { organizationId } });
  await cleanupFixtureEvent(organizationId);
  await prisma.user.delete({ where: { id: ctx.dono.id } }).catch(() => undefined);
}

function corpoDaCopia(ctx: Ctx, dias: number, title = "Edição especial") {
  return {
    startsAt: new Date(ctx.fx.event.startsAt.getTime() + dias * DIA).toISOString(),
    endsAt: new Date(ctx.fx.event.endsAt.getTime() + dias * DIA).toISOString(),
    title,
    copyTicketCatalog: true,
  };
}

test("duplicar com a mesma chave duas vezes devolve a MESMA edição e cria uma só", async () => {
  const ctx = await montar();
  try {
    const chave = `dup-${rand()}`;
    const corpo = corpoDaCopia(ctx, 21);
    const primeira = await ctx.recurrence.duplicate(ctx.fx.event.id, ctx.dono.id, corpo, chave);
    const segunda = await ctx.recurrence.duplicate(ctx.fx.event.id, ctx.dono.id, corpo, chave);

    assert.equal(segunda.id, primeira.id, "o 2º clique recebe a edição do 1º");
    assert.deepEqual(await copias(ctx), [primeira.id], "uma edição só no banco");
    assert.equal(
      await prisma.auditLog.count({ where: { action: "event.duplicate", entityId: primeira.id } }),
      1,
      "um registro só na auditoria",
    );
    // o catálogo foi copiado UMA vez
    assert.equal(await prisma.ticketType.count({ where: { eventId: primeira.id } }), 1);

    // mesma chave, corpo diferente: recusa clara, nada novo
    await assert.rejects(
      () => ctx.recurrence.duplicate(ctx.fx.event.id, ctx.dono.id, corpoDaCopia(ctx, 28, "Outra edição"), chave),
      (error: any) => error.status === 422,
    );
    assert.equal((await copias(ctx)).length, 1);
  } finally {
    await desmontar(ctx);
  }
});

test("dois cliques ao mesmo tempo com a mesma chave: uma edição só", async () => {
  const ctx = await montar();
  try {
    const chave = `dup-junto-${rand()}`;
    const corpo = corpoDaCopia(ctx, 35);
    const resultados = await Promise.allSettled([
      ctx.recurrence.duplicate(ctx.fx.event.id, ctx.dono.id, corpo, chave),
      ctx.recurrence.duplicate(ctx.fx.event.id, ctx.dono.id, corpo, chave),
    ]);

    const criadas = await copias(ctx);
    assert.equal(criadas.length, 1, "o clique duplo não cria duas edições");
    for (const r of resultados) {
      if (r.status === "fulfilled") {
        assert.equal(r.value.id, criadas[0], "quem recebeu resposta recebeu a edição que existe");
      } else {
        // chegou enquanto a 1ª ainda copiava: 409 "ainda em processamento"
        assert.equal((r.reason as any).status, 409);
      }
    }
    assert.ok(resultados.some((r) => r.status === "fulfilled"), "pelo menos um clique termina bem");
  } finally {
    await desmontar(ctx);
  }
});

test("próxima edição com a mesma chave: a mesma edição; sem chave segue como antes", async () => {
  const ctx = await montar();
  try {
    const chave = `prox-${rand()}`;
    const corpo = { cadenceDays: 7, copyTicketCatalog: false };
    const primeira = await ctx.recurrence.nextEdition(ctx.fx.event.id, ctx.dono.id, corpo, chave);
    const segunda = await ctx.recurrence.nextEdition(ctx.fx.event.id, ctx.dono.id, corpo, chave);
    assert.equal(segunda.id, primeira.id);
    assert.deepEqual(await copias(ctx), [primeira.id]);

    // a chave da próxima edição não serve para o duplicar (cada rota tem a sua)
    const duplicada = await ctx.recurrence.duplicate(ctx.fx.event.id, ctx.dono.id, corpoDaCopia(ctx, 14), chave);
    assert.notEqual(duplicada.id, primeira.id);

    // sem o cabeçalho: comportamento de antes (cada chamada cria uma edição) —
    // a proteção depende de a tela mandar a chave
    await ctx.recurrence.nextEdition(ctx.fx.event.id, ctx.dono.id, { cadenceDays: 14, copyTicketCatalog: false });
    await ctx.recurrence.nextEdition(ctx.fx.event.id, ctx.dono.id, { cadenceDays: 14, copyTicketCatalog: false });
    assert.equal((await copias(ctx)).length, 4);
  } finally {
    await desmontar(ctx);
  }
});

test("falha não prende a chave: sem permissão recusa, e a mesma chave funciona para quem pode", async () => {
  const ctx = await montar();
  const estranho = await prisma.user.create({ data: { email: `estranho-${rand()}@borafest.dev` } });
  try {
    const chave = `dup-falha-${rand()}`;
    const corpo = corpoDaCopia(ctx, 42);
    await assert.rejects(() => ctx.recurrence.duplicate(ctx.fx.event.id, estranho.id, corpo, chave));
    assert.equal((await copias(ctx)).length, 0, "quem não pode não cria nada");
    assert.equal(
      await prisma.idempotencyKey.count({ where: { scope: `event-duplicate:${ctx.fx.event.id}:${estranho.id}` } }),
      0,
      "a falha libera a chave",
    );
    const ok = await ctx.recurrence.duplicate(ctx.fx.event.id, ctx.dono.id, corpo, chave);
    assert.deepEqual(await copias(ctx), [ok.id]);
  } finally {
    await prisma.idempotencyKey.deleteMany({ where: { scope: `event-duplicate:${ctx.fx.event.id}:${estranho.id}` } });
    await desmontar(ctx);
    await prisma.user.delete({ where: { id: estranho.id } }).catch(() => undefined);
  }
});

test("criar evento grava event.create na auditoria, com quem criou", async () => {
  const ctx = await montar();
  try {
    const titulo = `Festa nova ${rand()}`;
    const criado = await ctx.events.create(ctx.fx.organization.id, ctx.dono.id, {
      title: titulo,
      category: "FESTAS",
      startsAt: new Date(Date.now() + 10 * DIA).toISOString(),
      endsAt: new Date(Date.now() + 10 * DIA + 6 * 3_600_000).toISOString(),
      timezone: "America/Sao_Paulo",
    });

    const registros = await prisma.auditLog.findMany({ where: { action: "event.create", entityId: criado.id } });
    assert.equal(registros.length, 1);
    const [registro] = registros;
    assert.equal(registro.actorUserId, ctx.dono.id);
    assert.equal(registro.organizationId, ctx.fx.organization.id);
    assert.equal(registro.entityType, "event");
    const metadata = registro.metadata as Record<string, unknown>;
    assert.equal(metadata.title, titulo);
    assert.equal(metadata.slug, criado.slug);

    // sem permissão: nem evento, nem registro
    const estranho = await prisma.user.create({ data: { email: `estranho-criar-${rand()}@borafest.dev` } });
    try {
      const antes = await prisma.auditLog.count({ where: { action: "event.create", organizationId: ctx.fx.organization.id } });
      await assert.rejects(() =>
        ctx.events.create(ctx.fx.organization.id, estranho.id, {
          title: `Não pode ${rand()}`,
          category: "FESTAS",
          startsAt: new Date(Date.now() + 10 * DIA).toISOString(),
          endsAt: new Date(Date.now() + 11 * DIA).toISOString(),
          timezone: "America/Sao_Paulo",
        }),
      );
      assert.equal(
        await prisma.auditLog.count({ where: { action: "event.create", organizationId: ctx.fx.organization.id } }),
        antes,
      );
    } finally {
      await prisma.user.delete({ where: { id: estranho.id } }).catch(() => undefined);
    }
  } finally {
    await desmontar(ctx);
  }
});
