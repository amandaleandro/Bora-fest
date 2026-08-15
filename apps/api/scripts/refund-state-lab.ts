/**
 * LABORATÓRIO da máquina de estados do reembolso (pedido do Arthur 2026-08-15):
 * roda o CÓDIGO REAL (executeOrderRefund + reconcilePendingPayments) contra um
 * Postgres descartável, com um gateway instrumentado que CONTA chamadas de
 * estorno — provando que dinheiro nunca sai duas vezes e que todo estado
 * converge para REFUNDED.
 *
 * Uso: DATABASE_URL=postgresql://borafest@localhost:5544/borafest_lab \
 *        apps/api/node_modules/.bin/tsx apps/api/scripts/refund-state-lab.ts
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@borafest/database";
import { registerGateway } from "@borafest/payments";
import { executeOrderRefund } from "../src/common/execute-refund";
import { reconcilePendingPayments } from "../../worker/src/reconcile-payments";

let refundCalls = 0;
let gatewayDiz: "PAID" | "REFUNDED" = "PAID";
registerGateway({
  provider: "lab",
  createPixCharge: async () => {
    throw new Error("não usado no lab");
  },
  createCardPayment: async () => {
    throw new Error("não usado no lab");
  },
  refund: async () => {
    refundCalls += 1;
    return { externalId: "lab-refund", status: "REFUNDED" as const };
  },
  getStatus: async () => gatewayDiz,
  verifyWebhook: () => {
    throw new Error("não usado no lab");
  },
} as never);

const resultados: Array<[string, boolean, string]> = [];
function check(nome: string, ok: boolean, detalhe = ""): void {
  resultados.push([nome, ok, detalhe]);
  console.log((ok ? "PASS  " : "FAIL  ") + nome + (ok ? "" : `  [${detalhe}]`));
}

let n = 0;
async function seed(opts: {
  payStatus: "PAID" | "REFUND_PENDING" | "REFUNDED";
  orderStatus: "FULFILLED" | "REFUNDED";
  createdAt?: Date;
  ledger?: boolean;
}) {
  n += 1;
  const org = await prisma.organization.create({
    data: { name: `Lab ${n}`, slug: `lab-${n}-${randomUUID().slice(0, 6)}`, kind: "INDIVIDUAL", document: `labdoc${n}${Date.now()}` },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      title: `Evento Lab ${n}`,
      slug: `ev-lab-${n}-${randomUUID().slice(0, 6)}`,
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      category: "FESTAS",
    },
  });
  const type = await prisma.ticketType.create({ data: { eventId: event.id, name: "Pista" } });
  const lot = await prisma.ticketLot.create({
    data: { ticketTypeId: type.id, name: "1º lote", priceCents: 1000, feeCents: 100, capacity: 10, soldCount: 1, status: "ACTIVE" },
  });
  const reservation = await prisma.reservation.create({
    data: { event: { connect: { id: event.id } }, expiresAt: new Date(Date.now() + 15 * 60_000) },
  });
  const order = await prisma.order.create({
    data: {
      event: { connect: { id: event.id } },
      reservation: { connect: { id: reservation.id } },
      publicToken: randomUUID(),
      contactEmail: `lab${n}@borafest.dev`,
      totalCents: 1100,
      status: opts.orderStatus,
      items: { create: { ticketLot: { connect: { id: lot.id } }, quantity: 1, priceCents: 1000, feeCents: 100 } },
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "lab",
      method: "PIX",
      amountCents: 1100,
      status: opts.payStatus,
      externalId: `ext-${n}-${randomUUID().slice(0, 8)}`,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
  if (opts.ledger) {
    const acc = await prisma.ledgerAccount.create({ data: { organizationId: org.id } });
    await prisma.ledgerEntry.createMany({
      data: [
        { ledgerAccountId: acc.id, type: "SALE_CREDIT", amountCents: 1100, referenceType: "payment", referenceId: payment.id, availableAt: new Date() },
        { ledgerAccountId: acc.id, type: "PLATFORM_FEE", amountCents: -100, referenceType: "payment", referenceId: payment.id },
      ],
    });
  }
  return { org, event, lot, order, payment, accId: opts.ledger };
}

async function estado(orderId: string, paymentId: string, lotId: string) {
  const [order, payment, lot, outbox] = await Promise.all([
    prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }),
    prisma.ticketLot.findUniqueOrThrow({ where: { id: lotId } }),
    prisma.outboxEvent.count({ where: { aggregateId: orderId, eventType: "order.payment_reversed" } }),
  ]);
  return { order: order.status, payment: payment.status, sold: lot.soldCount, reversedEvents: outbox };
}

async function main() {
  // S1 — estorno NORMAL: pago aqui e pago no gateway → estorna 1x e baixa tudo
  {
    const s = await seed({ payStatus: "PAID", orderStatus: "FULFILLED", ledger: true });
    gatewayDiz = "PAID";
    const antes = refundCalls;
    await executeOrderRefund(s.order.publicToken, { idempotencyPrefix: "lab-s1" });
    const e = await estado(s.order.id, s.payment.id, s.lot.id);
    check("S1 estorno normal: 1 chamada de estorno no gateway", refundCalls - antes === 1, `calls=${refundCalls - antes}`);
    check("S1 pedido→REFUNDED, pagamento→REFUNDED", e.order === "REFUNDED" && e.payment === "REFUNDED", JSON.stringify(e));
    check("S1 estoque devolvido (soldCount 1→0)", e.sold === 0, `sold=${e.sold}`);
    check("S1 evento de reversão no outbox (worker cancela tickets)", e.reversedEvents === 1, `n=${e.reversedEvents}`);
    const debito = await prisma.ledgerEntry.aggregate({
      where: { referenceType: "payment", referenceId: s.payment.id, type: "REFUND_DEBIT" },
      _sum: { amountCents: true },
    });
    check("S1 ledger debitado no líquido (-R$10,00)", debito._sum.amountCents === -1000, `debito=${debito._sum.amountCents}`);

    // S6 — clique DUPLO no mesmo pedido: curto-circuito, zero novo estorno
    const antes2 = refundCalls;
    const r2 = await executeOrderRefund(s.order.publicToken, { idempotencyPrefix: "lab-s1" });
    check("S6 segundo clique: ZERO novo estorno + retorna REFUNDED", refundCalls - antes2 === 0 && r2.gatewayStatus === "REFUNDED", `calls=${refundCalls - antes2} st=${r2.gatewayStatus}`);
  }

  // S2 — CASO MARCELA: local diz pago, gateway diz estornado → só baixa, sem re-estornar
  {
    const s = await seed({ payStatus: "PAID", orderStatus: "FULFILLED" });
    gatewayDiz = "REFUNDED";
    const antes = refundCalls;
    await executeOrderRefund(s.order.publicToken, { idempotencyPrefix: "lab-s2" });
    const e = await estado(s.order.id, s.payment.id, s.lot.id);
    check("S2 caso Marcela: ZERO chamada de estorno (só reconcilia)", refundCalls - antes === 0, `calls=${refundCalls - antes}`);
    check("S2 pedido→REFUNDED, pagamento→REFUNDED, estoque devolvido", e.order === "REFUNDED" && e.payment === "REFUNDED" && e.sold === 0, JSON.stringify(e));
  }

  // S3 — PRESO no meio (REFUND_PENDING): clique reconcilia sem re-estornar
  {
    const s = await seed({ payStatus: "REFUND_PENDING", orderStatus: "FULFILLED" });
    gatewayDiz = "REFUNDED";
    const antes = refundCalls;
    await executeOrderRefund(s.order.publicToken, { idempotencyPrefix: "lab-s3" });
    const e = await estado(s.order.id, s.payment.id, s.lot.id);
    check("S3 preso no meio: ZERO novo estorno", refundCalls - antes === 0, `calls=${refundCalls - antes}`);
    check("S3 pedido→REFUNDED", e.order === "REFUNDED" && e.payment === "REFUNDED", JSON.stringify(e));
  }

  // S4 — JÁ reembolsado de ponta a ponta: aprovar só confirma, nada muda
  {
    const s = await seed({ payStatus: "REFUNDED", orderStatus: "REFUNDED" });
    gatewayDiz = "REFUNDED";
    const antes = refundCalls;
    const r = await executeOrderRefund(s.order.publicToken, { idempotencyPrefix: "lab-s4" });
    check("S4 já reembolsado: ZERO estorno + retorna REFUNDED", refundCalls - antes === 0 && r.gatewayStatus === "REFUNDED", `calls=${refundCalls - antes} st=${r.gatewayStatus}`);
  }

  // S5 — AUTO-CURA do worker: preso há >2min, reconciliador resolve sozinho
  {
    const s = await seed({ payStatus: "REFUND_PENDING", orderStatus: "FULFILLED", createdAt: new Date(Date.now() - 10 * 60_000) });
    gatewayDiz = "REFUNDED";
    const antes = refundCalls;
    await reconcilePendingPayments();
    const e = await estado(s.order.id, s.payment.id, s.lot.id);
    check("S5 auto-cura do worker: pedido→REFUNDED sem clique", e.order === "REFUNDED" && e.payment === "REFUNDED", JSON.stringify(e));
    check("S5 auto-cura: ZERO chamada de estorno", refundCalls - antes === 0, `calls=${refundCalls - antes}`);
  }

  // S7 — CONGRUÊNCIA: pagamento "pago" + request de reembolso ABERTO + gateway
  // diz estornado → o worker baixa tudo E FECHA o request sozinho (zero clique)
  {
    const s = await seed({ payStatus: "PAID", orderStatus: "FULFILLED" });
    const request = await prisma.refundRequest.create({
      data: { orderId: s.order.id, reason: "lab S7", status: "PENDING" },
    });
    gatewayDiz = "REFUNDED";
    const antes = refundCalls;
    await reconcilePendingPayments();
    const e = await estado(s.order.id, s.payment.id, s.lot.id);
    const reqDepois = await prisma.refundRequest.findUniqueOrThrow({ where: { id: request.id } });
    check("S7 drift pago+request aberto: pedido→REFUNDED sem clique", e.order === "REFUNDED" && e.payment === "REFUNDED", JSON.stringify(e));
    check("S7 request FECHADO automaticamente (APPROVED)", reqDepois.status === "APPROVED" && reqDepois.resolvedAt !== null, reqDepois.status);
    check("S7 ZERO chamada de estorno", refundCalls - antes === 0, `calls=${refundCalls - antes}`);
  }

  const falhas = resultados.filter(([, ok]) => !ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} PASS` + (falhas.length ? ` — FALHAS: ${falhas.map(([nome]) => nome).join("; ")}` : " — MÁQUINA DE ESTADOS VALIDADA"));
  process.exit(falhas.length ? 1 : 0);
}

main().catch((err) => {
  console.error("ERRO no lab:", err);
  process.exit(1);
});
