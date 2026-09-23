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

  const storeStale = await prisma.storeOrder.findMany({
    where: {
      status: { in: ["CREATED", "PAYMENT_PENDING"] },
      expiresAt: { lt: new Date() },
    },
    select: { id: true },
    take: 100,
  });
  for (const { id } of storeStale) {
    try {
      await expireStoreOrder(id);
    } catch (error) {
      log.error({ storeOrderId: id, error: (error as Error).message }, "falha ao expirar pedido da Loja");
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

    // DEVOLVE O CUPOM (auditoria 2026-08-29): o resgate era contado na CRIAÇÃO
    // do pedido e nunca voltava na expiração — anônimo esgotava a campanha sem
    // pagar nada. Ao expirar, o slot volta para a próxima pessoa.
    const redemption = await tx.couponRedemption.findFirst({ where: { orderId } });
    if (redemption) {
      await tx.coupon.update({
        where: { id: redemption.couponId },
        data: { redeemedCount: { decrement: 1 } },
      });
      await tx.couponRedemption.delete({ where: { id: redemption.id } });
    }
  });

  log.info({ orderId }, "pedido expirado e estoque liberado");
}


async function expireStoreOrder(orderId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.storeOrder.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payments: { where: { status: { in: ["PENDING", "AUTHORIZED"] } } },
      },
    });
    if (!order || !["CREATED", "PAYMENT_PENDING"].includes(order.status)) return;

    const livePayment = order.payments.some(
      (payment) => payment.expiresAt && payment.expiresAt.getTime() > Date.now(),
    );
    if (livePayment) return;

    const updated = await tx.storeOrder.updateMany({
      where: { id: orderId, status: { in: ["CREATED", "PAYMENT_PENDING"] } },
      data: { status: "CANCELED" },
    });
    if (updated.count === 0) return;

    for (const item of order.items) {
      await tx.storeProductVariant.update({
        where: { id: item.variantId },
        data: { reservedCount: { decrement: item.quantity } },
      });
    }

    await tx.storePayment.updateMany({
      where: {
        storeOrderId: orderId,
        status: { in: ["PENDING", "AUTHORIZED"] },
      },
      data: { status: "EXPIRED" },
    });
  });

  log.info({ storeOrderId: orderId }, "pedido da Loja expirado e estoque liberado");
}
