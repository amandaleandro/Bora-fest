import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { DashboardService } from "../dashboard/dashboard.service";
import { OrgAccessService } from "../common/org-access.service";
import {
  PARTICIPANTES_POR_PAGINA,
  PARTICIPANTES_POR_PAGINA_MAX,
  buscaDeParticipantes,
  paginaDeParticipantes,
} from "../dashboard/participantes-pagina";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Lista de participantes em páginas (2026-10-12): a rota devolvia todos os
// ingressos do evento numa resposta só e a tela buscava no navegador. Agora
// vem por página, com o total, e a busca roda no servidor. O CSV segue inteiro.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);

// ---- parâmetros da URL: lixo nunca vira 500 ---------------------------------

test("página: sem parâmetro, lixo, zero e negativo caem no padrão", () => {
  assert.deepEqual(paginaDeParticipantes(undefined, undefined), { page: 1, pageSize: PARTICIPANTES_POR_PAGINA });
  assert.deepEqual(paginaDeParticipantes("abc", "xyz"), { page: 1, pageSize: PARTICIPANTES_POR_PAGINA });
  assert.deepEqual(paginaDeParticipantes("0", "0"), { page: 1, pageSize: PARTICIPANTES_POR_PAGINA });
  assert.deepEqual(paginaDeParticipantes("-3", "-10"), { page: 1, pageSize: PARTICIPANTES_POR_PAGINA });
  assert.deepEqual(paginaDeParticipantes("Infinity", "NaN"), { page: 1, pageSize: PARTICIPANTES_POR_PAGINA });
});

test("página: número quebrado arredonda para baixo e o tamanho tem teto", () => {
  assert.deepEqual(paginaDeParticipantes("2.9", "10.5"), { page: 2, pageSize: 10 });
  assert.equal(paginaDeParticipantes("1", "5000").pageSize, PARTICIPANTES_POR_PAGINA_MAX);
  // skip dentro do inteiro do Postgres mesmo com página absurda
  const { page, pageSize } = paginaDeParticipantes("99999999999999", "100");
  assert.ok((page - 1) * pageSize < 2 ** 31, "skip cabe no int do banco");
});

test("busca: espaços fora, vazio é null, array (q repetido) é null, teto de tamanho", () => {
  assert.equal(buscaDeParticipantes(undefined), null);
  assert.equal(buscaDeParticipantes("   "), null);
  assert.equal(buscaDeParticipantes(["a", "b"]), null);
  assert.equal(buscaDeParticipantes("  Ana  "), "Ana");
  assert.equal(buscaDeParticipantes("x".repeat(500))?.length, 100);
});

// ---- a rota de verdade, contra o banco ----------------------------------------

