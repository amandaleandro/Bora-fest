import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import { OrgAccessService } from "../common/org-access.service";

const PAID_ORDER_STATUSES = ["PAID", "FULFILLED"] as const;

@Injectable()
export class DashboardService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  /**
   * Painel do evento: vendedor (SALES_PERFORM) enxerga o painel, mas dados
   * sensíveis do evento inteiro (lista de pedidos, PII de participantes e
   * exportações) exigem FINANCE_VIEW — auditoria 2026-08-10 mostrou vendedor
   * de atlética baixando CSV com nome/e-mail/CPF de todo mundo.
   */
  private async assertEventAccess(eventId: string, actorUserId: string, sensitive = false) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    if (sensitive) {
      await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
      return event;
    }
    try {
      await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
    } catch {
      await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.SALES_PERFORM);
    }
    return event;
  }

  async getDashboard(eventId: string, actorUserId: string) {
    const event = await this.assertEventAccess(eventId, actorUserId);
    // bannerUrl e local no payload — sem eles a prévia do banner "sumia" no
    // F5 do painel e não havia como exibir o local (feedback 2026-08-03)
    const venue = event.venueId
      ? await prisma.venue.findUnique({
          where: { id: event.venueId },
          select: { name: true, address: true, mapsUrl: true, city: true, state: true },
        })
      : null;

    const [ordersByStatus, ticketsByStatus, reviewStats, lots] = await Promise.all([
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
      prisma.eventReview.aggregate({
        where: { eventId },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      prisma.ticketLot.findMany({
        where: { ticketType: { eventId } },
        select: {
          id: true,
          name: true,
          priceCents: true,
          feeCents: true,
          feeMode: true,
          nominal: true,
          requiresCpf: true,
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
      event: {
        id: event.id,
        organizationId: event.organizationId,
        title: event.title,
        slug: event.slug,
        status: event.status,
        category: event.category,
        bannerUrl: event.bannerUrl,
        waitingRoomEnabled: event.waitingRoomEnabled,
        waitingRoomConcurrency: event.waitingRoomConcurrency,
        pixelSettings: event.pixelSettings,
        venue,
      },
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
        feeMode: lot.feeMode,
        nominal: lot.nominal,
        requiresCpf: lot.requiresCpf,
        capacity: lot.capacity,
        sold: lot.soldCount,
        reserved: lot.reservedCount,
        available: Math.max(lot.capacity - lot.soldCount - lot.reservedCount, 0),
        status: lot.status,
      })),
      reviews: {
        average: reviewStats._avg.rating ?? null,
        count: reviewStats._count._all,
      },
    };
  }

  async listOrders(
    eventId: string,
    actorUserId: string,
    options: { status?: string; page: number; pageSize: number },
  ) {
    await this.assertEventAccess(eventId, actorUserId, true);

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

  /** Ranking de vendas por vendedor/atlética — quem vendeu, quantos pedidos deram certo (pagos) e quantos falharam. */
  async listSalesBySeller(eventId: string, actorUserId: string) {
    await this.assertEventAccess(eventId, actorUserId);

    const orders = await prisma.order.findMany({
      where: { eventId, soldByUserId: { not: null } },
      select: {
        status: true,
        totalCents: true,
        partnerCommissionCents: true,
        soldByUserId: true,
        soldByUser: { select: { id: true, name: true, email: true } },
        salesPartner: { select: { id: true, name: true } },
        _count: { select: { tickets: true } },
      },
    });

    const OK_STATUSES = new Set(["PAID", "FULFILLED"]);
    const FAILED_STATUSES = new Set(["REFUNDED", "PARTIALLY_REFUNDED", "CHARGEBACK", "EXPIRED", "CANCELED"]);

    const bySeller = new Map<
      string,
      {
        sellerId: string;
        sellerName: string | null;
        sellerEmail: string | null;
        partnerId: string | null;
        partnerName: string | null;
        ordersOk: number;
        ordersFailed: number;
        ticketsSold: number;
        revenueCents: number;
        commissionCents: number;
      }
    >();

    for (const order of orders) {
      const sellerId = order.soldByUserId as string;
      const key = sellerId;
      const entry = bySeller.get(key) ?? {
        sellerId,
        sellerName: order.soldByUser?.name ?? null,
        sellerEmail: order.soldByUser?.email ?? null,
        partnerId: order.salesPartner?.id ?? null,
        partnerName: order.salesPartner?.name ?? null,
        ordersOk: 0,
        ordersFailed: 0,
        ticketsSold: 0,
        revenueCents: 0,
        commissionCents: 0,
      };

      if (OK_STATUSES.has(order.status)) {
        entry.ordersOk += 1;
        entry.ticketsSold += order._count.tickets;
        entry.revenueCents += order.totalCents;
        entry.commissionCents += order.partnerCommissionCents;
      } else if (FAILED_STATUSES.has(order.status)) {
        entry.ordersFailed += 1;
      }

      bySeller.set(key, entry);
    }

    return Array.from(bySeller.values()).sort((a, b) => b.revenueCents - a.revenueCents);
  }

  /**
   * Ranking de vendas por atlética/parceiro para competição — soma de todos os vendedores
   * vinculados a cada SalesPartner, ordenado por nº de ingressos vendidos (critério da disputa).
   */
  async listSalesByPartner(eventId: string, actorUserId: string) {
    await this.assertEventAccess(eventId, actorUserId);

    const orders = await prisma.order.findMany({
      where: { eventId, salesPartnerId: { not: null } },
      select: {
        status: true,
        totalCents: true,
        partnerCommissionCents: true,
        salesPartnerId: true,
        salesPartner: { select: { id: true, name: true, slug: true } },
        _count: { select: { tickets: true } },
      },
    });

    const OK_STATUSES = new Set(["PAID", "FULFILLED"]);
    const FAILED_STATUSES = new Set(["REFUNDED", "PARTIALLY_REFUNDED", "CHARGEBACK", "EXPIRED", "CANCELED"]);

    const byPartner = new Map<
      string,
      {
        partnerId: string;
        partnerName: string | null;
        partnerSlug: string | null;
        ordersOk: number;
        ordersFailed: number;
        ticketsSold: number;
        revenueCents: number;
        commissionCents: number;
      }
    >();

    for (const order of orders) {
      const partnerId = order.salesPartnerId as string;
      const entry = byPartner.get(partnerId) ?? {
        partnerId,
        partnerName: order.salesPartner?.name ?? null,
        partnerSlug: order.salesPartner?.slug ?? null,
        ordersOk: 0,
        ordersFailed: 0,
        ticketsSold: 0,
        revenueCents: 0,
        commissionCents: 0,
      };

      if (OK_STATUSES.has(order.status)) {
        entry.ordersOk += 1;
        entry.ticketsSold += order._count.tickets;
        entry.revenueCents += order.totalCents;
        entry.commissionCents += order.partnerCommissionCents;
      } else if (FAILED_STATUSES.has(order.status)) {
        entry.ordersFailed += 1;
      }

      byPartner.set(partnerId, entry);
    }

    return Array.from(byPartner.values()).sort((a, b) => b.ticketsSold - a.ticketsSold);
  }

  /** Mesma checagem de acesso do ranking, exposta pra stream SSE poder validar antes de abrir a conexão. */
  async assertRankingAccess(eventId: string, actorUserId: string): Promise<void> {
    await this.assertEventAccess(eventId, actorUserId);
  }

  async listParticipants(eventId: string, actorUserId: string) {
    await this.assertEventAccess(eventId, actorUserId, true);
    return this.fetchParticipants(eventId);
  }

  async exportParticipantsCsv(eventId: string, actorUserId: string): Promise<string> {
    await this.assertEventAccess(eventId, actorUserId, true);
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

  /** CSV de pedidos p/ prestação de contas do produtor (bruto, taxa e líquido por pedido). */
  async exportOrdersCsv(eventId: string, actorUserId: string): Promise<string> {
    await this.assertEventAccess(eventId, actorUserId, true);

    const orders = await prisma.order.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
      select: {
        publicToken: true,
        contactName: true,
        contactEmail: true,
        status: true,
        totalCents: true,
        discountCents: true,
        createdAt: true,
        paidAt: true,
        items: { select: { quantity: true, priceCents: true, feeCents: true } },
        payments: { select: { method: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    const header =
      "pedido,data,comprador,email,itens,valor_bruto,taxa_servico,valor_liquido,desconto,status,meio_pagamento";
    const rows = orders.map((o) => {
      const itemCount = o.items.reduce((sum, i) => sum + i.quantity, 0);
      const feeCents = o.items.reduce((sum, i) => sum + i.feeCents * i.quantity, 0);
      const grossCents = o.totalCents + o.discountCents; // bruto antes do desconto do cupom
      const netCents = grossCents - feeCents - o.discountCents;
      return [
        o.publicToken,
        o.createdAt.toISOString(),
        o.contactName ?? "",
        o.contactEmail,
        itemCount,
        (grossCents / 100).toFixed(2),
        (feeCents / 100).toFixed(2),
        (netCents / 100).toFixed(2),
        (o.discountCents / 100).toFixed(2),
        o.status,
        o.payments[0]?.method ?? "",
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",");
    });

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
