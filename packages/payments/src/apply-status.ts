import {
  confirmSaleInventory,
  returnSaleInventory,
  prisma,
  Prisma,
  type PaymentMethod as DbPaymentMethod,
  type PaymentStatus as DbPaymentStatus,
} from "@borafest/database";
import type { GatewayPaymentStatus } from "./types";
import { computePlatformFeeCents } from "./fees";

/**
 * Aplica um status vindo do gateway (webhook, cartão síncrono ou reconciliação)
 * ao pagamento e ao pedido, de forma idempotente e tolerante a eventos fora de
 * ordem:
 *
 * - transições usam `updateMany` com guarda de status — quem chegar primeiro
 *   vence; repetição e regressão viram no-op;
 * - PAID: pedido → PAID + estoque reservado vira vendido + outbox `order.paid`
 *   (emissão de ingressos exatamente-uma-vez no worker);
 * - PAID com pedido já expirado/cancelado: outbox `payment.orphaned`
 *   (estorno automático no worker) — caso "pagamento aprovado depois da
 *   reserva expirar" da arquitetura §22;
 * - REFUNDED/CHARGEBACK: pedido acompanha e outbox `order.payment_reversed`
 *   revoga os ingressos.
 */

export interface ApplyStatusResult {
  paymentChanged: boolean;
  orderPaid: boolean;
  orphaned: boolean;
}

const PAYABLE_ORDER_STATUSES = ["CREATED", "PAYMENT_PENDING"] as const;
const OPEN_PAYMENT_STATUSES: DbPaymentStatus[] = ["PENDING", "AUTHORIZED"];

export interface ApplyStatusOptions {
  /**
   * Valor estornado quando conhecido (fluxo admin). Menor que o valor do
   * pagamento → estorno PARCIAL: só debita o ledger e marca o pedido como
   * PARTIALLY_REFUNDED — ingressos e estoque ficam intactos. Ausente ou
   * igual ao total → estorno total (comportamento de sempre).
   */
  refundAmountCents?: number;
}

export async function applyGatewayStatus(
  paymentId: string,
  status: GatewayPaymentStatus,
  occurredAt?: Date,
  options?: ApplyStatusOptions,
): Promise<ApplyStatusResult> {
  const result: ApplyStatusResult = { paymentChanged: false, orderPaid: false, orphaned: false };

  switch (status) {
    case "PENDING":
      return result;

    case "AUTHORIZED": {
      const updated = await prisma.payment.updateMany({
        where: { id: paymentId, status: "PENDING" },
        data: { status: "AUTHORIZED" },
      });
      result.paymentChanged = updated.count > 0;
      return result;
    }

    case "PAID":
      return applyPaid(paymentId, occurredAt);

    case "FAILED":
    case "CANCELED":
    case "EXPIRED": {
      const updated = await prisma.payment.updateMany({
        where: { id: paymentId, status: { in: OPEN_PAYMENT_STATUSES } },
        data: { status },
      });
      result.paymentChanged = updated.count > 0;
      return result;
    }

    case "REFUNDED": {
      if (options?.refundAmountCents !== undefined) {
        const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
        if (payment && options.refundAmountCents < payment.amountCents) {
          return applyPartialRefund(paymentId, options.refundAmountCents);
        }
      }
      return applyReversal(paymentId, "REFUNDED");
    }
    case "CHARGEBACK":
      return applyReversal(paymentId, status);

    default:
      return result;
  }
}

