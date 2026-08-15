import { prisma } from "@borafest/database";
import { applyGatewayStatus, getGateway } from "@borafest/payments";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "payment-reconciliation" });

/**
 * Reconciliação periódica (arquitetura §11): consulta no gateway pagamentos
 * abertos há mais de 2 minutos para corrigir webhooks perdidos. Usa o mesmo
 * `applyGatewayStatus` idempotente dos webhooks — sem caminho paralelo.
 */
export async function reconcilePendingPayments(): Promise<void> {
  const cutoff = new Date(Date.now() - 2 * 60_000);
  const payments = await prisma.payment.findMany({
    where: {
      // REFUND_PENDING entra (2026-08-15): estorno executado no gateway cuja
      // baixa local falhou se auto-cura aqui — sem depender de clique no backoffice
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
      log.error(
        { paymentId: payment.id, error: (error as Error).message },
        "falha ao reconciliar pagamento",
      );
    }
  }

  await reconcileDriftedRefunds();
}

/**
 * CONGRUÊNCIA COM A REALIDADE (incidente Marcela, 2026-08-15): pagamento local
 * "PAID" cujo pedido tem reembolso SOLICITADO é cruzado com o gateway — se lá
 * já consta estornado (crash antigo no meio do estorno), aplica a baixa E
 * fecha o request sozinho (resolvedByUserId null = automático). O conjunto é
 * minúsculo (só pedidos com request aberto), então o custo por ciclo é ~zero.
 */
async function reconcileDriftedRefunds(): Promise<void> {
  const abertos = await prisma.refundRequest.findMany({
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

  for (const request of abertos) {
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
      log.info(
        { refundRequestId: request.id, orderId: request.order.id, status },
        "reembolso já executado no gateway — baixado e request fechado automaticamente",
      );
    } catch (error) {
      log.error(
        { refundRequestId: request.id, error: (error as Error).message },
        "falha ao cruzar reembolso aberto com o gateway",
      );
    }
  }
}
