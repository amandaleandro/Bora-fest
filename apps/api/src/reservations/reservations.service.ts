import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { createReservationExpirationQueue } from "@borafest/queues";
import type { CreateReservationInput } from "@borafest/contracts";
import { InventoryService, InsufficientStockError } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";

const RESERVATION_TTL_MINUTES = 10;

@Injectable()
export class ReservationsService {
  private readonly expirationQueue = createReservationExpirationQueue();

  constructor(
    private readonly inventory: InventoryService,
    private readonly waitingRoom: WaitingRoomService,
  ) {}

  async create(userId: string | undefined, input: CreateReservationInput) {
    const event = await prisma.event.findUnique({ where: { id: input.eventId } });
    if (!event || event.status !== "PUBLISHED") {
      throw new NotFoundException("Evento não encontrado ou não publicado");
    }

    if (event.waitingRoomEnabled) {
      await this.waitingRoom.assertAdmitted(event.id, input.waitingRoomTicketId);
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
      // só-balcão nunca entra pelo site (2026-08-31) — mesmo que alguém
      // descubra o id do lote, a reserva pública é recusada
      if (lot.pdvOnly) {
        throw new BadRequestException(`O lote ${lot.name} é vendido apenas no balcão do evento`);
      }
      // meia-entrada é opt-in do produtor — sem a flag, ninguém compra meia
      if (item.halfPrice && !lot.halfPriceEnabled) {
        throw new BadRequestException("Este lote não oferece meia-entrada");
      }
      if (item.quantity < 1) {
        throw new BadRequestException("Quantidade inválida");
      }
    }

    // TETO POR LOTE agregando itens repetidos (auditoria 2026-08-29): antes o
    // limite era por item, então mandar N itens do MESMO lote, cada um sob o
    // teto, somava muito acima e dava pra travar o estoque inteiro num request.
    const totalPorLote = new Map<string, number>();
    for (const item of input.items) {
      totalPorLote.set(item.ticketLotId, (totalPorLote.get(item.ticketLotId) ?? 0) + item.quantity);
    }
    for (const [lotId, total] of totalPorLote) {
      const lot = lots.find((l) => l.id === lotId)!;
      if (total > lot.maxPerOrder) {
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
