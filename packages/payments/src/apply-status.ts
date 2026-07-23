import {
  confirmSaleInventory,
  prisma,
  type PaymentStatus as DbPaymentStatus,
} from "@borafest/database";
import type { GatewayPaymentStatus } from "./types";

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

export async function applyGatewayStatus(
  paymentId: string,
  status: GatewayPaymentStatus,
  occurredAt?: Date,
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

    case "REFUNDED":
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
      where: { id: payment.orderId, status: { in: ["PAID", "FULFILLED", "REFUND_PENDING"] } },
      data: { status: status === "CHARGEBACK" ? "CHARGEBACK" : "REFUNDED" },
    });

    if (updatedOrder.count > 0) {
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
