import { prisma } from "@borafest/database";
import { withContext } from "@borafest/observability";
import { releaseInventory } from "./inventory";

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
    for (const item of reservation.items) {
      await releaseInventory(item.ticketLotId, item.quantity, tx);
    }
    await tx.reservation.update({ where: { id: reservationId }, data: { status: "EXPIRED" } });
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