async function applyPaid(paymentId: string, occurredAt?: Date): Promise<ApplyStatusResult> {
  return prisma.$transaction(async (tx) => {
    const result: ApplyStatusResult = { paymentChanged: false, orderPaid: false, orphaned: false };

    const paidAt = occurredAt ?? new Date();
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return result;

    // O dinheiro se moveu no gateway: PAID vence qualquer estado local
    // não-monetário — inclusive EXPIRED/FAILED/CANCELED (webhook atrasado,
    // §22 "pagamento aprovado depois da reserva expirar"). Só não regride
    // estados monetários (PAID/REFUND_*/CHARGEBACK).
    const updatedPayment = await tx.payment.updateMany({
      where: {
        id: paymentId,
        status: { in: [...OPEN_PAYMENT_STATUSES, "EXPIRED", "FAILED", "CANCELED"] },
      },
      data: { status: "PAID", paidAt },
    });
    result.paymentChanged = updatedPayment.count > 0;
    if (!result.paymentChanged) {
      // já estava PAID (webhook duplicado) ou em estado monetário — no-op
      return result;
    }

    const updatedOrder = await tx.order.updateMany({
      where: { id: payment.orderId, status: { in: [...PAYABLE_ORDER_STATUSES] } },
      data: { status: "PAID", paidAt },
    });

    if (updatedOrder.count === 0) {
      // pedido expirou/cancelou (ou já foi pago por outro pagamento):
      // não há como honrar — estorno automático via worker
      result.orphaned = true;
      await tx.outboxEvent.create({
        data: {
          aggregateType: "payment",
          aggregateId: paymentId,
          eventType: "payment.orphaned",
          payload: { paymentId, orderId: payment.orderId },
        },
      });
      return result;
    }

    const items = await tx.orderItem.findMany({ where: { orderId: payment.orderId } });
    for (const item of items) {
      await confirmSaleInventory(tx, item.ticketLotId, item.quantity);
    }

    await creditOrganizationLedger(tx, payment);
    await splitPromoterCommission(tx, payment);

    await tx.outboxEvent.create({
      data: {
        aggregateType: "order",
        aggregateId: payment.orderId,
        eventType: "order.paid",
        payload: { orderId: payment.orderId, paymentId },
      },
    });

    result.orderPaid = true;
    return result;
  });
}

/** SALE_CREDIT (bruto) + PLATFORM_FEE (comissão) no ledger da organização do evento. */
async function creditOrganizationLedger(
  tx: Prisma.TransactionClient,
  payment: { id: string; orderId: string; amountCents: number; method: DbPaymentMethod },
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: { event: { select: { organizationId: true, endsAt: true } } },
  });
  if (!order) return;

  const organizationId = order.event.organizationId;
  const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });

  const ledgerAccount = await tx.ledgerAccount.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId },
  });

  // comissão = a taxa de serviço efetivamente definida nos itens do pedido
  // (decisão 2026-08-01): o que o comprador viu é o que o caixa lança — nos
  // dois meios de pagamento. computePlatformFeeCents segue sendo a fonte do
  // VALOR, mas na criação do lote (catalog), não aqui.
  const items = await tx.orderItem.findMany({
    where: { orderId: payment.orderId },
    select: { quantity: true, feeCents: true },
  });
  const feeCents = items.reduce((sum, item) => sum + item.feeCents * item.quantity, 0);

  // Molde de saque v2 (decisão 2026-08-09, padrão de mercado): o crédito da
  // venda LIBERA D+N úteis DEPOIS DO EVENTO — o maior risco de ticketeria é
  // o evento não acontecer, e aí todo mundo tem reembolso. INSTANT (casas de
  // confiança) continua sacando antes, pagando antecipação sobre o que ainda
  // não liberou; a data em si é fato imutável do lançamento.
  const availableAt = addBusinessDays(
    order.event.endsAt,
    Number(process.env.RELEASE_BUSINESS_DAYS_AFTER_EVENT ?? 2),
  );

  await tx.ledgerEntry.createMany({
    data: [
      {
        ledgerAccountId: ledgerAccount.id,
        type: "SALE_CREDIT",
        amountCents: payment.amountCents,
        referenceType: "payment",
        referenceId: payment.id,
        availableAt,
      },
      {
        ledgerAccountId: ledgerAccount.id,
        type: "PLATFORM_FEE",
        amountCents: -feeCents,
        referenceType: "payment",
        referenceId: payment.id,
      },
    ],
  });
}

