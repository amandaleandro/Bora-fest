import { prisma } from "@borafest/database";
import { getGateway } from "@borafest/payments";
import { withContext } from "@borafest/observability";
import { issueTicketsForOrder } from "./issue-tickets";

const log = withContext({ module: "outbox" });

const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 20;

/**
 * Despacho do outbox: reivindica eventos PENDING um a um (guarda de status em
 * `updateMany`) e roteia por tipo. Falha reagenda com backoff; sucesso marca
 * PROCESSED. Todos os handlers são idempotentes.
 */
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
    if (claimed.count === 0) continue; // outro worker pegou

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
        failed ? "evento do outbox falhou definitivamente (dead letter)" : "evento do outbox falhou; retry agendado",
      );
    }
  }

  return processed;
}

async function handleOutboxEvent(
  eventType: string,
  payload: Record<string, string>,
): Promise<void> {
  switch (eventType) {
    case "order.paid":
      await issueTicketsForOrder(payload.orderId);
      return;

    case "payment.orphaned":
      await refundOrphanedPayment(payload.paymentId);
      return;

    case "order.payment_reversed":
      await revokeOrderTickets(payload.orderId);
      return;

    default:
      log.warn({ eventType }, "tipo de evento do outbox sem handler; marcado como processado");
  }
}

/**
 * Pagamento aprovado depois do pedido expirar/cancelar (§22): estorno
 * automático — nunca ficar com dinheiro sem ingresso emitido.
 */
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

/** Estorno/chargeback do pedido: revoga os ingressos ainda válidos. */
async function revokeOrderTickets(orderId: string): Promise<void> {
  const revoked = await prisma.ticket.updateMany({
    where: { orderId, status: { in: ["ISSUED", "ACTIVE"] } },
    data: { status: "CANCELED", canceledAt: new Date() },
  });
  if (revoked.count > 0) {
    log.info({ orderId, count: revoked.count }, "ingressos revogados por estorno/chargeback");
  }
}
