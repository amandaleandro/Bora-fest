import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, type ValidatorDevice } from "@borafest/database";
import { generateTicketCode } from "@borafest/tickets";
import { CheckinsService } from "../checkins/checkins.service";
import { ValidatorService } from "../validator/validator.service";
import { OrgAccessService } from "../common/org-access.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// FRENTE PORTA (2026-10-12). Duas garantias, provadas no banco e não na tela:
//  1. as etiquetas MEIA-ENTRADA e GRATUITO saem iguais pelo check-in online e
//     pelo manifesto que a portaria baixa para validar sem internet;
//  2. o "Desfazer entrada" do painel: dono/admin desfaz depois dos 10 minutos e
//     de outro aparelho; pessoa da porta não; clique duplo desfaz uma vez só; e
//     pedido reembolsado depois da entrada NÃO volta a valer na porta.

const rand = () => Math.random().toString(36).slice(2, 10);
const DUAS_HORAS = 2 * 60 * 60 * 1000;

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 50, priceCents: 5000, feeCents: 0 });
  const operatorRole = await prisma.role.findUniqueOrThrow({ where: { key: "operator" } });
  const dono = await prisma.user.create({ data: { email: `dono-porta-${rand()}@borafest.dev` } });
  const porteiro = await prisma.user.create({ data: { email: `porteiro-${rand()}@borafest.dev` } });
  await prisma.organizationMember.createMany({
    data: [
      { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
      { organizationId: fx.organization.id, userId: porteiro.id, roleId: operatorRole.id, status: "ACTIVE" },
    ],
  });
  const credential = await prisma.validatorCredential.create({
    data: {
      eventId: fx.event.id,
      label: `Portão ${rand()}`,
      pinHash: "n/a",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const aparelho = (nome: string) =>
    prisma.validatorDevice.create({
      data: { credentialId: credential.id, eventId: fx.event.id, name: nome, tokenHash: "n/a", status: "ACTIVE" },
    });
  const device = await aparelho("Aparelho 1");
  const outroAparelho = await aparelho("Aparelho 2");
  return {
    fx,
    dono,
    porteiro,
    device,
    outroAparelho,
    checkins: new CheckinsService(new OrgAccessService()),
    validator: new ValidatorService(new OrgAccessService()),
  };
}
type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx) {
  await prisma.auditLog.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  await cleanupFixtureEvent(ctx.fx.organization.id);
  for (const id of [ctx.dono.id, ctx.porteiro.id]) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
}

/** Pedido com um ingresso ACTIVE — o contrato que a porta lê. */
async function ingresso(
  ctx: Ctx,
  opcoes: { totalCents: number; meia?: boolean; lista?: boolean; nome?: string | null; comprador?: string },
) {
  const reservation = await prisma.reservation.create({
    data: { eventId: ctx.fx.event.id, status: "CONVERTED", expiresAt: new Date() },
  });
  const order = await prisma.order.create({
    data: {
      eventId: ctx.fx.event.id,
      reservationId: reservation.id,
      contactEmail: `porta-${rand()}@borafest.dev`,
      contactName: opcoes.comprador ?? "Comprador Teste",
      status: "FULFILLED",
      totalCents: opcoes.totalCents,
    },
  });
  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      ticketLotId: ctx.fx.lot.id,
      quantity: 1,
      priceCents: opcoes.totalCents,
      feeCents: 0,
      halfPrice: opcoes.meia ?? false,
    },
  });
  const ticket = await prisma.ticket.create({
    data: {
      orderId: order.id,
      orderItemId: item.id,
      eventId: ctx.fx.event.id,
      ticketLotId: ctx.fx.lot.id,
      seq: 1,
      code: generateTicketCode(),
      qrToken: "n/a",
      status: "ACTIVE",
      attendeeName: opcoes.nome === undefined ? "Portador Teste" : opcoes.nome,
    },
  });
  if (opcoes.lista) {
    await prisma.guestListEntry.create({
      data: {
        eventId: ctx.fx.event.id,
        ticketLotId: ctx.fx.lot.id,
        addedByUserId: ctx.dono.id,
        orderId: order.id,
        guestName: ticket.attendeeName ?? "Convidado",
        ticketId: ticket.id,
      },
    });
  }
  return { order, ticket };
}