/**
 * Estorno PARCIAL: debita só o valor devolvido no ledger da organização e
 * marca o pedido como PARTIALLY_REFUNDED. Ingressos continuam válidos e o
 * estoque vendido não volta — a comissão da plataforma não é ajustada
 * (decisão registrada: taxa é sobre a transação original).
 */
async function applyPartialRefund(
  paymentId: string,
  amountCents: number,
): Promise<ApplyStatusResult> {
  return prisma.$transaction(async (tx) => {
    const result: ApplyStatusResult = { paymentChanged: false, orderPaid: false, orphaned: false };

    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return result;

    // o dinheiro parcial voltou; o pagamento permanece PAID (não é terminal)
    const normalized = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: ["PAID", "REFUND_PENDING"] } },
      data: { status: "PAID" },
    });
    result.paymentChanged = normalized.count > 0;
    if (!result.paymentChanged) return result;

    await tx.order.updateMany({
      where: {
        id: payment.orderId,
        status: { in: ["PAID", "FULFILLED", "PARTIALLY_REFUNDED"] },
      },
      data: { status: "PARTIALLY_REFUNDED" },
    });

    const order = await tx.order.findUnique({
      where: { id: payment.orderId },
      select: { event: { select: { organizationId: true } } },
    });
    if (order) {
      const ledgerAccount = await tx.ledgerAccount.upsert({
        where: { organizationId: order.event.organizationId },
        update: {},
        create: { organizationId: order.event.organizationId },
      });
      await tx.ledgerEntry.create({
        data: {
          ledgerAccountId: ledgerAccount.id,
          type: "REFUND_DEBIT",
          amountCents: -amountCents,
          referenceType: "payment",
          referenceId: payment.id,
        },
      });

      // Auditoria 2026-08-10: dois estornos parciais somando o total deixavam
      // os ingressos VÁLIDOS e a comissão do promoter no bolso dele. Quando o
      // acumulado alcança o valor pago, o pedido vira reembolso TOTAL de fato.
      const debitos = await tx.ledgerEntry.aggregate({
        where: { referenceType: "payment", referenceId: payment.id, type: "REFUND_DEBIT" },
        _sum: { amountCents: true },
      });
      const devolvido = Math.abs(debitos._sum.amountCents ?? 0);

      // A comissão volta na MESMA proporção do que foi devolvido ao comprador.
      // Antes só voltava no estorno de 100% — num reembolso grande a casa
      // devolvia o bruto e continuava pagando a comissão inteira, ficando
      // negativa (revisão adversarial 2026-08-11).
      await clawbackPromoterCommission(tx, payment, devolvido / payment.amountCents);

      if (devolvido >= payment.amountCents) {
        await tx.order.updateMany({
          where: { id: payment.orderId },
          data: { status: "REFUNDED" },
        });
        await tx.ticket.updateMany({
          where: { orderId: payment.orderId, status: { in: ["ISSUED", "ACTIVE"] } },
          data: { status: "REFUNDED", canceledAt: new Date() },
        });
      }
    }

    return result;
  });
}

/** Reverte SALE_CREDIT + PLATFORM_FEE (líquido zero) e devolve o estoque vendido. */
async function reverseOrganizationLedgerAndStock(
  tx: Prisma.TransactionClient,
  payment: { id: string; orderId: string; amountCents: number },
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: { event: { select: { organizationId: true, endsAt: true } } },
  });
  if (!order) return;

  const ledgerAccount = await tx.ledgerAccount.findUnique({
    where: { organizationId: order.event.organizationId },
  });

  if (ledgerAccount) {
    const [previousCredit, previousFee, partialDebits] = await Promise.all([
      tx.ledgerEntry.findFirst({
        where: { referenceType: "payment", referenceId: payment.id, type: "SALE_CREDIT" },
      }),
      tx.ledgerEntry.findFirst({
        where: { referenceType: "payment", referenceId: payment.id, type: "PLATFORM_FEE" },
      }),
      // estornos parciais anteriores deste pagamento já debitados
      tx.ledgerEntry.aggregate({
        where: { referenceType: "payment", referenceId: payment.id, type: "REFUND_DEBIT" },
        _sum: { amountCents: true },
      }),
    ]);

    const alreadyDebited = partialDebits._sum.amountCents ?? 0; // negativo
    const remaining =
      -(previousCredit?.amountCents ?? payment.amountCents) -
      (previousFee?.amountCents ?? 0) -
      alreadyDebited;

    if (remaining !== 0) {
      await tx.ledgerEntry.create({
        data: {
          ledgerAccountId: ledgerAccount.id,
          type: "REFUND_DEBIT",
          amountCents: remaining,
          referenceType: "payment",
          referenceId: payment.id,
        },
      });
    }
  }

  // comissão de promoter volta junto (idempotente)
  await clawbackPromoterCommission(tx, payment);

  const items = await tx.orderItem.findMany({ where: { orderId: payment.orderId } });
  for (const item of items) {
    await returnSaleInventory(tx, item.ticketLotId, item.quantity);
  }
}

