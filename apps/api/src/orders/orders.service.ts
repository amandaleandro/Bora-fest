import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { createReservationExpirationQueue } from "@borafest/queues";
import type { CreateOrderInput } from "@borafest/contracts";
import { CouponsService } from "../coupons/coupons.service";

/**
 * Janela para pagar depois de criar o pedido. O estoque permanece em
 * `reserved_count` até o pagamento aprovar (aí vira `sold_count`) ou a janela
 * expirar (aí é liberado pelo worker de expiração de pedidos).
 */
const ORDER_PAYMENT_WINDOW_MINUTES = 15;

@Injectable()
export class OrdersService {
  private readonly expirationQueue = createReservationExpirationQueue();

  constructor(private readonly coupons: CouponsService) {}

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

    const itemsTotalCents = reservation.items.reduce(
      (sum, item) => sum + (item.priceCents + item.feeCents) * item.quantity,
      0,
    );

    const coupon = input.couponCode
      ? await this.coupons.findUsable(reservation.eventId, input.couponCode)
      : null;
    const discountCents = coupon ? CouponsService.discountFor(coupon, itemsTotalCents) : 0;
    const totalCents = itemsTotalCents - discountCents;

    const expiresAt = new Date(Date.now() + ORDER_PAYMENT_WINDOW_MINUTES * 60 * 1000);

    const order = await prisma.$transaction(async (tx) => {
      // guarda de corrida contra o worker de expiração: só converte se ainda ACTIVE
      const converted = await tx.reservation.updateMany({
        where: { id: reservation.id, status: "ACTIVE" },
        data: { status: "CONVERTED" },
      });
      if (converted.count === 0) {
        throw new BadRequestException("Reserva não está mais ativa");
      }

      // o estoque já está seguro em reserved_count; a venda (sold_count) só se
      // confirma quando o pagamento aprovar — nunca na criação do pedido
      const created = await tx.order.create({
        data: {
          eventId: reservation.eventId,
          reservationId: reservation.id,
          userId: userId ?? reservation.userId,
          contactEmail: input.contactEmail,
          contactName: input.contactName,
          contactPhone: input.contactPhone?.replace(/\D/g, ""),
          status: "PAYMENT_PENDING",
          totalCents,
          discountCents,
          expiresAt,
          items: {
            create: reservation.items.map((item) => ({
              ticketLotId: item.ticketLotId,
              quantity: item.quantity,
              priceCents: item.priceCents,
              feeCents: item.feeCents,
              halfPrice: item.halfPrice,
            })),
          },
        },
        include: { items: true },
      });

      if (coupon) {
        // resgate atômico: só conta se ainda houver saldo de usos
        const redeemed = await tx.coupon.updateMany({
          where: {
            id: coupon.id,
            active: true,
            OR: [
              { maxRedemptions: null },
              { redeemedCount: { lt: coupon.maxRedemptions ?? undefined } },
            ],
          },
          data: { redeemedCount: { increment: 1 } },
        });
        if (redeemed.count === 0) {
          throw new BadRequestException("Cupom esgotado");
        }
        await tx.couponRedemption.create({
          data: { couponId: coupon.id, orderId: created.id, amountCents: discountCents },
        });
      }

      return created;
    });

    // a reserva virou pedido: o job de expiração da reserva não é mais necessário
    await this.expirationQueue.remove(reservation.id);

    return order;
  }

  async findByPublicToken(publicToken: string) {
    const order = await prisma.order.findUnique({
      where: { publicToken },
      include: {
        items: true,
        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            method: true,
            status: true,
            amountCents: true,
            pixQrCodeText: true,
            installments: true,
            failReason: true,
            expiresAt: true,
            paidAt: true,
          },
        },
        tickets: { select: { id: true, code: true, status: true } },
      },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");
    return order;
  }
}
