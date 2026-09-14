import { prisma, type VipPaymentRow } from "@borafest/database";
import { applyVipGatewayStatus, getGateway } from "@borafest/payments";
import { withContext } from "@borafest/observability";
import { issueTicketsForOrder } from "./issue-tickets";
import { notifySale } from "./sale-notify";
import { sendInitiateCheckoutToMeta, sendPurchaseToMeta } from "./meta-capi";
import { awardLoyaltyForOrder, reverseLoyaltyForOrder } from "./loyalty";

const log = withContext({ module: "outbox" });

const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 20;

export async function processOutboxBatch(): Promise<number> {
  const pending = await prisma.outboxEvent.findMany({
    where: { status: "PENDING", availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  let processed = 0;
  for (const event of pending) {
    const claimed = await prisma.outboxEvent.updateMany({
      where: { id: event.id, status: "PENDING" },
      data: { status: "PROCESSING", attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;

    try {
      await handleOutboxEvent(event.eventType, event.payload as Record<string, string>);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "PROCESSED", processedAt: new Date() },
      });
      processed++;
    } catch (error) {
      const attempts = event.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: failed ? "FAILED" : "PENDING",
          availableAt: new Date(Date.now() + Math.min(attempts * 30_000, 10 * 60_000)),
        },
      });
      log.error(
        { outboxEventId: event.id, eventType: event.eventType, attempts, error: (error as Error).message },
        failed ? "evento do outbox falhou definitivamente" : "evento do outbox falhou; retry agendado",
      );
    }
  }

  return processed;
}

async function handleOutboxEvent(eventType: string, payload: Record<string, string>): Promise<void> {
  switch (eventType) {
    case "order.paid":
      await issueTicketsForOrder(payload.orderId);
      await awardLoyaltyForOrder(payload.orderId);
      await notifySale(payload.orderId);
      await sendPurchaseToMeta(payload.orderId);
      return;

    case "order.created":
      await sendInitiateCheckoutToMeta(payload.orderId);
      return;

    case "payment.orphaned":
      await refundOrphanedPayment(payload.paymentId);
      return;

    case "vip.payment.orphaned":
      await refundOrphanedVipPayment(payload.vipPaymentId);
      return;

    case "order.payment_reversed":
      await reverseLoyaltyForOrder(payload.orderId);
      await revokeOrderTickets(payload.orderId);
      return;

    case "vip.payment.paid":
      return;

    default:
      log.warn({ eventType }, "tipo de evento do outbox sem handler; marcado como processado");
  }
}

async function refundOrphanedPayment(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || !payment.externalId) return;
  if (payment.status === "REFUNDED" || payment.status === "REFUND_PENDING") return;

  const gateway = getGateway(payment.provider);
  const result = await gateway.refund({
    externalId: payment.externalId,
    idempotencyKey: `refund_orphan_${payment.id}`,
  });

  await prisma.payment.updateMany({
    where: { id: paymentId, status: "PAID" },
    data: { status: result.status === "REFUNDED" ? "REFUNDED" : "REFUND_PENDING" },
  });

  log.info({ paymentId, result: result.status }, "estorno de pagamento órfão executado");
}

async function loadVipPayment(paymentId: string): Promise<VipPaymentRow | null> {
  const rows = await prisma.$queryRaw<VipPaymentRow[]>`
    SELECT
      id,
      vip_reservation_id AS "vipReservationId",
      provider,
      method,
      status,
      amount_cents AS "amountCents",
      external_id AS "externalId",
      pix_qr_code_text AS "pixQrCodeText",
      fail_reason AS "failReason",
      expires_at AS "expiresAt",
      paid_at AS "paidAt",
      metadata,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM vip_payments
    WHERE id = ${paymentId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function refundOrphanedVipPayment(paymentId: string): Promise<void> {
  const payment = await loadVipPayment(paymentId);
  if (!payment?.externalId) return;
  if (payment.status === "REFUNDED" || payment.status === "REFUND_PENDING") return;
  if (payment.status !== "PAID") return;

  const gateway = getGateway(payment.provider);
  const result = await gateway.refund({
    externalId: payment.externalId,
    idempotencyKey: `refund_orphan_vip_${payment.id}`,
  });

  if (result.status === "FAILED") {
    throw new Error(`Gateway recusou estorno do pagamento VIP órfão ${payment.id}`);
  }
  if (result.status === "REFUNDED") {
    await applyVipGatewayStatus(payment.id, "REFUNDED");
  } else {
    await prisma.$executeRaw`
      UPDATE vip_payments
      SET status = 'REFUND_PENDING'::"PaymentStatus", updated_at = CURRENT_TIMESTAMP
      WHERE id = ${paymentId}::uuid AND status = 'PAID'::"PaymentStatus"
    `;
  }

  log.info({ vipPaymentId: paymentId, result: result.status }, "estorno de pagamento VIP órfão executado");
}

async function revokeOrderTickets(orderId: string): Promise<void> {
  const revoked = await prisma.ticket.updateMany({
    where: { orderId, status: { in: ["ISSUED", "ACTIVE"] } },
    data: { status: "CANCELED", canceledAt: new Date() },
  });
  if (revoked.count > 0) {
    log.info({ orderId, count: revoked.count }, "ingressos revogados por estorno/chargeback");
  }
}