async function applyReversal(
  paymentId: string,
  status: Extract<GatewayPaymentStatus, "REFUNDED" | "CHARGEBACK">,
): Promise<ApplyStatusResult> {
  return prisma.$transaction(async (tx) => {
    const result: ApplyStatusResult = { paymentChanged: false, orderPaid: false, orphaned: false };

    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return result;

    const updatedPayment = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: ["PAID", "REFUND_PENDING"] } },
      data: { status },
    });
    result.paymentChanged = updatedPayment.count > 0;
    if (!result.paymentChanged) return result;

    const updatedOrder = await tx.order.updateMany({
      where: {
        id: payment.orderId,
        // PARTIALLY_REFUNDED entra: estorno total depois de parciais completa a reversão
        status: { in: ["PAID", "FULFILLED", "REFUND_PENDING", "PARTIALLY_REFUNDED"] },
      },
      data: { status: status === "CHARGEBACK" ? "CHARGEBACK" : "REFUNDED" },
    });

    if (updatedOrder.count > 0) {
      await reverseOrganizationLedgerAndStock(tx, payment);

      await tx.outboxEvent.create({
        data: {
          aggregateType: "order",
          aggregateId: payment.orderId,
          eventType: "order.payment_reversed",
          payload: { orderId: payment.orderId, paymentId, status },
        },
      });
    }

    return result;
  });
}

/** Soma N dias ÚTEIS (sábado/domingo pulam; feriado não é considerado). */
export function addBusinessDays(from: Date, businessDays: number): Date {
  const date = new Date(from);
  let remaining = businessDays;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return date;
}


/**
 * Carteira do promoter — UMA fonte de verdade para split e clawback.
 *
 * O promoter começa com carteira de PESSOA; quando completa o cadastro, ela
 * migra para a organização dele. Se split e clawback procurassem de formas
 * diferentes, o estorno não acharia a carteira migrada (a casa nunca
 * recuperaria a comissão) e comissões novas cairiam numa carteira órfã
 * insacável. Ordem: carteira da organização que ele é DONO → carteira
 * pessoal. (revisão adversarial 2026-08-11)
 */
async function resolvePromoterWallet(
  tx: Prisma.TransactionClient,
  promoterUserId: string,
  create: boolean,
): Promise<{ id: string } | null> {
  const membership = await tx.organizationMember.findFirst({
    where: { userId: promoterUserId, status: "ACTIVE", role: { key: "owner" } },
    select: { organizationId: true },
    orderBy: { joinedAt: "asc" },
  });
  if (membership) {
    const daOrg = await tx.ledgerAccount.findUnique({
      where: { organizationId: membership.organizationId },
    });
    if (daOrg) return daOrg;
    if (create) {
      return tx.ledgerAccount.create({ data: { organizationId: membership.organizationId } });
    }
  }
  const pessoal = await tx.ledgerAccount.findUnique({ where: { userId: promoterUserId } });
  if (pessoal) return pessoal;
  return create ? tx.ledgerAccount.create({ data: { userId: promoterUserId } }) : null;
}