async function entrar(ctx: Ctx, device: ValidatorDevice, code: string) {
  const r = await ctx.checkins.create(device, { code });
  assert.ok("ticket" in r && r.ticket, "check-in sem ingresso na resposta");
  return { result: r.result, ticket: r.ticket, checkinId: r.checkinId };
}

test("etiquetas da porta: meia e gratuito iguais no check-in online e no manifesto offline", async () => {
  const ctx = await montar();
  try {
    const meia = await ingresso(ctx, { totalCents: 2500, meia: true, nome: "Pagou Meia" });
    const inteira = await ingresso(ctx, { totalCents: 5000, nome: "Pagou Inteira" });
    const gratisDoSite = await ingresso(ctx, { totalCents: 0, nome: "Lote Gratis" });
    const convidado = await ingresso(ctx, { totalCents: 0, lista: true, nome: "Convidado Lista" });

    const esperado = new Map<string, { meia: boolean; gratuito: boolean; tipo: string | null }>([
      [meia.ticket.id, { meia: true, gratuito: false, tipo: null }],
      [inteira.ticket.id, { meia: false, gratuito: false, tipo: null }],
      [gratisDoSite.ticket.id, { meia: false, gratuito: true, tipo: null }],
      // lista continua CONVIDADO, como antes — e nunca GRATUITO junto
      [convidado.ticket.id, { meia: false, gratuito: false, tipo: "CONVIDADO" }],
    ]);

    // OFFLINE: o manifesto, full e delta, carrega os campos. Formato 4 (QR
    // atual, 2026-10-12) inclui o 3 (meia/gratuito) — o número só sobe
    for (const since of [undefined, new Date(0)]) {
      const manifest = await ctx.validator.getManifest(ctx.device, since);
      assert.equal(manifest.manifestSchema, 4, "o servidor confirma o formato atual (meia/gratuito + QR atual)");
      const byId = new Map(manifest.tickets.map((t) => [t.id, t]));
      for (const [id, e] of esperado) {
        const t = byId.get(id);
        assert.ok(t, "ingresso no manifesto");
        assert.equal(t.meia, e.meia, `manifesto meia (${t.attendeeName})`);
        assert.equal(t.gratuito, e.gratuito, `manifesto gratuito (${t.attendeeName})`);
        assert.equal(t.tipo, e.tipo, `manifesto tipo (${t.attendeeName})`);
        assert.ok(!("orderItem" in t), "o item do pedido não vaza para o aparelho");
      }
    }

    // ONLINE: o check-in diz o mesmo que o manifesto
    for (const { ticket } of [meia, inteira, gratisDoSite, convidado]) {
      const r = await entrar(ctx, ctx.device, ticket.code);
      const e = esperado.get(ticket.id)!;
      assert.equal(r.result, "VALID");
      assert.equal(r.ticket.meia, e.meia, `online meia (${ticket.attendeeName})`);
      assert.equal(r.ticket.gratuito, e.gratuito, `online gratuito (${ticket.attendeeName})`);
      assert.equal(r.ticket.tipo, e.tipo, `online tipo (${ticket.attendeeName})`);
    }

    // a etiqueta acompanha o "Já utilizado" sem mudar de valor
    const deNovo = await entrar(ctx, ctx.outroAparelho, meia.ticket.code);
    assert.equal(deNovo.result, "ALREADY_USED");
    assert.equal(deNovo.ticket.meia, true);
  } finally {
    await desmontar(ctx);
  }
});

