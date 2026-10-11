import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { confirmSaleInventory, prisma, reserveInventory } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { renderFreeEventCanceledEmail, renderFreeTicketCanceledEmail } from "@borafest/notifications";
import { cancelarPedidoGratis } from "../common/cancelar-pedido-gratis";
import { executarReembolso } from "../common/refund-order";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { EventsService } from "../events/events.service";
import { GuestListService } from "../guest-list/guest-list.service";
import { RefundRequestsService } from "../refund-requests/refund-requests.service";
import { CancelamentoGratisService } from "../orders/cancelamento-gratis.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

// Pedido grátis se CANCELA, não se reembolsa (decisão do Arthur, 2026-10-11).
// Antes o "Reembolsar" de um pedido de R$ 0 dava erro e nada mudava: vaga presa,
// QR valendo; o comprador podia pedir "reembolso" de algo que não pagou; e no
// cancelamento do evento o ingresso grátis seguia válido com o e-mail "seu
// dinheiro está voltando". Toda garantia é provada no banco, não na tela.

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);

/** CPF válido aleatório (a lista exige CPF). */
function geraCpf(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (base: number[]) => {
    const soma = base.reduce((acc, d, i) => acc + d * (base.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(n);
  const d2 = dv([...n, d1]);
  return [...n, d1, d2].join("");
}

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 10, priceCents: 0, feeCents: 0 });
  const dono = await prisma.user.create({ data: { email: `dono-gratis-${rand()}@borafest.dev` } });
  await prisma.organizationMember.create({
    data: { organizationId: fx.organization.id, userId: dono.id, roleId: fx.ownerRoleId, status: "ACTIVE" },
  });
  return { fx, dono, usuarios: [dono.id] as string[] };
}
type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx) {
  const pedidos = await prisma.order.findMany({ where: { eventId: ctx.fx.event.id }, select: { id: true } });
  const ids = pedidos.map((p) => p.id);
  await prisma.notification.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
  await prisma.couponRedemption.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  await prisma.promoterLink.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  await cleanupFixtureEvent(ctx.fx.organization.id);
  for (const id of ctx.usuarios) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

const loteAtual = (ctx: Ctx) => prisma.ticketLot.findUniqueOrThrow({ where: { id: ctx.fx.lot.id } });

/**
 * Simula o worker issue-tickets: cria os ingressos ACTIVE e marca FULFILLED.
 * (A API não importa o worker; o contrato testado é o mesmo.)
 */
async function emitir(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  for (const item of order.items) {
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

/** Pedido de R$ 0 pelo mesmo caminho da cortesia: estoque confirmado e pedido já PAID. */
async function pedidoGratis(
  ctx: Ctx,
  opcoes: { quantidade?: number; emitir?: boolean; email?: string } = {},
) {
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
        contactEmail: opcoes.email ?? `gratis-${rand()}@borafest.dev`,
        contactName: "Convidada Teste",
        status: "PAID",
        paidAt: new Date(),
        totalCents: 0,
        items: { create: [{ ticketLotId: lotId, quantity: quantidade, priceCents: 0, feeCents: 0 }] },
      },
    });
  });
  if (opcoes.emitir ?? true) await emitir(order.id);
  return order;
}

test("dois cliques ao mesmo tempo: o pedido cancela uma vez e a vaga volta uma vez só", async () => {
  const ctx = await montar();
  try {
    const pedido = await pedidoGratis(ctx, { quantidade: 2 });
    assert.equal((await loteAtual(ctx)).soldCount, 2);

    const resultados = await Promise.allSettled([
      cancelarPedidoGratis(pedido.id, ctx.dono.id, "não vai mais"),
      cancelarPedidoGratis(pedido.id, ctx.dono.id, "não vai mais"),
    ]);
    const ok = resultados.filter((r) => r.status === "fulfilled");
    const recusados = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(ok.length, 1, "só um dos dois cancela");
    assert.equal(recusados.length, 1);
    assert.match(String((recusados[0].reason as Error).message), /já está cancelado/);

    assert.equal((await loteAtual(ctx)).soldCount, 0, "as 2 vagas voltaram, e uma vez só");
    const salvo = await prisma.order.findUniqueOrThrow({ where: { id: pedido.id } });
    assert.equal(salvo.status, "CANCELED");
    const ingressos = await prisma.ticket.findMany({ where: { orderId: pedido.id } });
    assert.equal(ingressos.length, 2);
    assert.ok(
      ingressos.every((t) => t.status === "CANCELED" && t.canceledAt),
      "o QR não vale mais na porta",
    );

    const auditoria = await prisma.auditLog.count({
      where: { entityId: pedido.id, action: "order.free_cancel" },
    });
    assert.equal(auditoria, 1, "uma linha de auditoria, do cancelamento que valeu");
    const avisos = await prisma.notification.findMany({ where: { orderId: pedido.id } });
    assert.equal(avisos.length, 1, "um e-mail só");
    assert.equal(avisos[0].template, "free_ticket_canceled");
    assert.equal(avisos[0].recipient, pedido.contactEmail);

    // terceira tentativa, com o pedido já cancelado: recusa clara e nada muda
    await assert.rejects(cancelarPedidoGratis(pedido.id, ctx.dono.id, "de novo"), /já está cancelado/);
    assert.equal((await loteAtual(ctx)).soldCount, 0);
  } finally {
    await desmontar(ctx);
  }
});

