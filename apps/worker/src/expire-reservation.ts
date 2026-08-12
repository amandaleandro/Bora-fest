import { prisma, releaseInventory } from "@borafest/database";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "reservation-expiration" });

export async function expireReservation(reservationId: string): Promise<void> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { items: true },
  });

  if (!reservation) {
    log.warn({ reservationId }, "reserva não encontrada, ignorando");
    return;
  }

  if (reservation.status !== "ACTIVE") {
    return;
  }

  if (reservation.expiresAt.getTime() > Date.now()) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    // GUARDA DE CORRIDA (auditoria 2026-08-12): a checagem de status acima é
    // FORA da transação. Entre ela e aqui, createFromReservation pode ter
    // convertido a reserva (ACTIVE→CONVERTED) e o pedido já está vivo com o
    // estoque dele. Sem esta guarda o worker liberava o estoque de um pedido
    // pago e sobrescrevia CONVERTED→EXPIRED → oversell. Espelha o padrão de
    // expire-orders.ts: quem muda o status primeiro vence; se não mudou nada,
    // a reserva já não é ACTIVE e o estoque NÃO deve ser liberado.
    const expired = await tx.reservation.updateMany({
      where: { id: reservationId, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });
    if (expired.count === 0) return; // convertida (ou expirada) no meio do caminho

    for (const item of reservation.items) {
      await releaseInventory(tx, item.ticketLotId, item.quantity);
    }
  });

  log.info({ reservationId }, "reserva expirada e estoque liberado");
}

export async function reconcileExpiredReservations(): Promise<void> {
  const expired = await prisma.reservation.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
    select: { id: true },
  });

  if (expired.length > 0) {
    log.info({ count: expired.length }, "reconciliação encontrou reservas expiradas sem job processado");
  }

  for (const { id } of expired) {
    await expireReservation(id);
  }
}
