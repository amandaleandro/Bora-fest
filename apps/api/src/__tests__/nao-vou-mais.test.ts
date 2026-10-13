import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { confirmSaleInventory, prisma, reserveInventory } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import {
  NaoVouMaisService,
  recusaDoNaoVouMais,
  vagasQueVoltariam,
  type PedidoParaNaoVouMais,
} from "../orders/nao-vou-mais.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// "NÃO VOU MAIS" (decidido em 10/10, tela aprovada em 12/10): quem pegou
// ingresso grátis libera a vaga até o evento começar. Toda garantia é provada
// no banco: só o DONO libera (o link do pedido não basta), pedido pago não
// passa, depois do início não passa, dois cliques devolvem a vaga uma vez só,
// e a resposta não leva CPF.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);
const DIA = 86_400_000;
const servico = new NaoVouMaisService();

// ---------------------------------------------------------------------------
// Regra pura (sem banco)
// ---------------------------------------------------------------------------

const AGORA = Date.parse("2026-10-12T20:00:00Z");
const base = (extra: Partial<PedidoParaNaoVouMais> = {}): PedidoParaNaoVouMais => ({
  userId: "dono",
  status: "FULFILLED",
  totalCents: 0,
  event: { startsAt: new Date(AGORA + DIA) },
  items: [{ quantity: 1 }],
  tickets: [{ status: "ACTIVE", ownerUserId: null }],
  ...extra,
});

test("regra: o dono de pedido grátis confirmado, antes do início, pode liberar", () => {
  assert.equal(recusaDoNaoVouMais(base(), "dono", AGORA), null);
  assert.equal(recusaDoNaoVouMais(base({ status: "PAID", tickets: [] }), "dono", AGORA), null, "ainda não emitido também libera");
});

test("regra: outra conta, pedido sem dono, pago, cancelado, pendente ou evento começado não liberam", () => {
  assert.equal(recusaDoNaoVouMais(base(), "outra", AGORA)?.http, 403);
  assert.equal(recusaDoNaoVouMais(base({ userId: null }), "dono", AGORA)?.http, 403, "lista/cortesia sem conta");
  assert.match(recusaDoNaoVouMais(base({ totalCents: 5000 }), "dono", AGORA)!.mensagem, /Reembolso/);
  assert.match(recusaDoNaoVouMais(base({ status: "CANCELED" }), "dono", AGORA)!.mensagem, /já está cancelado/);
  assert.match(recusaDoNaoVouMais(base({ status: "PAYMENT_PENDING" }), "dono", AGORA)!.mensagem, /não está confirmado/);
  // o início é o limite: no exato instante já não dá
  assert.match(
    recusaDoNaoVouMais(base({ event: { startsAt: new Date(AGORA) } }), "dono", AGORA)!.mensagem,
    /já começou/,
  );
  assert.match(
    recusaDoNaoVouMais(base({ tickets: [{ status: "CHECKED_IN", ownerUserId: null }] }), "dono", AGORA)!.mensagem,
    /já foram usados/,
  );
  // ingresso antigo transferido: cancelar o pedido tiraria o ingresso de outra pessoa
  assert.match(
    recusaDoNaoVouMais(base({ tickets: [{ status: "ACTIVE", ownerUserId: "amiga" }] }), "dono", AGORA)!.mensagem,
    /outra pessoa/,
  );
});

test("regra: vagas que voltariam = ingressos valendo + não emitidos", () => {
  assert.equal(
    vagasQueVoltariam({
      items: [{ quantity: 3 }],
      tickets: [
        { status: "CHECKED_IN", ownerUserId: null },
        { status: "ACTIVE", ownerUserId: null },
      ],
    }),
    2,
    "1 valendo + 1 que ainda não saiu; o usado não volta",
  );
});

// ---------------------------------------------------------------------------
// No banco, pelo serviço da rota
// ---------------------------------------------------------------------------