test("ingresso já usado fica como está: só a vaga do não usado volta", async () => {
  const ctx = await montar();
  try {
    const pedido = await pedidoGratis(ctx, { quantidade: 2 });
    const [usado] = await prisma.ticket.findMany({ where: { orderId: pedido.id }, orderBy: { seq: "asc" } });
    await prisma.ticket.update({
      where: { id: usado.id },
      data: { status: "CHECKED_IN", checkedInAt: new Date() },
    });

    const r = await cancelarPedidoGratis(pedido.id, ctx.dono.id, "teste");
    assert.equal(r.ingressosCancelados, 1);
    assert.equal(r.ingressosUsados, 1);
    assert.equal(r.vagasDevolvidas, 1);
    assert.equal((await loteAtual(ctx)).soldCount, 1, "a vaga de quem entrou não volta (seria overbooking)");
    const depois = await prisma.ticket.findUniqueOrThrow({ where: { id: usado.id } });
    assert.equal(depois.status, "CHECKED_IN", "quem entrou continua constando como entrou");
    // parcial: o pedido segue valendo (tem gente dentro e segue contando no limite por CPF)
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: pedido.id } })).status, "FULFILLED");
    // cancelar de novo não devolve vaga: o que sobrou já entrou
    await assert.rejects(cancelarPedidoGratis(pedido.id, ctx.dono.id, "teste"), /já foram usados na entrada/);
    assert.equal((await loteAtual(ctx)).soldCount, 1, "segunda chamada não mexe no estoque");

    // todo mundo já entrou: não há o que cancelar e o pedido fica como estava
    const cheio = await pedidoGratis(ctx, { quantidade: 1 });
    await prisma.ticket.updateMany({
      where: { orderId: cheio.id },
      data: { status: "CHECKED_IN", checkedInAt: new Date() },
    });
    const antes = (await loteAtual(ctx)).soldCount;
    await assert.rejects(cancelarPedidoGratis(cheio.id, ctx.dono.id, "teste"), /já foram usados na entrada/);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: cheio.id } })).status, "FULFILLED");
    assert.equal((await loteAtual(ctx)).soldCount, antes, "recusa não mexe no estoque");
  } finally {
    await desmontar(ctx);
  }
});

test("ingresso ainda não emitido: a vaga volta e o pedido sai de PAID; pedido pago é recusado", async () => {
  const ctx = await montar();
  try {
    const pedido = await pedidoGratis(ctx, { quantidade: 3, emitir: false });
    const r = await cancelarPedidoGratis(pedido.id, ctx.dono.id, "teste");
    assert.equal(r.naoEmitidos, 3);
    assert.equal(r.vagasDevolvidas, 3);
    assert.equal((await loteAtual(ctx)).soldCount, 0);
    const salvo = await prisma.order.findUniqueOrThrow({ where: { id: pedido.id } });
    // o worker (issue-tickets.ts) só emite pedido PAID
    assert.equal(salvo.status, "CANCELED", "fora de PAID, o ingresso não é mais emitido");

    // pedido com valor não passa por aqui: dinheiro se devolve no Reembolsar
    const pago = await pedidoGratis(ctx);
    await prisma.order.update({ where: { id: pago.id }, data: { totalCents: 5000 } });
    await assert.rejects(cancelarPedidoGratis(pago.id, ctx.dono.id, "teste"), /use Reembolsar/);
  } finally {
    await desmontar(ctx);
  }
});

