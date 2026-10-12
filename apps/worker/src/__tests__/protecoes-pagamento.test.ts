import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import {
  applyGatewayStatus,
  getGateway,
  mockSignWebhookBody,
  DESCRICAO_CHARGEBACK,
  DESCRICAO_CHARGEBACK_REVERTIDO,
  type MockGateway,
} from "@borafest/payments";
import { ReservationsService } from "../../../api/src/reservations/reservations.service";
import { CouponsService } from "../../../api/src/coupons/coupons.service";
import { OrgAccessService } from "../../../api/src/common/org-access.service";
import { OrdersService } from "../../../api/src/orders/orders.service";
import { InventoryService } from "../../../api/src/inventory/inventory.service";
import { WaitingRoomService } from "../../../api/src/waiting-room/waiting-room.service";
import { createFixtureEvent, cleanupFixtureEvent } from "../../../api/src/__tests__/helpers";
import { processPaymentWebhookJob } from "../process-payment-webhook";
import { reviewChargebackPayments } from "../reconcile-payments";

/**
 * Proteções de pagamento (2026-10-12), com o gateway MOCK no lugar do PSP:
 * (1) conferência do valor pago antes de faturar e (2) chargeback com disputa
 * ganha devolvendo o crédito do produtor sem reemitir ingresso.
 */

after(async () => {
  await closeRedisConnection();
  await prisma.$disconnect();
});

// o mesmo MockGateway que o applyGatewayStatus usa (registry do pacote)
const mock = getGateway("mock") as MockGateway;

type Fixture = Awaited<ReturnType<typeof createFixtureEvent>>;

function sufixo(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function pendingPayment(fixture: Fixture) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  const reservation = await reservations.create(undefined, {
    eventId: fixture.event.id,
    items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: `protecao-${sufixo()}@borafest.dev`,
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "mock",
      method: "PIX",
      amountCents: order.totalCents,
      status: "PENDING",
      externalId: `mock_pix_protecao_${sufixo()}`,
    },
  });
  return { order, payment, externalId: payment.externalId! };
}

/** pedido pago pelo valor cheio (o gateway mock confirma o mesmo valor) */
async function paidPayment(fixture: Fixture) {
  const pendente = await pendingPayment(fixture);
  mock.simulatePayment(pendente.externalId, "PAID", pendente.payment.amountCents);
  const pago = await applyGatewayStatus(pendente.payment.id, "PAID");
  assert.equal(pago.orderPaid, true, "pré-condição: pedido pago pelo valor cheio");
  return pendente;
}

/** soma do ledger da CASA para este pagamento (venda − taxa − estornos + restaurações) */
async function saldoDaCasa(paymentId: string, organizationId: string): Promise<number> {
  const agg = await prisma.ledgerEntry.aggregate({
    where: { referenceType: "payment", referenceId: paymentId, ledgerAccount: { organizationId } },
    _sum: { amountCents: true },
  });
  return agg._sum.amountCents ?? 0;
}

async function contarOutbox(aggregateId: string, eventType: string): Promise<number> {
  return prisma.outboxEvent.count({ where: { aggregateId, eventType } });
}

async function contarAuditoria(orderId: string, action: string): Promise<number> {
  return prisma.auditLog.count({ where: { entityType: "order", entityId: orderId, action } });
}

async function limparAlertas(ids: string[]): Promise<void> {
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
}

function webhookMock(paymentExternalId: string, status: string) {
  const rawBody = JSON.stringify({
    id: `evt_protecao_${sufixo()}`,
    paymentExternalId,
    type: `payment.${status.toLowerCase()}`,
    status,
  });
  return {
    provider: "mock",
    headers: { "x-mock-signature": mockSignWebhookBody(rawBody) },
    rawBody,
  };
}

// ---------------------------------------------------------------------------
// (1) valor pago menor que o cobrado
// ---------------------------------------------------------------------------