test("desfazer entrada pelo painel: dono desfaz depois dos 10 min e de outro aparelho; porteiro não", async () => {
  const ctx = await montar();
  try {
    const { ticket } = await ingresso(ctx, { totalCents: 5000, nome: "Entrou Por Engano" });
    const entrada = await entrar(ctx, ctx.device, ticket.code);
    assert.equal(entrada.result, "VALID");
    const checkinId = entrada.checkinId!;

    // a entrada foi há 2 horas — fora da janela do aparelho
    const antes = new Date(Date.now() - DUAS_HORAS);
    await prisma.checkin.update({ where: { id: checkinId }, data: { scannedAt: antes, receivedAt: antes } });

    await assert.rejects(() => ctx.checkins.reverseFromDevice(ctx.outroAparelho, checkinId), /outro aparelho/);
    await assert.rejects(() => ctx.checkins.reverseFromDevice(ctx.device, checkinId), /10 minutos/);
    // a pessoa da porta (CHECKIN_PERFORM) não desfaz pela conta: é a fraude que
    // a tranca do aparelho fechou em 2026-09-12
    await assert.rejects(() => ctx.checkins.reverse(ctx.porteiro.id, checkinId), /Sem permissão/);
    assert.equal(
      (await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status,
      "CHECKED_IN",
      "nenhuma recusa mexeu no ingresso",
    );

    const r = await ctx.checkins.reverse(ctx.dono.id, checkinId);
    assert.deepEqual(r, { reversed: true, ticketActive: true });

    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(t.status, "ACTIVE");
    assert.equal(t.checkedInAt, null);
    const c = await prisma.checkin.findUniqueOrThrow({ where: { id: checkinId } });
    assert.equal(c.status, "REVERSED");
    assert.equal(c.reversedBy, ctx.dono.id);

    const rastro = await prisma.auditLog.findMany({ where: { action: "checkin.reverse", entityId: checkinId } });
    assert.equal(rastro.length, 1);
    assert.equal(rastro[0].actorUserId, ctx.dono.id);
    assert.equal(rastro[0].organizationId, ctx.fx.organization.id);
    const meta = rastro[0].metadata as Record<string, unknown>;
    assert.equal(meta.ticketCode, ticket.code);
    assert.equal(meta.deviceName, "Aparelho 1");

    // o QR volta a valer na porta
    const volta = await entrar(ctx, ctx.outroAparelho, ticket.code);
    assert.equal(volta.result, "VALID");
  } finally {
    await desmontar(ctx);
  }
});

test("clique duplo no desfazer: desfaz uma vez só e grava um registro só", async () => {
  const ctx = await montar();
  try {
    const { ticket } = await ingresso(ctx, { totalCents: 5000 });
    const entrada = await entrar(ctx, ctx.device, ticket.code);
    const checkinId = entrada.checkinId!;

    const resultados = await Promise.allSettled([
      ctx.checkins.reverse(ctx.dono.id, checkinId),
      ctx.checkins.reverse(ctx.dono.id, checkinId),
    ]);
    const ok = resultados.filter((x) => x.status === "fulfilled");
    const recusados = resultados.filter((x): x is PromiseRejectedResult => x.status === "rejected");
    assert.equal(ok.length, 1, "só um desfaz");
    assert.equal(recusados.length, 1);
    assert.match(String((recusados[0].reason as Error).message), /já foi desfeita/);

    assert.equal(await prisma.auditLog.count({ where: { action: "checkin.reverse", entityId: checkinId } }), 1);
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status, "ACTIVE");
  } finally {
    await desmontar(ctx);
  }
});

