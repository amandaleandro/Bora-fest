import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PERMISSIONS } from "@borafest/auth";
import { prisma } from "@borafest/database";
import type {
  CreateVipInventoryInput,
  CreateVipReservationInput,
  ResolveVipReservationInput,
  UpdateVipInventoryInput,
} from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";

@Injectable()
export class VipService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  private async assertEventAccess(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);
    return event;
  }

  private async availabilityByInventory(inventoryIds: string[]) {
    if (inventoryIds.length === 0) return new Map<string, number>();
    const rows = await prisma.vipReservation.groupBy({
      by: ["vipInventoryId"],
      where: { vipInventoryId: { in: inventoryIds }, status: "CONFIRMED" },
      _sum: { units: true },
    });
    return new Map(rows.map((row) => [row.vipInventoryId, row._sum.units ?? 0]));
  }

  async createInventory(eventId: string, actorUserId: string, input: CreateVipInventoryInput) {
    const event = await this.assertEventAccess(eventId, actorUserId);
    const inventory = await prisma.vipInventory.create({
      data: {
        eventId,
        kind: input.kind,
        name: input.name,
        description: input.description,
        benefits: input.benefits,
        unitPriceCents: input.unitPriceCents,
        quantity: input.quantity,
        capacityPerUnit: input.capacityPerUnit,
        maxUnitsPerReservation: input.maxUnitsPerReservation,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId,
        organizationId: event.organizationId,
        action: "vip.inventory.created",
        entityType: "VipInventory",
        entityId: inventory.id,
        metadata: { eventId, quantity: inventory.quantity, unitPriceCents: inventory.unitPriceCents },
      },
    });
    return { ...inventory, confirmedUnits: 0, availableUnits: inventory.quantity };
  }

  async listInventory(eventId: string, actorUserId: string) {
    await this.assertEventAccess(eventId, actorUserId);
    const inventories = await prisma.vipInventory.findMany({
      where: { eventId },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    });
    const confirmed = await this.availabilityByInventory(inventories.map((item) => item.id));
    return inventories.map((item) => {
      const confirmedUnits = confirmed.get(item.id) ?? 0;
      return { ...item, confirmedUnits, availableUnits: Math.max(0, item.quantity - confirmedUnits) };
    });
  }

  async updateInventory(inventoryId: string, actorUserId: string, input: UpdateVipInventoryInput) {
    const current = await prisma.vipInventory.findUnique({
      where: { id: inventoryId },
      include: { event: true },
    });
    if (!current) throw new NotFoundException("Espaço VIP não encontrado");
    await this.orgAccess.assertPermission(current.event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vip_inventory WHERE id = ${inventoryId}::uuid FOR UPDATE`;
      const locked = await tx.vipInventory.findUnique({ where: { id: inventoryId } });
      if (!locked) throw new NotFoundException("Espaço VIP não encontrado");

      const confirmed = await tx.vipReservation.aggregate({
        where: { vipInventoryId: inventoryId, status: "CONFIRMED" },
        _sum: { units: true },
      });
      const confirmedUnits = confirmed._sum.units ?? 0;
      const nextQuantity = input.quantity ?? locked.quantity;
      const nextMax = input.maxUnitsPerReservation ?? locked.maxUnitsPerReservation;
      if (nextQuantity < confirmedUnits) {
        throw new ConflictException(`Já existem ${confirmedUnits} unidade(s) confirmada(s); a quantidade não pode ficar abaixo disso`);
      }
      if (nextMax > nextQuantity) {
        throw new BadRequestException("O máximo por reserva não pode superar a quantidade disponível");
      }

      const updated = await tx.vipInventory.update({
        where: { id: inventoryId },
        data: input,
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          organizationId: current.event.organizationId,
          action: "vip.inventory.updated",
          entityType: "VipInventory",
          entityId: inventoryId,
          metadata: input as any,
        },
      });
      return {
        ...updated,
        confirmedUnits,
        availableUnits: Math.max(0, updated.quantity - confirmedUnits),
      };
    });
  }

  async publicInventory(eventSlug: string) {
    const event = await prisma.event.findUnique({
      where: { slug: eventSlug },
      select: { id: true, title: true, slug: true, status: true, startsAt: true, endsAt: true },
    });
    if (!event || event.status !== "PUBLISHED" || event.endsAt <= new Date()) {
      throw new NotFoundException("Evento não encontrado");
    }
    const inventories = await prisma.vipInventory.findMany({
      where: { eventId: event.id, active: true },
      orderBy: { unitPriceCents: "asc" },
    });
    const confirmed = await this.availabilityByInventory(inventories.map((item) => item.id));
    return {
      event: { id: event.id, title: event.title, slug: event.slug, startsAt: event.startsAt },
      spaces: inventories.map((item) => {
        const confirmedUnits = confirmed.get(item.id) ?? 0;
        return {
          id: item.id,
          kind: item.kind,
          name: item.name,
          description: item.description,
          benefits: item.benefits,
          unitPriceCents: item.unitPriceCents,
          capacityPerUnit: item.capacityPerUnit,
          maxUnitsPerReservation: item.maxUnitsPerReservation,
          availableUnits: Math.max(0, item.quantity - confirmedUnits),
        };
      }),
    };
  }

  async requestReservation(eventSlug: string, input: CreateVipReservationInput) {
    const event = await prisma.event.findUnique({
      where: { slug: eventSlug },
      select: { id: true, status: true, endsAt: true },
    });
    if (!event || event.status !== "PUBLISHED" || event.endsAt <= new Date()) {
      throw new NotFoundException("Evento não encontrado");
    }

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vip_inventory WHERE id = ${input.inventoryId}::uuid FOR UPDATE`;
      const inventory = await tx.vipInventory.findUnique({ where: { id: input.inventoryId } });
      if (!inventory || inventory.eventId !== event.id || !inventory.active) {
        throw new NotFoundException("Espaço VIP não encontrado");
      }
      if (input.units > inventory.maxUnitsPerReservation) {
        throw new BadRequestException(`Máximo de ${inventory.maxUnitsPerReservation} unidade(s) por reserva`);
      }
      if (input.partySize > input.units * inventory.capacityPerUnit) {
        throw new BadRequestException("O tamanho do grupo supera a capacidade das unidades solicitadas");
      }

      const confirmed = await tx.vipReservation.aggregate({
        where: { vipInventoryId: inventory.id, status: "CONFIRMED" },
        _sum: { units: true },
      });
      const availableUnits = inventory.quantity - (confirmed._sum.units ?? 0);
      if (input.units > availableUnits) {
        throw new ConflictException("Não há unidades VIP suficientes disponíveis");
      }

      const reservation = await tx.vipReservation.create({
        data: {
          vipInventoryId: inventory.id,
          contactName: input.contactName,
          contactEmail: input.contactEmail.trim().toLowerCase(),
          contactPhone: input.contactPhone.trim(),
          partySize: input.partySize,
          units: input.units,
          unitPriceCents: inventory.unitPriceCents,
          totalCents: inventory.unitPriceCents * input.units,
          customerNote: input.customerNote,
        },
      });
      return {
        id: reservation.id,
        publicToken: reservation.publicToken,
        status: reservation.status,
        totalCents: reservation.totalCents,
        message: "Pedido de reserva enviado. A confirmação depende da aprovação da Casa.",
      };
    });
  }

  async listReservations(eventId: string, actorUserId: string) {
    await this.assertEventAccess(eventId, actorUserId);
    return prisma.vipReservation.findMany({
      where: { inventory: { eventId } },
      include: { inventory: { select: { id: true, name: true, kind: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
  }

  async confirmReservation(reservationId: string, actorUserId: string, input: ResolveVipReservationInput) {
    const initial = await prisma.vipReservation.findUnique({
      where: { id: reservationId },
      include: { inventory: { include: { event: true } } },
    });
    if (!initial) throw new NotFoundException("Reserva VIP não encontrada");
    await this.orgAccess.assertPermission(initial.inventory.event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vip_inventory WHERE id = ${initial.vipInventoryId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM vip_reservations WHERE id = ${reservationId}::uuid FOR UPDATE`;
      const reservation = await tx.vipReservation.findUnique({ where: { id: reservationId } });
      if (!reservation) throw new NotFoundException("Reserva VIP não encontrada");
      if (reservation.status === "CONFIRMED") return reservation;
      if (reservation.status !== "REQUESTED") {
        throw new ConflictException("Apenas reservas solicitadas podem ser confirmadas");
      }
      const inventory = await tx.vipInventory.findUnique({ where: { id: reservation.vipInventoryId } });
      if (!inventory || !inventory.active) throw new ConflictException("O espaço VIP não está mais ativo");
      const confirmed = await tx.vipReservation.aggregate({
        where: { vipInventoryId: inventory.id, status: "CONFIRMED" },
        _sum: { units: true },
      });
      const availableUnits = inventory.quantity - (confirmed._sum.units ?? 0);
      if (reservation.units > availableUnits) {
        throw new ConflictException("A reserva não pode ser confirmada: o inventário VIP acabou");
      }
      const updated = await tx.vipReservation.update({
        where: { id: reservationId },
        data: { status: "CONFIRMED", respondedAt: new Date(), resolutionNote: input.note },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          organizationId: initial.inventory.event.organizationId,
          action: "vip.reservation.confirmed",
          entityType: "VipReservation",
          entityId: reservationId,
          metadata: { units: updated.units, totalCents: updated.totalCents },
        },
      });
      return updated;
    });
  }

  async rejectReservation(reservationId: string, actorUserId: string, input: ResolveVipReservationInput) {
    const initial = await prisma.vipReservation.findUnique({
      where: { id: reservationId },
      include: { inventory: { include: { event: true } } },
    });
    if (!initial) throw new NotFoundException("Reserva VIP não encontrada");
    await this.orgAccess.assertPermission(initial.inventory.event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vip_inventory WHERE id = ${initial.vipInventoryId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM vip_reservations WHERE id = ${reservationId}::uuid FOR UPDATE`;
      const reservation = await tx.vipReservation.findUnique({ where: { id: reservationId } });
      if (!reservation) throw new NotFoundException("Reserva VIP não encontrada");
      if (reservation.status === "REJECTED") return reservation;
      if (reservation.status !== "REQUESTED") {
        throw new ConflictException("Apenas reservas solicitadas podem ser recusadas");
      }
      const updated = await tx.vipReservation.update({
        where: { id: reservationId },
        data: { status: "REJECTED", respondedAt: new Date(), resolutionNote: input.note },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          organizationId: initial.inventory.event.organizationId,
          action: "vip.reservation.rejected",
          entityType: "VipReservation",
          entityId: reservationId,
          metadata: input.note ? { note: input.note } : undefined,
        },
      });
      return updated;
    });
  }

  async cancelReservation(reservationId: string, actorUserId: string, input: ResolveVipReservationInput) {
    const initial = await prisma.vipReservation.findUnique({
      where: { id: reservationId },
      include: { inventory: { include: { event: true } } },
    });
    if (!initial) throw new NotFoundException("Reserva VIP não encontrada");
    await this.orgAccess.assertPermission(initial.inventory.event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vip_inventory WHERE id = ${initial.vipInventoryId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM vip_reservations WHERE id = ${reservationId}::uuid FOR UPDATE`;
      const reservation = await tx.vipReservation.findUnique({ where: { id: reservationId } });
      if (!reservation) throw new NotFoundException("Reserva VIP não encontrada");
      if (reservation.status === "CANCELED") return reservation;
      if (reservation.status !== "REQUESTED" && reservation.status !== "CONFIRMED") {
        throw new ConflictException("Esta reserva não pode mais ser cancelada");
      }

      const blocking = await tx.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM vip_payments
          WHERE vip_reservation_id = ${reservationId}::uuid
            AND status IN (
              'PENDING'::"PaymentStatus", 'AUTHORIZED'::"PaymentStatus",
              'PAID'::"PaymentStatus", 'REFUND_PENDING'::"PaymentStatus"
            )
        ) AS exists
      `;
      if (blocking[0]?.exists) {
        throw new ConflictException(
          "Há um pagamento VIP ativo ou pago. Resolva/estorne o pagamento antes de cancelar a reserva.",
        );
      }

      const updated = await tx.vipReservation.update({
        where: { id: reservationId },
        data: { status: "CANCELED", respondedAt: new Date(), resolutionNote: input.note },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          organizationId: initial.inventory.event.organizationId,
          action: "vip.reservation.canceled",
          entityType: "VipReservation",
          entityId: reservationId,
          metadata: input.note ? { note: input.note } : undefined,
        },
      });
      return updated;
    });
  }
}
