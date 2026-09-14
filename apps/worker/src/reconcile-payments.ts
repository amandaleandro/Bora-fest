import { prisma, type VipPaymentRow } from "@borafest/database";
import { applyGatewayStatus, applyVipGatewayStatus, getGateway } from "@borafest/payments";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "payment-reconciliation" });

export async function reconcilePendingPayments(): Promise<void> {
  const cutoff = new Date(Date.now() - 2 * 60_000);
  const payments = await prisma.payment.findMany({
    where: {
      status: { in: ["PENDING", "AUTHORIZED", "REFUND_PENDING"] },
      externalId: { not: null },
      createdAt: { lt: cutoff },
    },
    take: 100,
  });

  for (const payment of payments) {
    try {
      const gateway = getGateway(payment.provider);
      const status = await gateway.getStatus(payment.externalId!);
      if (status !== "PENDING") {
        const result = await applyGatewayStatus(payment.id, status);
        if (result.paymentChanged) {
          log.info({ paymentId: payment.id, status }, "pagamento corrigido pela reconciliação");
        }
      }
    } catch (error) {
      log.error({ paymentId: payment.id, error: (error as Error).message }, "falha ao reconciliar pagamento");
    }
  }

  await reconcileVipPayments(cutoff);
  await reconcileDriftedRefunds();
}

async function reconcileVipPayments(cutoff: Date): Promise<void> {
  const payments = await prisma.$queryRaw<VipPaymentRow[]>`
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
    WHERE status IN (
      'PENDING'::"PaymentStatus",
      'AUTHORIZED'::"PaymentStatus",
      'REFUND_PENDING'::"PaymentStatus"
    )
      AND external_id IS NOT NULL
      AND created_at < ${cutoff}
    ORDER BY created_at ASC
    LIMIT 100
  `;

  for (const payment of payments) {
    try {
      const gateway = getGateway(payment.provider);
      const status = await gateway.getStatus(payment.externalId!);
      if (status === "PENDING") continue;
      const result = await applyVipGatewayStatus(payment.id, status);
      if (result.paymentChanged) {
        log.info({ vipPaymentId: payment.id, status }, "pagamento VIP corrigido pela reconciliação");
      }
    } catch (error) {
      log.error({ vipPaymentId: payment.id, error: (error as Error).message }, "falha ao reconciliar pagamento VIP");
    }
  }
}

async function reconcileDriftedRefunds(): Promise<void> {
  const openRequests = await prisma.refundRequest.findMany({
    where: { status: "PENDING" },
    take: 50,
    select: {
      id: true,
      order: {
        select: {
          id: true,
          payments: {
            where: { status: "PAID", externalId: { not: null } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, provider: true, externalId: true },
          },
        },
      },
    },
  });

  for (const request of openRequests) {
    const payment = request.order.payments[0];
    if (!payment) continue;
    try {
      const gateway = getGateway(payment.provider);
      const status = await gateway.getStatus(payment.externalId!);
      if (status !== "REFUNDED" && status !== "CHARGEBACK") continue;
      await applyGatewayStatus(payment.id, status);
      await prisma.refundRequest.update({
        where: { id: request.id },
        data: { status: "APPROVED", resolvedAt: new Date() },
      });
      await prisma.auditLog.create({
        data: {
          action: "system.refund_request.auto_reconciled",
          entityType: "refund_request",
          entityId: request.id,
          metadata: { orderId: request.order.id, paymentId: payment.id, gatewayStatus: status },
        },
      });
      log.info({ refundRequestId: request.id, status }, "reembolso conciliado automaticamente");
    } catch (error) {
      log.error({ refundRequestId: request.id, error: (error as Error).message }, "falha ao conciliar reembolso");
    }
  }
}