async function montar(quantidade: number) {
  const fx = await createFixtureEvent({ lotCapacity: quantidade + 10, priceCents: 5000, feeCents: 0 });
  const dono = await prisma.user.create({ data: { email: `dono-part-${rand()}@borafest.dev`, name: "Produção" } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  const reserva = await prisma.reservation.create({
    data: { eventId: fx.event.id, status: "CONVERTED", expiresAt: new Date(Date.now() + 60_000) },
  });
  const pedido = await prisma.order.create({
    data: {
      eventId: fx.event.id,
      reservationId: reserva.id,
      contactName: "Comprador Principal",
      contactEmail: `comprador-${rand()}@example.com`,
      status: "PAID",
      totalCents: 5000 * quantidade,
      paidAt: new Date(),
    },
  });
  const item = await prisma.orderItem.create({
    data: { orderId: pedido.id, ticketLotId: fx.lot.id, quantity: quantidade, priceCents: 5000, feeCents: 0 },
  });
  for (let seq = 1; seq <= quantidade; seq += 1) {
    await prisma.ticket.create({
      data: {
        orderId: pedido.id,
        orderItemId: item.id,
        eventId: fx.event.id,
        ticketLotId: fx.lot.id,
        seq,
        code: `PART-${rand()}-${seq}`,
        qrToken: `tok-part-${rand()}-${seq}`,
        status: "ACTIVE",
        // um nome próprio só no 7º: o resto exibe o nome do comprador
        attendeeName: seq === 7 ? "Zuleica Participante" : null,
      },
    });
  }
  return { fx, dono, dashboard: new DashboardService(new OrgAccessService()) };
}

async function desmontar(ctx: Awaited<ReturnType<typeof montar>>) {
  const orgId = ctx.fx.organization.id;
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
  await cleanupFixtureEvent(orgId);
  await prisma.user.delete({ where: { id: ctx.dono.id } }).catch(() => undefined);
}

test("participantes: vem por página, com total, sem repetir nem pular ninguém", async () => {
  const ctx = await montar(12);
  try {
    const p1 = await ctx.dashboard.listParticipants(ctx.fx.event.id, ctx.dono.id, { page: 1, pageSize: 5, q: null });
    const p2 = await ctx.dashboard.listParticipants(ctx.fx.event.id, ctx.dono.id, { page: 2, pageSize: 5, q: null });
    const p3 = await ctx.dashboard.listParticipants(ctx.fx.event.id, ctx.dono.id, { page: 3, pageSize: 5, q: null });
    const p4 = await ctx.dashboard.listParticipants(ctx.fx.event.id, ctx.dono.id, { page: 4, pageSize: 5, q: null });

    assert.equal(p1.total, 12);
    assert.equal(p1.page, 1);
    assert.equal(p1.pageSize, 5);
    assert.deepEqual(
      [p1.participants.length, p2.participants.length, p3.participants.length, p4.participants.length],
      [5, 5, 2, 0],
    );
    const ids = [...p1.participants, ...p2.participants, ...p3.participants].map((p) => p.id);
    assert.equal(new Set(ids).size, 12, "as três páginas juntas cobrem os 12 sem repetir");

    // o CSV continua com a lista inteira
    const csv = await ctx.dashboard.exportParticipantsCsv(ctx.fx.event.id, ctx.dono.id);
    assert.equal(csv.split("\n").length, 13, "cabeçalho + 12 linhas");
  } finally {
    await desmontar(ctx);
  }
});

test("participantes: a busca roda no servidor e o total é o da busca", async () => {
  const ctx = await montar(12);
  try {
    // nome próprio do ingresso, sem diferenciar caixa
    const porNome = await ctx.dashboard.listParticipants(ctx.fx.event.id, ctx.dono.id, {
      page: 1,
      pageSize: 5,
      q: "zuleica",
    });
    assert.equal(porNome.total, 1);
    assert.equal(porNome.participants[0]?.attendeeName, "Zuleica Participante");

    // nome do comprador (o que a tela exibe quando o ingresso não tem nome)
    const porComprador = await ctx.dashboard.listParticipants(ctx.fx.event.id, ctx.dono.id, {
      page: 1,
      pageSize: 5,
      q: "Comprador Principal",
    });
    assert.equal(porComprador.total, 12, "todos são do mesmo pedido");
    assert.equal(porComprador.participants.length, 5, "e a busca também vem por página");

    // código do ingresso
    const alvo = await prisma.ticket.findFirstOrThrow({ where: { eventId: ctx.fx.event.id, seq: 3 } });
    const porCodigo = await ctx.dashboard.listParticipants(ctx.fx.event.id, ctx.dono.id, {
      page: 1,
      pageSize: 5,
      q: alvo.code.toLowerCase(),
    });
    assert.equal(porCodigo.total, 1);
    assert.equal(porCodigo.participants[0]?.id, alvo.id);

    const nada = await ctx.dashboard.listParticipants(ctx.fx.event.id, ctx.dono.id, {
      page: 1,
      pageSize: 5,
      q: `ninguem-${rand()}`,
    });
    assert.equal(nada.total, 0);
    assert.equal(nada.participants.length, 0);
  } finally {
    await desmontar(ctx);
  }
});