test("cupom de 100%: o uso do cupom volta, como na expiração", async () => {
  const ctx = await montar();
  try {
    const cupom = await prisma.coupon.create({
      data: {
        eventId: ctx.fx.event.id,
        code: `CEM${rand()}`.toUpperCase(),
        discountType: "PERCENT",
        discountValue: 100,
        maxRedemptions: 1,
        redeemedCount: 1,
      },
    });
    const pedido = await pedidoGratis(ctx);
    await prisma.couponRedemption.create({
      data: { couponId: cupom.id, orderId: pedido.id, amountCents: 5000 },
    });

    await cancelarPedidoGratis(pedido.id, ctx.dono.id, "teste");
    assert.equal((await prisma.coupon.findUniqueOrThrow({ where: { id: cupom.id } })).redeemedCount, 0);
    assert.equal(await prisma.couponRedemption.count({ where: { orderId: pedido.id } }), 0);
  } finally {
    await desmontar(ctx);
  }
});

test("lista: a entrada é cancelada, a cota do promoter volta e endereço sintético não recebe e-mail", async () => {
  const ctx = await montar();
  try {
    const promoter = await prisma.user.create({
      data: { email: `promoter-gratis-${rand()}@borafest.dev`, name: "Promoter Teste" },
    });
    ctx.usuarios.push(promoter.id);
    await prisma.promoterLink.create({
      data: {
        organizationId: ctx.fx.organization.id,
        promoterUserId: promoter.id,
        status: "ACTIVE",
        guestQuota: 1,
        slug: `pr-gratis-${rand()}`,
      },
    });
    const lista = new GuestListService(new OrgAccessService(), new InventoryService());
    const cadastrar = (nome: string) =>
      lista.create(promoter.id, ctx.fx.event.id, {
        ticketLotId: ctx.fx.lot.id,
        guestName: nome,
        guestDocument: geraCpf(),
      });

    const entrada = await cadastrar("Convidado Um");
    assert.ok(entrada.orderId);
    await emitir(entrada.orderId!);
    await assert.rejects(cadastrar("Convidado Dois"), /cota de cortesias acabou/, "a cota (1) está usada");

    // o estorno de pedido de lista dizia "venda de porta" — agora diz o caminho certo
    await assert.rejects(
      executarReembolso(entrada.orderId!, ctx.dono.id, { reason: "teste" }),
      /Ingresso grátis não tem valor a devolver — use Cancelar ingresso/,
    );

    await cancelarPedidoGratis(entrada.orderId!, ctx.dono.id, "teste");
    const depois = await prisma.guestListEntry.findUniqueOrThrow({ where: { id: entrada.id } });
    assert.equal(depois.status, "CANCELED", "o nome sai da lista da portaria");
    assert.equal(
      await prisma.notification.count({ where: { orderId: entrada.orderId! } }),
      0,
      "e-mail sintético da lista não tem caixa — nada é enfileirado",
    );

    const outra = await cadastrar("Convidado Dois");
    assert.equal(outra.status, "CONFIRMED", "a cota voltou");
    assert.equal((await loteAtual(ctx)).soldCount, 1, "a vaga do primeiro voltou uma vez; a do segundo foi usada");
  } finally {
    await desmontar(ctx);
  }
});

test("R$ 0: estorno do produtor e pedido de reembolso do comprador recusam com a mensagem certa", async () => {
  const ctx = await montar();
  try {
    const pedido = await pedidoGratis(ctx);

    await assert.rejects(
      executarReembolso(pedido.id, ctx.dono.id, { reason: "teste" }),
      /Ingresso grátis não tem valor a devolver — use Cancelar ingresso/,
      "Total não cai mais em 'Valor do estorno inválido'",
    );
    await assert.rejects(
      executarReembolso(pedido.id, ctx.dono.id, { reason: "teste", amountCents: 100 }),
      /Ingresso grátis não tem valor a devolver — use Cancelar ingresso/,
      "Parcial não cai mais em 'excede o saldo… R$ 0,00'",
    );

    const pedidosDeReembolso = new RefundRequestsService(new OrgAccessService());
    await assert.rejects(
      pedidosDeReembolso.create(pedido.publicToken, { reason: "não vou mais" }),
      /Ingresso grátis não tem reembolso/,
    );
    assert.equal(await prisma.refundRequest.count({ where: { orderId: pedido.id } }), 0, "nada entra na fila");

    const salvo = await prisma.order.findUniqueOrThrow({ where: { id: pedido.id } });
    assert.equal(salvo.status, "FULFILLED", "recusar não mexe no pedido");
  } finally {
    await desmontar(ctx);
  }
});