test("pagou MENOS (gateway consultado): não fatura, pedido segue pendente e o backoffice é alertado UMA vez", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 500 });
  const { order, payment, externalId } = await pendingPayment(fixture);
  try {
    mock.simulatePayment(externalId, "PAID", payment.amountCents - 100);

    const r1 = await applyGatewayStatus(payment.id, "PAID");
    assert.equal(r1.amountMismatch, true, "a diferença tem que ser detectada");
    assert.equal(r1.orderPaid, false, "pedido NÃO pode ser confirmado");
    assert.equal(r1.paymentChanged, false);

    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(p.status, "PENDING", "pagamento não vira PAID");
    const meta = p.metadata as unknown as {
      amountMismatch?: { paidCents?: number; expectedCents?: number };
    };
    assert.equal(meta.amountMismatch?.paidCents, payment.amountCents - 100);
    assert.equal(meta.amountMismatch?.expectedCents, payment.amountCents);

    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.ok(["CREATED", "PAYMENT_PENDING"].includes(o.status), `pedido segue pendente (veio ${o.status})`);

    const credito = await prisma.ledgerEntry.count({
      where: { referenceType: "payment", referenceId: payment.id, type: "SALE_CREDIT" },
    });
    assert.equal(credito, 0, "nada pode ser creditado ao produtor");
    assert.equal(await contarOutbox(order.id, "order.paid"), 0, "sem emissão de ingresso");

    assert.equal(await contarOutbox(payment.id, "payment.amount_mismatch"), 1);
    assert.equal(await contarAuditoria(order.id, "payment.amount_mismatch"), 1);

    // webhook repetido / reconciliação de novo com o MESMO valor: sem alerta duplicado
    const r2 = await applyGatewayStatus(payment.id, "PAID");
    assert.equal(r2.amountMismatch, true);
    assert.equal(await contarOutbox(payment.id, "payment.amount_mismatch"), 1, "alerta não duplica");
    assert.equal(await contarAuditoria(order.id, "payment.amount_mismatch"), 1, "auditoria não duplica");
  } finally {
    await limparAlertas([payment.id, order.id]);
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("valor informado pelo chamador: a menor barra; o valor cheio confirma normalmente", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 500 });
  const { order, payment } = await pendingPayment(fixture);
  try {
    const menor = await applyGatewayStatus(payment.id, "PAID", undefined, {
      paidAmountCents: payment.amountCents - 1,
    });
    assert.equal(menor.amountMismatch, true, "1 centavo a menos já não fatura");
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
      "PENDING",
    );

    const cheio = await applyGatewayStatus(payment.id, "PAID", undefined, {
      paidAmountCents: payment.amountCents,
    });
    assert.equal(cheio.orderPaid, true, "valor cheio confirma");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(o.status, "PAID");
  } finally {
    await limparAlertas([payment.id, order.id]);
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("valor a MAIS (ex.: juros do parcelamento pagos pelo comprador) confirma normalmente", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 500 });
  const { order, payment, externalId } = await pendingPayment(fixture);
  try {
    mock.simulatePayment(externalId, "PAID", payment.amountCents + 350);
    const r = await applyGatewayStatus(payment.id, "PAID");
    assert.equal(r.orderPaid, true);
    assert.notEqual(r.amountMismatch, true);
  } finally {
    await limparAlertas([payment.id, order.id]);
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("webhook PAID de valor a menor (caminho do worker): pedido não confirma e o evento fecha como processado", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 500 });
  const { order, payment, externalId } = await pendingPayment(fixture);
  try {
    mock.simulatePayment(externalId, "PAID", payment.amountCents - 500);
    await processPaymentWebhookJob(webhookMock(externalId, "PAID"));

    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(p.status, "PENDING");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.notEqual(o.status, "PAID");
    assert.equal(await contarOutbox(payment.id, "payment.amount_mismatch"), 1);
  } finally {
    await limparAlertas([payment.id, order.id]);
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

// ---------------------------------------------------------------------------
// (2) chargeback com disputa GANHA
// ---------------------------------------------------------------------------

test("chargeback ganho: crédito do produtor volta, pedido segue em CHARGEBACK e nada é reemitido", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 500 });
  const { order, payment } = await paidPayment(fixture);
  const orgId = fixture.organization.id;
  try {
    const liquidoDaVenda = await saldoDaCasa(payment.id, orgId);
    assert.ok(liquidoDaVenda > 0, "pré-condição: venda creditada");

    await applyGatewayStatus(payment.id, "CHARGEBACK");
    assert.equal(await saldoDaCasa(payment.id, orgId), 0, "chargeback tira a venda do produtor");
    const marcado = await prisma.ledgerEntry.count({
      where: { referenceType: "payment", referenceId: payment.id, description: DESCRICAO_CHARGEBACK },
    });
    assert.ok(marcado > 0, "lançamentos do chargeback ficam marcados");

    const r = await applyGatewayStatus(payment.id, "CHARGEBACK_REVERSED");
    assert.equal(r.chargebackReversed, true);
    assert.equal(r.paymentChanged, true);

    assert.equal(await saldoDaCasa(payment.id, orgId), liquidoDaVenda, "o valor da venda volta ao produtor");
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(p.status, "PAID", "o dinheiro voltou para a plataforma");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(o.status, "CHARGEBACK", "pedido não volta sozinho: reemissão é decisão do backoffice");
    assert.equal(await contarOutbox(order.id, "order.paid"), 1, "nenhuma nova emissão de ingresso");
    assert.equal(await contarOutbox(payment.id, "payment.chargeback_reversed"), 1);
    assert.equal(await contarAuditoria(order.id, "payment.chargeback_reversed"), 1);

    // aviso repetido: no-op
    const deNovo = await applyGatewayStatus(payment.id, "CHARGEBACK_REVERSED");
    assert.equal(deNovo.paymentChanged, false);
    assert.equal(await saldoDaCasa(payment.id, orgId), liquidoDaVenda, "não restaura duas vezes");
    assert.equal(await contarAuditoria(order.id, "payment.chargeback_reversed"), 1);
  } finally {
    await limparAlertas([payment.id, order.id]);
    await cleanupFixtureEvent(orgId);
  }
});

