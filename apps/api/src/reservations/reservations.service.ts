import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { createReservationExpirationQueue } from "@borafest/queues";
import type { CreateReservationInput } from "@borafest/contracts";
import { InventoryService, InsufficientStockError } from "../inventory/inventory.service";

const RESERVATION_TTL_MINUTES = 10;

@Injectable()
export class ReservationsService {
  private readonly expirationQueue = createReservationExpirationQueue();

  constructor(private readonly inventory: InventoryService) {}

  async create(userId: string | undefined, input: CreateReservationInput) {
    const event = await prisma.event.findUnique({ where: { id: input.eventId } });
    if (!event || event.status !== "PUBLISHED") {
      throw new NotFoundException("Evento não encontrado ou não publicado");
    }

    const lots = await prisma.ticketLot.findMany({
      where: { id: { in: input.items.map((item) => item.ticketLotId) } },
      include: { ticketType: true },
    });

    for (const item of input.items) {
      const lot = lots.find((l) => l.id === item.ticketLotId);
      if (!lot || lot.ticketType.eventId !== input.eventId) {
        throw new BadRequestException(`Lote ${item.ticketLotId} não pertence a este evento`);
      }
      if (item.quantity > lot.maxPerOrder) {
        throw new BadRequestException(`Quantidade acima do limite por pedido para o lote ${lot.name}`);
      }
    }

    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);

    const reservation = await prisma.$transaction(async (tx) => {
      for (const item of input.items) {
        await this.inventory.tryReserve(item.ticketLotId, item.quantity, tx);
      }

      return tx.reservation.create({
        data: {
          eventId: input.eventId,
          userId,
          expiresAt,
          items: {
            create: input.items.map((item) => {
              const lot = lots.find((l) => l.id === item.ticketLotId)!;
              return {
                ticketLotId: item.ticketLotId,
                quantity: item.quantity,
                // meia-entrada (Lei 12.933/2013): metade do preço, taxa cheia;
                // documento é conferido na portaria
                priceCents: item.halfPrice ? Math.round(lot.priceCents / 2) : lot.priceCents,
                feeCents: lot.feeCents,
                halfPrice: item.halfPrice ?? false,
              };
            }),
          },
        },
        include: { items: true },
      });
    }).catch((error) => {
      if (error instanceof InsufficientStockError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    });

    await this.expirationQueue.add(
      "expire",
      { reservationId: reservation.id },
      { delay: RESERVATION_TTL_MINUTES * 60 * 1000, jobId: reservation.id },
    );

    return reservation;
  }

  async findById(reservationId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { items: true },
    });
    if (!reservation) throw new NotFoundException("Reserva não encontrada");
    return reservation;
  }
}
