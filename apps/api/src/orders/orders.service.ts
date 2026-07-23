import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { createReservationExpirationQueue } from "@borafest/queues";
import type { CreateOrderInput } from "@borafest/contracts";
import { InventoryService } from "../inventory/inventory.service";

@Injectable()
export class OrdersService {
  private readonly expirationQueue = createReservationExpirationQueue();

  constructor(private readonly inventory: InventoryService) {}

  async createFromReservation(userId: string | undefined, input: CreateOrderInput) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: input.reservationId },
      include: { items: true },
    });

    if (!reservation) throw new NotFoundException("Reserva não encontrada");
    if (reservation.status !== "ACTIVE") {
      throw new BadRequestException("Reserva não está mais ativa");
    }
    if (reservation.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Reserva expirada");
    }

    const totalCents = reservation.items.reduce(
      (sum, item) => sum + (item.priceCents + item.feeCents) * item.quantity,
      0,
    );

    const order = await prisma.$transaction(async (tx) => {
      for (const item of reservation.items) {
        await this.inventory.confirmSale(item.ticketLotId, item.quantity, tx);
      }

      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: "CONVERTED" },
      });

      return tx.order.create({
        data: {
          eventId: reservation.eventId,
          reservationId: reservation.id,
          userId: userId ?? reservation.userId,
          contactEmail: input.contactEmail,
          contactName: input.contactName,
          status: "PAYMENT_PENDING",
          totalCents,
          items: {
            create: reservation.items.map((item) => ({
              ticketLotId: item.ticketLotId,
              quantity: item.quantity,
              priceCents: item.priceCents,
              feeCents: item.feeCents,
            })),
          },
        },
        include: { items: true },
      });
    });

    await this.expirationQueue.remove(reservation.id);

    return order;
  }

  async findByPublicToken(publicToken: string) {
    const order = await prisma.order.findUnique({
      where: { publicToken },
      include: { items: true },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");
    return order;
  }
}
