import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma, returnSaleInventory } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateGuestListEntryInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService, InsufficientStockError } from "../inventory/inventory.service";

@Injectable()
export class GuestListService {
  constructor(
    private readonly orgAccess: OrgAccessService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Cadastro na lista de convidados: sem comissão, sem aprovação nome a nome
   * (autonomia do parceiro dentro da cota do lote). Reaproveita a MESMA
   * máquina de emissão de pedidos pagos — pedido-tronco de R$ 0 já PAID +
   * outbox `order.paid` — exatamente como as cortesias (nenhum caminho
   * paralelo de emissão de ticket).
   */
  async create(userId: string, eventId: string, input: CreateGuestListEntryInput) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, userId, PERMISSIONS.SALES_PERFORM);

    const lot = await prisma.ticketLot.findFirst({
      where: { id: input.ticketLotId, ticketType: { eventId } },
    });
    if (!lot) throw new BadRequestException("Lote não pertence a este evento");

    if (input.salesPartnerId) {
      const link = await prisma.eventSalesPartner.findUnique({
        where: { eventId_partnerId: { eventId, partnerId: input.salesPartnerId } },
      });
      if (!link) throw new BadRequestException("Parceiro não está vinculado a este evento");
    }

    const order = await prisma
      .$transaction(async (tx) => {
        await this.inventory.tryReserve(lot.id, 1, tx);
        await this.inventory.confirmSale(lot.id, 1, tx);

        const reservation = await tx.reservation.create({
          data: {
            eventId,
            status: "CONVERTED",
            expiresAt: new Date(),
            items: {
              create: [{ ticketLotId: lot.id, quantity: 1, priceCents: 0, feeCents: 0 }],
            },
          },
        });

        const created = await tx.order.create({
          data: {
            eventId,
            reservationId: reservation.id,
            contactEmail: `guest-list+${reservation.id}@borafest.app`,
            contactName: input.guestName,
            salesPartnerId: input.salesPartnerId,
            soldByUserId: userId,
            attributionSource: input.salesPartnerId ? "MANUAL" : undefined,
            status: "PAID",
            paidAt: new Date(),
            totalCents: 0,
            items: {
              create: [{ ticketLotId: lot.id, quantity: 1, priceCents: 0, feeCents: 0 }],
            },
          },
        });

        await tx.outboxEvent.create({
          data: {
            aggregateType: "order",
            aggregateId: created.id,
            eventType: "order.paid",
            payload: { orderId: created.id, guestList: true },
          },
        });

        const entry = await tx.guestListEntry.create({
          data: {
            eventId,
            ticketLotId: lot.id,
            salesPartnerId: input.salesPartnerId,
            addedByUserId: userId,
            orderId: created.id,
            guestName: input.guestName,
            guestDocument: input.guestDocument,
            guestPhone: input.guestPhone,
            status: "CONFIRMED",
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            organizationId: event.organizationId,
            action: "guest_list.add",
            entityType: "guest_list_entry",
            entityId: entry.id,
            metadata: { ticketLotId: lot.id, guestName: input.guestName, salesPartnerId: input.salesPartnerId ?? null },
          },
        });

        return { order: created, entry };
      })
      .catch((error) => {
        if (error instanceof InsufficientStockError) {
          throw new BadRequestException("Lista cheia — capacidade do lote esgotada");
        }
        throw error;
      });

    return order.entry;
  }

  /** Lista da casa/parceiro, com status do ticket já emitido (para portaria). */
  async list(userId: string, eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, userId, PERMISSIONS.SALES_PERFORM);

    const entries = await prisma.guestListEntry.findMany({
      where: { eventId },
      orderBy: { createdAt: "desc" },
      include: {
        ticketLot: { select: { name: true } },
        salesPartner: { select: { id: true, name: true } },
        ticket: { select: { id: true, status: true, code: true, checkedInAt: true } },
        order: { select: { id: true, status: true } },
      },
    });

    // emissão do ticket é assíncrona (mesmo outbox das cortesias) — preenche
    // ticketId retroativamente quando o worker já processou o pedido
    for (const entry of entries) {
      if (!entry.ticketId && entry.orderId) {
        const issued = await prisma.ticket.findFirst({ where: { orderId: entry.orderId } });
        if (issued) {
          await prisma.guestListEntry.update({ where: { id: entry.id }, data: { ticketId: issued.id } });
          (entry as any).ticket = issued;
          entry.ticketId = issued.id;
        }
      }
    }

    return entries;
  }

  /** Cancela a entrada, revoga o ticket (se já emitido) e devolve a capacidade do lote. */
  async cancel(userId: string, eventId: string, id: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, userId, PERMISSIONS.SALES_PERFORM);

    const entry = await prisma.guestListEntry.findFirst({ where: { id, eventId } });
    if (!entry) throw new NotFoundException("Entrada não encontrada");
    if (entry.status === "CANCELED") return entry;

    await prisma.$transaction(async (tx) => {
      let ticketId = entry.ticketId;
      if (!ticketId && entry.orderId) {
        const issued = await tx.ticket.findFirst({ where: { orderId: entry.orderId } });
        ticketId = issued?.id ?? null;
      }

      if (ticketId) {
        await tx.ticket.updateMany({
          where: { id: ticketId, status: { in: ["ISSUED", "ACTIVE"] } },
          data: { status: "CANCELED", canceledAt: new Date() },
        });
      }

      if (entry.orderId) {
        await tx.order.updateMany({
          where: { id: entry.orderId, status: { in: ["PAID", "FULFILLED"] } },
          data: { status: "CANCELED" },
        });
      }

      await returnSaleInventory(tx, entry.ticketLotId, 1);

      await tx.guestListEntry.update({
        where: { id: entry.id },
        data: { status: "CANCELED", ticketId: ticketId ?? undefined },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          organizationId: event.organizationId,
          action: "guest_list.cancel",
          entityType: "guest_list_entry",
          entityId: entry.id,
          metadata: { ticketLotId: entry.ticketLotId },
        },
      });
    });

    return prisma.guestListEntry.findUniqueOrThrow({ where: { id: entry.id } });
  }
}
