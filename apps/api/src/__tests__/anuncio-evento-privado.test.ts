import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { registerEmailSender, type EmailMessage } from "@borafest/notifications";
import { OrgAccessService } from "../common/org-access.service";
import { EventsService } from "../events/events.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Anúncio aos seguidores uma vez só (2026-10-11): evento privado não é
// anunciado ao publicar; quando vira público, quem segue a Casa recebe o aviso
// UMA vez. A marca followersNotifiedAt impede reenvio — ligar e desligar a
// chave "privado", publicar de novo ou dois salvamentos ao mesmo tempo nunca
// mandam o mesmo e-mail duas vezes.

after(async () => {
  await closeRedisConnection();
});

const sentEmails: EmailMessage[] = [];
registerEmailSender({
  provider: "capture",
  async send(message) {
    sentEmails.push(message);
  },
});
process.env.EMAIL_PROVIDER = "capture";

const rand = () => Math.random().toString(36).slice(2, 10);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 5 });
  const dono = await prisma.user.create({ data: { email: `dono-${rand()}@borafest.dev` } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  const seguidor = await prisma.user.create({ data: { email: `seguidor-${rand()}@borafest.dev` } });
  await prisma.organizationFollow.create({ data: { organizationId: fx.organization.id, userId: seguidor.id } });
  const events = new EventsService(new OrgAccessService());
  return { fx, dono, seguidor, events, eventos: [] as string[] };
}

type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx) {
  const organizationId = ctx.fx.organization.id;
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  // os eventos do teste saem primeiro: o cleanup do helper limpa os ingressos
  // só do PRIMEIRO evento que achar na organização (o da fixture)
  await prisma.event.deleteMany({ where: { id: { in: ctx.eventos } } });
  await prisma.organizationFollow.deleteMany({ where: { organizationId } });
  await prisma.organizationMember.deleteMany({ where: { organizationId } });
  await cleanupFixtureEvent(organizationId);
  await prisma.user.deleteMany({ where: { id: { in: [ctx.dono.id, ctx.seguidor.id] } } });
}

/** Rascunho novo da Casa (sem marca de "já avisado"), já privado se pedido. */
async function rascunho(ctx: Ctx, opcoes: { privado: boolean }) {
  const criado = await ctx.events.create(ctx.fx.organization.id, ctx.dono.id, {
    title: `Festa ${rand()}`,
    category: "FESTAS",
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 90_000_000).toISOString(),
    timezone: "America/Sao_Paulo",
  });
  ctx.eventos.push(criado.id);
  if (opcoes.privado) await ctx.events.update(criado.id, ctx.dono.id, { isPrivate: true });
  return criado;
}

function avisosDo(ctx: Ctx, slug: string): number {
  return sentEmails.filter((m) => m.to === ctx.seguidor.email && m.text.includes(`/${slug}`)).length;
}

/**
 * O e-mail sai em segundo plano: espera chegarem `esperado` avisos e mais um
 * pouco, para pegar um eventual aviso repetido.
 */
async function contarAvisos(ctx: Ctx, slug: string, esperado: number): Promise<number> {
  for (let i = 0; i < 50 && avisosDo(ctx, slug) < esperado; i++) await esperar(100);
  await esperar(500);
  return avisosDo(ctx, slug);
}

async function marca(eventId: string): Promise<Date | null> {
  const evento = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { followersNotifiedAt: true },
  });
  return evento.followersNotifiedAt;
}

async function registrosNoHistorico(eventId: string): Promise<number> {
  return prisma.auditLog.count({ where: { entityId: eventId, action: "event.followers_notified" } });
}

test("evento público: publicar avisa os seguidores uma vez e grava a marca", async () => {
  const ctx = await montar();
  try {
    const ev = await rascunho(ctx, { privado: false });
    assert.equal(await marca(ev.id), null, "rascunho nasce sem marca");

    const publicado = await ctx.events.publish(ev.id, ctx.dono.id);
    assert.equal(publicado.status, "PUBLISHED");
    assert.ok(publicado.followersNotifiedAt, "a resposta da publicação já traz a marca");
    assert.ok(await marca(ev.id), "marca gravada no banco");
    assert.equal(await contarAvisos(ctx, ev.slug, 1), 1, "seguidor recebe o aviso");

    // publicar de novo não reanuncia
    await ctx.events.publish(ev.id, ctx.dono.id);
    assert.equal(await contarAvisos(ctx, ev.slug, 1), 1, "publicar de novo não manda outro aviso");
    assert.equal(await registrosNoHistorico(ev.id), 1, "o anúncio fica no histórico uma vez");

    // dois cliques em Publicar ao mesmo tempo: só um consegue gravar a marca
    const outro = await rascunho(ctx, { privado: false });
    await Promise.all([ctx.events.publish(outro.id, ctx.dono.id), ctx.events.publish(outro.id, ctx.dono.id)]);
    assert.equal(await contarAvisos(ctx, outro.slug, 1), 1, "publicar em dobro manda um aviso só");
    assert.equal(await registrosNoHistorico(outro.id), 1);
  } finally {
    await desmontar(ctx);
  }
});

test("evento privado: publicar não avisa e a marca fica vazia", async () => {
  const ctx = await montar();
  try {
    const ev = await rascunho(ctx, { privado: true });
    const publicado = await ctx.events.publish(ev.id, ctx.dono.id);
    assert.equal(publicado.status, "PUBLISHED");
    assert.equal(publicado.isPrivate, true);
    assert.equal(publicado.followersNotifiedAt, null);
    assert.equal(await marca(ev.id), null, "evento privado não ganha marca");
    assert.equal(await contarAvisos(ctx, ev.slug, 0), 0, "evento privado não manda e-mail aos seguidores");
    assert.equal(await registrosNoHistorico(ev.id), 0);
  } finally {
    await desmontar(ctx);
  }
});