test("pedido reembolsado depois da entrada: desfazer NÃO ressuscita o QR (painel e aparelho)", async () => {
  const ctx = await montar();
  try {
    const { order, ticket } = await ingresso(ctx, { totalCents: 5000, nome: "Reembolsado Dentro" });
    const entrada = await entrar(ctx, ctx.device, ticket.code);
    const checkinId = entrada.checkinId!;
    // o reembolso deixa CHECKED_IN quem já entrou (refund-order.ts)
    await prisma.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });

    await assert.rejects(() => ctx.checkins.reverseFromDevice(ctx.device, checkinId), /cancelado ou reembolsado/);
    await assert.rejects(() => ctx.checkins.reverse(ctx.dono.id, checkinId), /cancelado ou reembolsado/);

    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status, "CHECKED_IN");
    assert.equal((await prisma.checkin.findUniqueOrThrow({ where: { id: checkinId } })).status, "CONFIRMED");
    assert.equal(await prisma.auditLog.count({ where: { entityId: checkinId } }), 0, "recusa não grava rastro");

    // a lista do painel já avisa, em vez de oferecer o botão que o servidor recusa
    const lista = await ctx.checkins.recentEntries(ctx.dono.id, ctx.fx.event.id);
    const linha = lista.entries.find((e) => e.checkinId === checkinId);
    assert.ok(linha);
    assert.equal(linha.canUndo, false);
  } finally {
    await desmontar(ctx);
  }
});

test("lista de entradas do painel: só entradas valendo, com meia, busca por nome, comprador e código", async () => {
  const ctx = await montar();
  try {
    const zulmira = await ingresso(ctx, { totalCents: 2500, meia: true, nome: "Zulmira Teste" });
    const bento = await ingresso(ctx, { totalCents: 5000, nome: "Bento Teste" });
    const semNome = await ingresso(ctx, { totalCents: 5000, nome: null, comprador: "Carmelita Compradora" });
    for (const { ticket } of [zulmira, bento, semNome]) {
      assert.equal((await entrar(ctx, ctx.device, ticket.code)).result, "VALID");
    }
    // leitura repetida vira CONFLICT — não é entrada, não aparece para desfazer
    assert.equal((await entrar(ctx, ctx.outroAparelho, zulmira.ticket.code)).result, "ALREADY_USED");

    const todas = await ctx.checkins.recentEntries(ctx.dono.id, ctx.fx.event.id);
    assert.equal(todas.entries.length, 3, "três entradas, sem a leitura recusada");
    assert.equal(todas.hasMore, false);
    const daZulmira = todas.entries.find((e) => e.code === zulmira.ticket.code);
    assert.ok(daZulmira);
    assert.equal(daZulmira.meia, true);
    assert.equal(daZulmira.canUndo, true);
    assert.equal(daZulmira.deviceName, "Aparelho 1");

    const porNome = await ctx.checkins.recentEntries(ctx.dono.id, ctx.fx.event.id, "zulmira");
    assert.deepEqual(porNome.entries.map((e) => e.code), [zulmira.ticket.code]);

    const porComprador = await ctx.checkins.recentEntries(ctx.dono.id, ctx.fx.event.id, "carmelita");
    assert.deepEqual(porComprador.entries.map((e) => e.code), [semNome.ticket.code]);
    assert.equal(porComprador.entries[0].name, null);
    assert.equal(porComprador.entries[0].buyerName, "Carmelita Compradora");

    const porCodigo = await ctx.checkins.recentEntries(
      ctx.dono.id,
      ctx.fx.event.id,
      bento.ticket.code.toLowerCase(),
    );
    assert.deepEqual(porCodigo.entries.map((e) => e.code), [bento.ticket.code]);

    // desfeita sai da lista
    await ctx.checkins.reverse(ctx.dono.id, porCodigo.entries[0].checkinId);
    const depois = await ctx.checkins.recentEntries(ctx.dono.id, ctx.fx.event.id);
    assert.ok(!depois.entries.some((e) => e.code === bento.ticket.code));

    // ERRO NÃO VIRA LISTA VAZIA: sem permissão e evento inexistente são erro
    await assert.rejects(() => ctx.checkins.recentEntries(ctx.porteiro.id, ctx.fx.event.id), /Sem permissão/);
    await assert.rejects(() => ctx.checkins.recentEntries(ctx.dono.id, randomUUID()), /Evento não encontrado/);
  } finally {
    await desmontar(ctx);
  }
});
