import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  confirmSaleInventory,
  reserveInventory,
  returnSaleInventory,
  InsufficientStockError,
  prisma,
} from "@borafest/database";
import { createReservationExpirationQueue } from "@borafest/queues";
import { applyGatewayStatus, computePlatformFeeCents, getGateway } from "@borafest/payments";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateOrderInput, PdvOrderInput, RefundOrderInput } from "@borafest/contracts";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";

/**
 * Janela para pagar depois de criar o pedido. O estoque permanece em
 * `reserved_count` até o pagamento aprovar (aí vira `sold_count`) ou a janela
 * expirar (aí é liberado pelo worker de expiração de pedidos).
 */
const ORDER_PAYMENT_WINDOW_MINUTES = 15;

@Injectable()
export class OrdersService {
  private readonly expirationQueue = createReservationExpirationQueue();

  constructor(
    private readonly coupons: CouponsService,
    private readonly orgAccess: OrgAccessService,
  ) {}

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

  /** Detalhe de um pedido para o painel do produtor (tela Vendas). */
  async getOrderDetailForProducer(orderId: string, actorUserId: string): Promise<any> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        event: { select: { id: true, title: true, organizationId: true } },
        items: { include: { ticketLot: { include: { ticketType: true } } } },
        payments: { orderBy: { createdAt: "desc" } },
        tickets: { select: { id: true, code: true, status: true, attendeeName: true } },
      },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");
    await this.orgAccess.assertPermission(order.event.organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
    return order;
  }

  /**
   * PDV (venda presencial): sem checkout/reserva prévia — reserva e confirma o
   * estoque na mesma transação, cria o pedido já `PAID` e credita o ledger da
   * organização como uma venda normal. Reusa o outbox `order.paid` para que o
   * worker emita os ingressos exatamente como numa compra online (mesmo
   * caminho de cortesias, mas com valor real).
   */
  async createManualSale(eventId: string, actorUserId: string, input: PdvOrderInput) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    const lot = await prisma.ticketLot.findFirst({
      where: { id: input.ticketLotId, ticketType: { eventId } },
    });
    if (!lot) throw new BadRequestException("Lote não pertence a este evento");

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: event.organizationId } });
    const unitCents = lot.priceCents + lot.feeCents;
    const totalCents = unitCents * input.quantity;
    // venda no PDV não passa por gateway; a comissão da plataforma segue a
    // tabela do Pix (menor custo) por não haver taxa de adquirente envolvida
    const feeCents = computePlatformFeeCents("PIX", totalCents, organization);
    const buyerEmail = input.buyerEmail ?? `pdv-${Date.now()}@borafest.local`;

    const order = await prisma
      .$transaction(async (tx) => {
        await reserveInventory(tx, lot.id, input.quantity);
        await confirmSaleInventory(tx, lot.id, input.quantity);

        const reservation = await tx.reservation.create({
          data: {
            eventId,
            status: "CONVERTED",
            expiresAt: new Date(),
            items: {
              create: [{ ticketLotId: lot.id, quantity: input.quantity, priceCents: lot.priceCents, feeCents: lot.feeCents }],
            },
          },
        });

        const created = await tx.order.create({
          data: {
            eventId,
            reservationId: reservation.id,
            contactEmail: buyerEmail,
            contactName: input.buyerName,
            status: "PAID",
            paidAt: new Date(),
            totalCents,
            items: {
              create: [{ ticketLotId: lot.id, quantity: input.quantity, priceCents: lot.priceCents, feeCents: lot.feeCents }],
            },
          },
        });

        const ledgerAccount = await tx.ledgerAccount.upsert({
          where: { organizationId: event.organizationId },
          update: {},
          create: { organizationId: event.organizationId },
        });

        await tx.ledgerEntry.createMany({
          data: [
            {
              ledgerAccountId: ledgerAccount.id,
              type: "SALE_CREDIT",
              amountCents: totalCents,
              referenceType: "order",
              referenceId: created.id,
            },
            {
              ledgerAccountId: ledgerAccount.id,
              type: "PLATFORM_FEE",
              amountCents: -feeCents,
              referenceType: "order",
              referenceId: created.id,
            },
          ],
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: "order",
            aggregateId: created.id,
            eventType: "order.paid",
            payload: { orderId: created.id, pdv: true },
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            organizationId: event.organizationId,
            action: "order.pdv_sale",
            entityType: "order",
            entityId: created.id,
            metadata: {
              ticketLotId: lot.id,
              quantity: input.quantity,
              buyerName: input.buyerName,
              buyerDocument: input.buyerDocument,
              totalCents,
            },
          },
        });

        return created;
      })
      .catch((error) => {
        if (error instanceof InsufficientStockError) {
          throw new BadRequestException("Estoque insuficiente para esta venda");
        }
        throw error;
      });

    return { orderId: order.id, publicToken: order.publicToken };
  }

  /**
   * Reembolso pelo painel do produtor (org-scoped, equivalente ao
   * `admin.refundOrder` mas exigindo permissão na organização em vez de
   * `platformRole=ADMIN`). Pedidos com pagamento real (Pix/cartão) disparam
   * o estorno no gateway; pedidos do PDV (sem `Payment`, pagos em dinheiro)
   * são estornados manualmente no ledger.
   */
  async refundOrder(orderId: string, actorUserId: string, input: RefundOrderInput): Promise<any> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { event: { select: { organizationId: true } }, payments: { orderBy: { createdAt: "desc" } } },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");
    await this.orgAccess.assertPermission(order.event.organizationId, actorUserId, PERMISSIONS.ORDER_REFUND);

    const payment = order.payments.find((p) => p.status === "PAID");

    if (payment && payment.externalId) {
      if (input.amountCents !== undefined && input.amountCents > payment.amountCents) {
        throw new BadRequestException("Valor do estorno maior que o pagamento");
      }

      const marked = await prisma.payment.updateMany({
        where: { id: payment.id, status: "PAID" },
        data: { status: "REFUND_PENDING" },
      });
      if (marked.count === 0) {
        throw new BadRequestException("Estorno já em andamento para este pagamento");
      }

      const gateway = getGateway(payment.provider);
      let result;
      try {
        result = await gateway.refund({
          externalId: payment.externalId,
          amountCents: input.amountCents,
          idempotencyKey: `producer-refund:${payment.id}:${input.amountCents ?? "full"}`,
        });
      } catch (error) {
        await prisma.payment.updateMany({ where: { id: payment.id, status: "REFUND_PENDING" }, data: { status: "PAID" } });
        throw error;
      }

      if (result.status === "FAILED") {
        await prisma.payment.updateMany({ where: { id: payment.id, status: "REFUND_PENDING" }, data: { status: "PAID" } });
        throw new BadRequestException("Gateway recusou o estorno");
      }

      await applyGatewayStatus(payment.id, result.status, undefined, { refundAmountCents: input.amountCents });
    } else {
      // venda do PDV (dinheiro) — sem gateway: estorno manual no ledger
      if (!["PAID", "PARTIALLY_REFUNDED"].includes(order.status)) {
        throw new BadRequestException("Pedido não está pago para estornar");
      }
      const amountCents = input.amountCents ?? order.totalCents;
      if (amountCents > order.totalCents) {
        throw new BadRequestException("Valor do estorno maior que o pedido");
      }
      const isFull = amountCents >= order.totalCents;

      await prisma.$transaction(async (tx) => {
        const ledgerAccount = await tx.ledgerAccount.upsert({
          where: { organizationId: order.event.organizationId },
          update: {},
          create: { organizationId: order.event.organizationId },
        });
        await tx.ledgerEntry.create({
          data: {
            ledgerAccountId: ledgerAccount.id,
            type: "REFUND_DEBIT",
            amountCents: -amountCents,
            referenceType: "order",
            referenceId: order.id,
          },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { status: isFull ? "REFUNDED" : "PARTIALLY_REFUNDED" },
        });
        if (isFull) {
          const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
          for (const item of items) {
            await returnSaleInventory(tx, item.ticketLotId, item.quantity);
          }
          await tx.ticket.updateMany({
            where: { orderId: order.id, status: { in: ["ISSUED", "ACTIVE"] } },
            data: { status: "CANCELED", canceledAt: new Date() },
          });
        }
      });
    }

    await prisma.auditLog.create({
      data: {
        actorUserId,
        organizationId: order.event.organizationId,
        action: "order.producer_refund",
        entityType: "order",
        entityId: order.id,
        metadata: { amountCents: input.amountCents, reason: input.reason },
      },
    });

    return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true } });
  }
}
