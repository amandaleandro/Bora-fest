import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import { OrgAccessService } from "../common/org-access.service";

const PAID_ORDER_STATUSES = ["PAID", "FULFILLED"] as const;

@Injectable()
export class DashboardService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  private async assertEventAccess(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
    return event;
  }

  async getDashboard(eventId: string, actorUserId: string) {
    const event = await this.assertEventAccess(eventId, actorUserId);

    const [ordersByStatus, ticketsByStatus, lots] = await Promise.all([
      prisma.order.groupBy({
        by: ["status"],
        where: { eventId },
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      prisma.ticket.groupBy({
        by: ["status"],
        where: { eventId },
        _count: { _all: true },
      }),
      prisma.ticketLot.findMany({
        where: { ticketType: { eventId } },
        select: {
          id: true,
          name: true,
          priceCents: true,
          feeCents: true,
          capacity: true,
          soldCount: true,
          reservedCount: true,
          status: true,
          ticketType: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const revenueCents = ordersByStatus
      .filter((o) => (PAID_ORDER_STATUSES as readonly string[]).includes(o.status))
      .reduce((sum, o) => sum + (o._sum.totalCents ?? 0), 0);

    return {
      event: { id: event.id, title: event.title, slug: event.slug, status: event.status },
      revenueCents,
      orders: {
        total: ordersByStatus.reduce((sum, o) => sum + o._count._all, 0),
        byStatus: Object.fromEntries(ordersByStatus.map((o) => [o.status, o._count._all])),
      },
      tickets: {
        total: ticketsByStatus.reduce((sum, t) => sum + t._count._all, 0),
        byStatus: Object.fromEntries(ticketsByStatus.map((t) => [t.status, t._count._all])),
      },
      lots: lots.map((lot) => ({
        id: lot.id,
        name: lot.name,
        ticketTypeId: lot.ticketType.id,
        typeName: lot.ticketType.name,
        priceCents: lot.priceCents,
        feeCents: lot.feeCents,
        capacity: lot.capacity,
        sold: lot.soldCount,
        reserved: lot.reservedCount,
        available: Math.max(lot.capacity - lot.soldCount - lot.reservedCount, 0),
        status: lot.status,
      })),
    };
  }

  async listOrders(
    eventId: string,
    actorUserId: string,
    options: { status?: string; page: number; pageSize: number },
  ) {
    await this.assertEventAccess(eventId, actorUserId);

    const where = {
      eventId,
      ...(options.status ? { status: options.status as never } : {}),
    };

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
        select: {
          id: true,
          publicToken: true,
          contactName: true,
          contactEmail: true,
          status: true,
          totalCents: true,
          createdAt: true,
          paidAt: true,
          _count: { select: { tickets: true } },
        },
      }),
    ]);

    return { total, page: options.page, pageSize: options.pageSize, orders };
  }

  async listParticipants(eventId: string, actorUserId: string) {
    await this.assertEventAccess(eventId, actorUserId);
    return this.fetchParticipants(eventId);
  }

  async exportParticipantsCsv(eventId: string, actorUserId: string): Promise<string> {
    await this.assertEventAccess(eventId, actorUserId);
    const participants = await this.fetchParticipants(eventId);

    const header = "codigo,nome,email,tipo,lote,status,checkin_em";
    const rows = participants.map((p) =>
      [
        p.code,
        p.attendeeName ?? "",
        p.attendeeEmail ?? "",
        p.typeName,
        p.lotName,
        p.status,
        p.checkedInAt ? p.checkedInAt.toISOString() : "",
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    );

    return [header, ...rows].join("\n");
  }

  private fetchParticipants(eventId: string) {
    return prisma.ticket
      .findMany({
        where: { eventId },
        orderBy: [{ orderItemId: "asc" }, { seq: "asc" }],
        select: {
          id: true,
          code: true,
          status: true,
          attendeeName: true,
          attendeeEmail: true,
          checkedInAt: true,
          ticketLot: { select: { name: true, ticketType: { select: { name: true } } } },
          order: { select: { contactName: true, contactEmail: true } },
        },
      })
      .then((tickets) =>
        tickets.map((t) => ({
          id: t.id,
          code: t.code,
          status: t.status,
          attendeeName: t.attendeeName ?? t.order.contactName,
          attendeeEmail: t.attendeeEmail ?? t.order.contactEmail,
          checkedInAt: t.checkedInAt,
          typeName: t.ticketLot.ticketType.name,
          lotName: t.ticketLot.name,
        })),
      );
  }
}