async function montar(opcoes: { startsAt?: Date } = {}) {
  const fx = await createFixtureEvent({
    lotCapacity: 10,
    priceCents: 0,
    feeCents: 0,
    ...(opcoes.startsAt ? { startsAt: opcoes.startsAt, endsAt: new Date(opcoes.startsAt.getTime() + 6 * 3_600_000) } : {}),
  });
  const comprador = await prisma.user.create({ data: { email: `comprador-nvm-${rand()}@borafest.dev` } });
  const outra = await prisma.user.create({ data: { email: `outra-nvm-${rand()}@borafest.dev` } });
  return { fx, comprador, outra, usuarios: [comprador.id, outra.id] };
}
type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx) {
  const pedidos = await prisma.order.findMany({ where: { eventId: ctx.fx.event.id }, select: { id: true } });
  const ids = pedidos.map((p) => p.id);
  await prisma.notification.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
  await prisma.couponRedemption.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  await cleanupFixtureEvent(ctx.fx.organization.id);
  for (const id of ctx.usuarios) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

const loteAtual = (ctx: Ctx) => prisma.ticketLot.findUniqueOrThrow({ where: { id: ctx.fx.lot.id } });

/** Pedido de R$ 0 da conta do comprador, como o checkout do lote grátis deixa (PAID → FULFILLED). */
async function pedidoGratis(ctx: Ctx, opcoes: { quantidade?: number; emitir?: boolean; userId?: string | null } = {}) {
  const quantidade = opcoes.quantidade ?? 1;
  const lotId = ctx.fx.lot.id;
  const order = await prisma.$transaction(async (tx) => {
    await reserveInventory(tx, lotId, quantidade);
    await confirmSaleInventory(tx, lotId, quantidade);
    const reservation = await tx.reservation.create({
      data: {
        eventId: ctx.fx.event.id,
        status: "CONVERTED",
        expiresAt: new Date(),
        items: { create: [{ ticketLotId: lotId, quantity: quantidade, priceCents: 0, feeCents: 0 }] },
      },
    });
    return tx.order.create({
      data: {
        eventId: ctx.fx.event.id,
        reservationId: reservation.id,
        userId: opcoes.userId === undefined ? ctx.comprador.id : opcoes.userId,
        contactEmail: ctx.comprador.email!,
        contactName: "Comprador Teste",
        contactCpf: "52998224725",
        status: "PAID",
        paidAt: new Date(),
        totalCents: 0,
        items: { create: [{ ticketLotId: lotId, quantity: quantidade, priceCents: 0, feeCents: 0 }] },
      },
    });
  });
  if (opcoes.emitir ?? true) {
    const comItens = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    for (const item of comItens.items) {
      for (let seq = 1; seq <= item.quantity; seq++) {
        await prisma.ticket.create({
          data: {
            orderId: order.id,
            orderItemId: item.id,
            eventId: order.eventId,
            ticketLotId: item.ticketLotId,
            seq,
            code: `T-${rand()}`.toUpperCase(),
            qrToken: `qr-${randomUUID()}`,
            status: "ACTIVE",
            attendeeEmail: order.contactEmail,
          },
        });
      }
    }
    await prisma.order.updateMany({ where: { id: order.id, status: "PAID" }, data: { status: "FULFILLED" } });
  }
  return order;
}

test("o dono libera a vaga: QR cancelado, vaga de volta, e-mail 'como você pediu', auditoria e resposta sem CPF", async () => {
  const ctx = await montar();
  try {
    const pedido = await pedidoGratis(ctx, { quantidade: 2 });
    assert.equal((await loteAtual(ctx)).soldCount, 2);

    const situacao = await servico.situacao(pedido.publicToken, ctx.comprador.id);
    assert.deepEqual(situacao, { podeLiberar: true, vagas: 2 });

    const r = await servico.liberar(pedido.publicToken, ctx.comprador.id);
    assert.deepEqual(r, { status: "CANCELED", vagasLiberadas: 2, ingressosUsados: 0 });
    const texto = JSON.stringify(r);
    assert.ok(!texto.includes("52998224725") && !/cpf/i.test(texto), "a resposta não leva CPF");

    assert.equal((await loteAtual(ctx)).soldCount, 0, "as 2 vagas voltaram ao lote");
    const salvo = await prisma.order.findUniqueOrThrow({ where: { id: pedido.id } });
    assert.equal(salvo.status, "CANCELED");
    const ingressos = await prisma.ticket.findMany({ where: { orderId: pedido.id } });
    assert.ok(ingressos.every((t) => t.status === "CANCELED"), "o QR não vale mais na porta");

    const aviso = await prisma.notification.findFirstOrThrow({ where: { orderId: pedido.id } });
    assert.equal(aviso.template, "free_ticket_canceled");
    assert.equal((aviso.payload as Record<string, unknown>).pedidoPeloComprador, true, "e-mail 'como você pediu'");

    const auditoria = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: pedido.id, action: "order.free_cancel" },
    });
    assert.equal(auditoria.actorUserId, ctx.comprador.id);
    assert.equal((auditoria.metadata as Record<string, unknown>).origem, "comprador");

    // depois de liberar, o botão não aparece mais
    assert.deepEqual(await servico.situacao(pedido.publicToken, ctx.comprador.id), { podeLiberar: false, vagas: 0 });
  } finally {
    await desmontar(ctx);
  }
});