/**
 * Split de comissão do promoter (Promoter v2, 2026-08-10): débito na org do
 * evento + crédito no CAIXA da org do promoter — que saca pelas regras
 * gerais. O crédito amadurece na MESMA data da venda (D+N úteis pós-evento):
 * comissão não pode ser sacável antes do dinheiro que a gerou.
 */
async function splitPromoterCommission(
  tx: Prisma.TransactionClient,
  payment: { id: string; orderId: string },
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: {
      promoterCommissionCents: true,
      promoterLink: { select: { promoterUserId: true } },
      event: { select: { organizationId: true, endsAt: true } },
    },
  });
  if (!order?.promoterLink || order.promoterCommissionCents <= 0) return;

  const hostAccount = await tx.ledgerAccount.upsert({
    where: { organizationId: order.event.organizationId },
    update: {},
    create: { organizationId: order.event.organizationId },
  });
  // carteira do promoter (pessoa ou organização dele, se já virou produtor)
  const promoterAccount = await resolvePromoterWallet(tx, order.promoterLink.promoterUserId, true);
  if (!promoterAccount) return;
  const availableAt = addBusinessDays(
    order.event.endsAt,
    Number(process.env.RELEASE_BUSINESS_DAYS_AFTER_EVENT ?? 2),
  );
  await tx.ledgerEntry.createMany({
    data: [
      {
        ledgerAccountId: hostAccount.id,
        type: "COMMISSION_DEBIT",
        amountCents: -order.promoterCommissionCents,
        referenceType: "payment",
        referenceId: payment.id,
        description: "Comissão de promoter",
      },
      {
        ledgerAccountId: promoterAccount.id,
        type: "COMMISSION_CREDIT",
        amountCents: order.promoterCommissionCents,
        referenceType: "payment",
        referenceId: payment.id,
        availableAt,
        description: "Comissão de promoter",
      },
    ],
  });
}

/**
 * Devolve a comissão do promoter no estorno: debita a carteira dele e credita
 * a casa. `fraction` = quanto do pagamento foi devolvido (1 = total), então o
 * estorno parcial devolve a comissão pro-rata. Idempotente por acumulado.
 */
export async function clawbackPromoterCommission(
  tx: Prisma.TransactionClient,
  payment: { id: string; orderId: string },
  fraction = 1,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: {
      promoterCommissionCents: true,
      promoterLink: { select: { promoterUserId: true } },
      event: { select: { organizationId: true } },
    },
  });
  if (!order?.promoterLink || order.promoterCommissionCents <= 0) return;

  // quanto da comissão JÁ voltou (estornos parciais anteriores)
  const devolvidoAntes = await tx.ledgerEntry.aggregate({
    where: {
      referenceType: "payment",
      referenceId: payment.id,
      type: "COMMISSION_DEBIT",
      amountCents: { gt: 0 },
    },
    _sum: { amountCents: true },
  });
  const jaDevolvido = devolvidoAntes._sum.amountCents ?? 0;
  const alvo = Math.min(
    Math.round(order.promoterCommissionCents * Math.max(0, Math.min(1, fraction))),
    order.promoterCommissionCents,
  );
  const valor = alvo - jaDevolvido;
  if (valor <= 0) return; // nada novo a devolver (idempotente)

  const hostAccount = await tx.ledgerAccount.findUnique({
    where: { organizationId: order.event.organizationId },
  });
  const promoterAccount = await resolvePromoterWallet(tx, order.promoterLink.promoterUserId, false);
  if (!hostAccount || !promoterAccount) return;
  await tx.ledgerEntry.createMany({
    data: [
      {
        ledgerAccountId: promoterAccount.id,
        type: "COMMISSION_CREDIT",
        amountCents: -valor,
        referenceType: "payment",
        referenceId: payment.id,
        description: "Estorno de comissão (reembolso)",
      },
      {
        ledgerAccountId: hostAccount.id,
        type: "COMMISSION_DEBIT",
        amountCents: valor,
        referenceType: "payment",
        referenceId: payment.id,
        description: "Estorno de comissão (reembolso)",
      },
    ],
  });
}
