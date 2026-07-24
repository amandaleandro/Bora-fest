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
    select: { event: { select: { organizationId: true } } },
  });
  if (!order) return;

  const organizationId = order.event.organizationId;
  const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });

  const ledgerAccount = await tx.ledgerAccount.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId },
  });

  const feeCents = computePlatformFeeCents(payment.method, payment.amountCents, organization);

  await tx.ledgerEntry.createMany({
    data: [
      {
        ledgerAccountId: ledgerAccount.id,
        type: "SALE_CREDIT",
        amountCents: payment.amountCents,
        referenceType: "payment",
        referenceId: payment.id,
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
    select: { event: { select: { organizationId: true } } },
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
