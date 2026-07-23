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
      status: { in: ["PENDING", "AUTHORIZED"] },
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
}