test("privado → público avisa uma vez; ligar e desligar a chave não reenvia", async () => {
  const ctx = await montar();
  try {
    const ev = await rascunho(ctx, { privado: true });
    await ctx.events.publish(ev.id, ctx.dono.id);
    assert.equal(await contarAvisos(ctx, ev.slug, 0), 0, "publicado como privado: ninguém avisado ainda");

    const aberto = await ctx.events.update(ev.id, ctx.dono.id, { isPrivate: false });
    assert.equal(aberto.isPrivate, false);
    assert.ok(aberto.followersNotifiedAt, "a resposta do salvamento já traz a marca");
    const primeiraMarca = await marca(ev.id);
    assert.ok(primeiraMarca, "marca gravada na virada para público");
    assert.equal(await contarAvisos(ctx, ev.slug, 1), 1, "seguidor recebe o aviso na virada");

    // salvar de novo como público (sem virada) não manda nada
    await ctx.events.update(ev.id, ctx.dono.id, { isPrivate: false });
    // liga e desliga a chave duas vezes
    for (let i = 0; i < 2; i++) {
      await ctx.events.update(ev.id, ctx.dono.id, { isPrivate: true });
      await ctx.events.update(ev.id, ctx.dono.id, { isPrivate: false });
    }
    assert.equal(await contarAvisos(ctx, ev.slug, 1), 1, "liga-desliga da chave não reenvia");
    assert.equal((await marca(ev.id))?.getTime(), primeiraMarca!.getTime(), "a marca não é regravada");
    assert.equal(await registrosNoHistorico(ev.id), 1);
  } finally {
    await desmontar(ctx);
  }
});

test("privado → público: salvamentos simultâneos mandam um aviso só", async () => {
  const ctx = await montar();
  try {
    const ev = await rascunho(ctx, { privado: true });
    await ctx.events.publish(ev.id, ctx.dono.id);

    await Promise.all([
      ctx.events.update(ev.id, ctx.dono.id, { isPrivate: false }),
      ctx.events.update(ev.id, ctx.dono.id, { isPrivate: false }),
      ctx.events.update(ev.id, ctx.dono.id, { isPrivate: false }),
    ]);
    assert.ok(await marca(ev.id));
    assert.equal(await contarAvisos(ctx, ev.slug, 1), 1, "três salvamentos juntos, um aviso");
    assert.equal(await registrosNoHistorico(ev.id), 1);
  } finally {
    await desmontar(ctx);
  }
});

test("público → privado → público não reenvia o aviso", async () => {
  const ctx = await montar();
  try {
    const ev = await rascunho(ctx, { privado: false });
    await ctx.events.publish(ev.id, ctx.dono.id);
    assert.equal(await contarAvisos(ctx, ev.slug, 1), 1, "anunciado na publicação");
    const primeiraMarca = await marca(ev.id);
    assert.ok(primeiraMarca);

    await ctx.events.update(ev.id, ctx.dono.id, { isPrivate: true });
    await ctx.events.update(ev.id, ctx.dono.id, { isPrivate: false });
    assert.equal(await contarAvisos(ctx, ev.slug, 1), 1, "voltar a público não anuncia de novo");
    assert.equal((await marca(ev.id))?.getTime(), primeiraMarca!.getTime());
    assert.equal(await registrosNoHistorico(ev.id), 1);
  } finally {
    await desmontar(ctx);
  }
});

test("pausado ou encerrado não avisa ao virar público; reabrir as vendas avisa uma vez", async () => {
  const ctx = await montar();
  try {
    // pausado: vira público sem vendas abertas → nada; reabrir as vendas → avisa
    const pausado = await rascunho(ctx, { privado: true });
    await ctx.events.publish(pausado.id, ctx.dono.id);
    await ctx.events.unpublish(pausado.id, ctx.dono.id);
    await ctx.events.update(pausado.id, ctx.dono.id, { isPrivate: false });
    assert.equal(await marca(pausado.id), null, "pausado não ganha marca");
    assert.equal(await contarAvisos(ctx, pausado.slug, 0), 0, "pausado não avisa");

    const reaberto = await ctx.events.republish(pausado.id, ctx.dono.id);
    assert.equal(reaberto.status, "PUBLISHED");
    assert.ok(reaberto.followersNotifiedAt, "reabrir as vendas grava a marca");
    assert.equal(await contarAvisos(ctx, pausado.slug, 1), 1, "reabrir as vendas avisa");

    // pausar e reabrir de novo não reenvia
    await ctx.events.unpublish(pausado.id, ctx.dono.id);
    await ctx.events.republish(pausado.id, ctx.dono.id);
    assert.equal(await contarAvisos(ctx, pausado.slug, 1), 1, "segunda reabertura não reenvia");
    assert.equal(await registrosNoHistorico(pausado.id), 1);

    // encerrado: virar público depois do fim não anuncia
    const encerrado = await rascunho(ctx, { privado: true });
    await ctx.events.publish(encerrado.id, ctx.dono.id);
    await prisma.event.update({
      where: { id: encerrado.id },
      data: { startsAt: new Date(Date.now() - 7_200_000), endsAt: new Date(Date.now() - 1000) },
    });
    await ctx.events.update(encerrado.id, ctx.dono.id, { isPrivate: false });
    assert.equal(await marca(encerrado.id), null, "encerrado não ganha marca");
    assert.equal(await contarAvisos(ctx, encerrado.slug, 0), 0, "encerrado não avisa");
  } finally {
    await desmontar(ctx);
  }
});