test("revisão periódica: disputa ganha SEM webhook é achada pelo status atual no gateway", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 500 });
  const { order, payment, externalId } = await paidPayment(fixture);
  const orgId = fixture.organization.id;
  try {
    const liquidoDaVenda = await saldoDaCasa(payment.id, orgId);
    mock.simulatePayment(externalId, "CHARGEBACK");
    await applyGatewayStatus(payment.id, "CHARGEBACK");
    assert.equal(await saldoDaCasa(payment.id, orgId), 0);

    // enquanto o gateway diz CHARGEBACK, a revisão não mexe em nada
    assert.equal(await reviewChargebackPayments({ paymentIds: [payment.id] }), 0);
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
      "CHARGEBACK",
    );

    // a disputa foi ganha: no gateway a cobrança voltou a "paga"
    mock.simulatePayment(externalId, "PAID", payment.amountCents);
    assert.equal(await reviewChargebackPayments({ paymentIds: [payment.id] }), 1);

    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(p.status, "PAID");
    assert.equal(await saldoDaCasa(payment.id, orgId), liquidoDaVenda);
    assert.equal(await contarAuditoria(order.id, "payment.chargeback_reversed"), 1);
  } finally {
    await limparAlertas([payment.id, order.id]);
    await cleanupFixtureEvent(orgId);
  }
});

test("webhook 'disputa vencida' (CHARGEBACK_REVERSED) pelo worker restaura o crédito", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 500 });
  const { order, payment, externalId } = await paidPayment(fixture);
  const orgId = fixture.organization.id;
  try {
    const liquidoDaVenda = await saldoDaCasa(payment.id, orgId);
    await processPaymentWebhookJob(webhookMock(externalId, "CHARGEBACK"));
    assert.equal(await saldoDaCasa(payment.id, orgId), 0);

    await processPaymentWebhookJob(webhookMock(externalId, "CHARGEBACK_REVERSED"));
    assert.equal(await saldoDaCasa(payment.id, orgId), liquidoDaVenda);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(p.status, "PAID");
  } finally {
    await limparAlertas([payment.id, order.id]);
    await cleanupFixtureEvent(orgId);
  }
});