test("outra conta (só com o link do pedido) não libera nem descobre nada", async () => {
  const ctx = await montar();
  try {
    const pedido = await pedidoGratis(ctx);
    assert.deepEqual(await servico.situacao(pedido.publicToken, ctx.outra.id), { podeLiberar: false, vagas: 0 });
    await assert.rejects(servico.liberar(pedido.publicToken, ctx.outra.id), (e: unknown) => {
      assert.equal((e as { getStatus?: () => number }).getStatus?.(), 403, "403: não é o dono");
      return true;
    });
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: pedido.id } })).status, "FULFILLED");
    assert.equal((await loteAtual(ctx)).soldCount, 1, "nada mudou no estoque");

    // pedido sem conta (lista, cortesia): ninguém libera por aqui
    const semDono = await pedidoGratis(ctx, { userId: null });
    await assert.rejects(servico.liberar(semDono.publicToken, ctx.comprador.id), /Só quem pegou/);

    await assert.rejects(servico.liberar(`nao-existe-${rand()}`, ctx.comprador.id), /Pedido não encontrado/);
  } finally {
    await desmontar(ctx);
  }
});

test("pedido pago não passa: dinheiro se devolve pelo Reembolso", async () => {
  const ctx = await montar();
  try {
    const pedido = await pedidoGratis(ctx);
    await prisma.order.update({ where: { id: pedido.id }, data: { totalCents: 5000 } });
    assert.equal((await servico.situacao(pedido.publicToken, ctx.comprador.id)).podeLiberar, false);
    await assert.rejects(servico.liberar(pedido.publicToken, ctx.comprador.id), /Reembolso/);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: pedido.id } })).status, "FULFILLED");
    assert.equal(await prisma.notification.count({ where: { orderId: pedido.id } }), 0, "ninguém recebe e-mail");
  } finally {
    await desmontar(ctx);
  }
});

test("depois que o evento começou, a vaga não é mais liberada", async () => {
  const ctx = await montar({ startsAt: new Date(Date.now() - 3_600_000) });
  try {
    const pedido = await pedidoGratis(ctx);
    assert.equal((await servico.situacao(pedido.publicToken, ctx.comprador.id)).podeLiberar, false);
    await assert.rejects(servico.liberar(pedido.publicToken, ctx.comprador.id), /já começou/);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: pedido.id } })).status, "FULFILLED");
    assert.equal((await loteAtual(ctx)).soldCount, 1);
  } finally {
    await desmontar(ctx);
  }
});

test("dois cliques ao mesmo tempo: libera uma vez, a vaga volta uma vez, um e-mail só", async () => {
  const ctx = await montar();
  try {
    const pedido = await pedidoGratis(ctx, { quantidade: 2 });
    const resultados = await Promise.allSettled([
      servico.liberar(pedido.publicToken, ctx.comprador.id),
      servico.liberar(pedido.publicToken, ctx.comprador.id),
    ]);
    const ok = resultados.filter((r) => r.status === "fulfilled");
    const recusados = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(ok.length, 1, "só um dos dois cancela");
    assert.equal(recusados.length, 1);
    assert.match(String((recusados[0].reason as Error).message), /já está cancelado/);

    assert.equal((await loteAtual(ctx)).soldCount, 0, "as 2 vagas voltaram, e uma vez só");
    assert.equal(await prisma.notification.count({ where: { orderId: pedido.id } }), 1, "um e-mail só");
    assert.equal(
      await prisma.auditLog.count({ where: { entityId: pedido.id, action: "order.free_cancel" } }),
      1,
    );
  } finally {
    await desmontar(ctx);
  }
});

test("alguém do pedido já entrou: só os outros caem e o pedido segue valendo", async () => {
  const ctx = await montar();
  try {
    const pedido = await pedidoGratis(ctx, { quantidade: 2 });
    const [usado] = await prisma.ticket.findMany({ where: { orderId: pedido.id }, orderBy: { seq: "asc" } });
    await prisma.ticket.update({ where: { id: usado.id }, data: { status: "CHECKED_IN", checkedInAt: new Date() } });

    assert.deepEqual(await servico.situacao(pedido.publicToken, ctx.comprador.id), { podeLiberar: true, vagas: 1 });
    const r = await servico.liberar(pedido.publicToken, ctx.comprador.id);
    assert.deepEqual(r, { status: "FULFILLED", vagasLiberadas: 1, ingressosUsados: 1 });
    assert.equal((await loteAtual(ctx)).soldCount, 1, "a vaga de quem entrou não volta");
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: usado.id } })).status, "CHECKED_IN");
    // não sobrou o que liberar: o botão some e uma nova tentativa é recusada
    assert.equal((await servico.situacao(pedido.publicToken, ctx.comprador.id)).podeLiberar, false);
    await assert.rejects(servico.liberar(pedido.publicToken, ctx.comprador.id), /já foram usados/);
  } finally {
    await desmontar(ctx);
  }
});
