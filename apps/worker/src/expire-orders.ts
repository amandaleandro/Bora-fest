import { prisma, releaseInventory } from "@borafest/database";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "order-expiration" });

/**
 * Pedidos PAYMENT_PENDING com janela de pagamento vencida e sem pagamento
 * aprovado: expira e devolve o estoque reservado. A guarda de status na
 * transação evita corrida com um webhook PAID que chegue no mesmo instante —
 * quem atualizar o status primeiro vence.
 */
export async function expireStaleOrders(): Promise<void> {
  const stale = await prisma.order.findMany({
    where: {
      status: { in: ["CREATED", "PAYMENT_PENDING"] },
      expiresAt: { lt: new Date() },
    },
    select: { id: true },
    take: 100,
  });

  for (const { id } of stale) {
    try {
      await expireOrder(id);
    } catch (error) {
      log.error({ orderId: id, error: (error as Error).message }, "falha ao expirar pedido");
    }
  }
}

async function expireOrder(orderId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: { in: ["CREATED", "PAYMENT_PENDING"] } },
      data: { status: "EXPIRED" },
    });
    if (updated.count === 0) return; // pagou (ou expirou) no meio do caminho

    const items = await tx.orderItem.findMany({ where: { orderId } });
    for (const item of items) {
      await releaseInventory(tx, item.ticketLotId, item.quantity);
    }

    // cobranças abertas não podem mais aprovar o pedido
    await tx.payment.updateMany({
      where: { orderId, status: { in: ["PENDING", "AUTHORIZED"] } },
      data: { status: "EXPIRED" },
    });
  });

  log.info({ orderId }, "pedido expirado e estoque liberado");
}