test("estorno pelo backoffice DEPOIS da disputa ganha: desfaz a restauração sem debitar nem devolver estoque em dobro", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 500 });
  const orgId = fixture.organization.id;
  // outra venda no mesmo lote: se o estoque voltasse duas vezes, o vendido cairia para 0
  const outra = await paidPayment(fixture);
  const { order, payment } = await paidPayment(fixture);
  try {
    const vendidoAntes = (await prisma.ticketLot.findUniqueOrThrow({ where: { id: fixture.lot.id } })).soldCount;
    await applyGatewayStatus(payment.id, "CHARGEBACK");
    await applyGatewayStatus(payment.id, "CHARGEBACK_REVERSED");
    const vendidoDepoisDaDisputa = (await prisma.ticketLot.findUniqueOrThrow({ where: { id: fixture.lot.id } }))
      .soldCount;
    assert.equal(vendidoDepoisDaDisputa, vendidoAntes - 1, "o chargeback devolveu 1 unidade ao estoque");

    await applyGatewayStatus(payment.id, "REFUNDED");

    assert.equal(await saldoDaCasa(payment.id, orgId), 0, "o reembolso tira a venda restaurada — uma vez só");
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(p.status, "REFUNDED");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(o.status, "REFUNDED");
    const vendidoFinal = (await prisma.ticketLot.findUniqueOrThrow({ where: { id: fixture.lot.id } })).soldCount;
    assert.equal(vendidoFinal, vendidoDepoisDaDisputa, "estoque não volta de novo");
  } finally {
    await limparAlertas([payment.id, order.id, outra.payment.id, outra.order.id]);
    await cleanupFixtureEvent(orgId);
  }
});

test("ciclo chargeback → ganho → novo chargeback → ganho mantém o ledger certo", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 500 });
  const { order, payment } = await paidPayment(fixture);
  const orgId = fixture.organization.id;
  try {
    const liquidoDaVenda = await saldoDaCasa(payment.id, orgId);

    await applyGatewayStatus(payment.id, "CHARGEBACK");
    await applyGatewayStatus(payment.id, "CHARGEBACK_REVERSED");
    assert.equal(await saldoDaCasa(payment.id, orgId), liquidoDaVenda);

    // segundo chargeback com o pedido JÁ em CHARGEBACK: antes não revertia nada
    await applyGatewayStatus(payment.id, "CHARGEBACK");
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
      "CHARGEBACK",
    );
    assert.equal(await saldoDaCasa(payment.id, orgId), 0, "novo chargeback tira de novo");

    await applyGatewayStatus(payment.id, "CHARGEBACK_REVERSED");
    assert.equal(await saldoDaCasa(payment.id, orgId), liquidoDaVenda, "e a nova disputa ganha devolve");

    const restauracoes = await prisma.ledgerEntry.count({
      where: { referenceType: "payment", referenceId: payment.id, description: DESCRICAO_CHARGEBACK_REVERTIDO },
    });
    assert.ok(restauracoes >= 2, "cada disputa ganha deixa seu lançamento de restauração");
  } finally {
    await limparAlertas([payment.id, order.id]);
    await cleanupFixtureEvent(orgId);
  }
});

test("CHARGEBACK_REVERSED sem chargeback antes (pagamento PAID) é no-op", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 500 });
  const { order, payment } = await paidPayment(fixture);
  const orgId = fixture.organization.id;
  try {
    const antes = await saldoDaCasa(payment.id, orgId);
    const r = await applyGatewayStatus(payment.id, "CHARGEBACK_REVERSED");
    assert.equal(r.paymentChanged, false);
    assert.notEqual(r.chargebackReversed, true);
    assert.equal(await saldoDaCasa(payment.id, orgId), antes);
    assert.equal(await contarAuditoria(order.id, "payment.chargeback_reversed"), 0);
  } finally {
    await limparAlertas([payment.id, order.id]);
    await cleanupFixtureEvent(orgId);
  }
});