test("painel: Cancelar ingresso exige a permissão do estorno e não devolve o CPF", async () => {
  const ctx = await montar();
  try {
    const pedido = await pedidoGratis(ctx);
    await prisma.order.update({ where: { id: pedido.id }, data: { contactCpf: geraCpf() } });
    const service = new CancelamentoGratisService(new OrgAccessService());

    const estranho = await prisma.user.create({ data: { email: `estranho-${rand()}@borafest.dev` } });
    ctx.usuarios.push(estranho.id);
    await assert.rejects(service.cancelarPeloProdutor(pedido.id, estranho.id, undefined), /Sem permissão/);
    assert.equal((await loteAtual(ctx)).soldCount, 1, "sem permissão, nada muda");

    const r = await service.cancelarPeloProdutor(pedido.id, ctx.dono.id, { reason: "pediu para sair" });
    assert.equal(r.status, "CANCELED");
    assert.ok(!("contactCpf" in r), "o CPF do comprador não sai na resposta");
    assert.equal((await loteAtual(ctx)).soldCount, 0);
  } finally {
    await desmontar(ctx);
  }
});

test("evento cancelado: o grátis é cancelado junto e recebe o e-mail próprio, um por pessoa", async () => {
  const ctx = await montar();
  try {
    const email = `gratis-${rand()}@borafest.dev`;
    const p1 = await pedidoGratis(ctx, { quantidade: 2, email });
    const p2 = await pedidoGratis(ctx, { quantidade: 1, email, emitir: false });
    const events = new EventsService(new OrgAccessService());

    const previa = await events.previewCancel(ctx.fx.event.id, ctx.dono.id);
    assert.equal(previa.orders, 0, "ninguém recebe dinheiro de volta");
    assert.equal(previa.freeOrders, 2);

    const r = await events.cancel(ctx.fx.event.id, ctx.dono.id, { reason: "chuva forte" });
    assert.deepEqual(r.errors, []);
    assert.equal(r.refundedNow, 0);
    assert.equal(r.freeCanceledNow, 2);
    assert.equal(r.remaining, 0);

    for (const p of [p1, p2]) {
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: p.id } })).status, "CANCELED");
    }
    const validos = await prisma.ticket.count({
      where: { eventId: ctx.fx.event.id, status: { in: ["ISSUED", "ACTIVE"] } },
    });
    assert.equal(validos, 0, "nenhum QR vale num evento cancelado");
    assert.equal((await loteAtual(ctx)).soldCount, 0);

    const avisos = await prisma.notification.findMany({ where: { orderId: { in: [p1.id, p2.id] } } });
    assert.equal(avisos.length, 1, "um e-mail por pessoa, mesmo com dois pedidos");
    assert.equal(avisos[0].template, "free_event_canceled");
    assert.equal(avisos[0].recipient, email);
    assert.equal((avisos[0].payload as { motivo?: string }).motivo, "chuva forte");

    // a tela repete enquanto remaining > 0: a segunda volta não acha mais nada
    const deNovo = await events.cancel(ctx.fx.event.id, ctx.dono.id, { reason: "chuva forte" });
    assert.equal(deNovo.freeCanceledNow, 0);
    assert.equal(deNovo.remaining, 0);
    assert.deepEqual(deNovo.errors, []);
  } finally {
    await desmontar(ctx);
  }
});

test("e-mails do cancelamento grátis não falam de dinheiro", () => {
  const ingresso = renderFreeTicketCanceledEmail("ana@test.dev", {
    contactName: "Ana",
    eventTitle: "Festa <X>",
    eventStartsAt: "20/11/2026 22:00",
    casa: "Casa Teste",
    quantidade: 2,
  });
  const evento = renderFreeEventCanceledEmail("ana@test.dev", {
    contactName: "Ana",
    eventTitle: "Festa <X>",
    casa: "Casa Teste",
    motivo: "chuva forte",
  });
  assert.match(ingresso.subject, /^Seus ingressos foram cancelados — Festa <X>$/);
  assert.equal(evento.subject, "O evento Festa <X> foi cancelado");
  assert.ok(evento.text.includes("Motivo: chuva forte"));
  for (const e of [ingresso, evento]) {
    assert.doesNotMatch(`${e.subject} ${e.text} ${e.html}`, /dinheiro|reembols|estorno|devolvid|valor pago/i);
    assert.ok(!e.html.includes("<X>"), "HTML escapado");
  }
});
