import { Injectable, NotFoundException } from "@nestjs/common";
import { PERMISSIONS } from "@borafest/auth";
import { Prisma, prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";

type AggregateRow = {
  promoterLinkId: string;
  paidOrders: number;
  ticketsSold: number;
  directTickets: number;
  sellerTickets: number;
  grossCents: bigint;
  commissionCents: bigint;
};

@Injectable()
export class PromoterPerformanceService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async forEvent(organizationId: string, eventId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.ORG_MANAGE_MEMBERS);

    const event = await prisma.event.findFirst({
      where: { id: eventId, organizationId },
      select: { id: true, title: true, slug: true, startsAt: true, endsAt: true, status: true },
    });
    if (!event) throw new NotFoundException("Evento não encontrado nesta organização");

    const links = await prisma.promoterLink.findMany({
      where: {
        organizationId,
        status: { in: ["INVITED", "ACTIVE"] },
        OR: [{ eventId: null }, { eventId }],
      },
      include: {
        promoterUser: { select: { id: true, name: true, email: true } },
        sellers: {
          where: { status: "ACTIVE" },
          select: { id: true },
        },
      },
      orderBy: [{ status: "asc" }, { invitedAt: "asc" }],
    });

    const linkIds = links.map((link) => link.id);
    const aggregates = linkIds.length
      ? await prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
          WITH paid_orders AS (
            SELECT
              o.id,
              o.promoter_link_id,
              o.promoter_seller_id,
              o.total_cents,
              o.promoter_commission_cents
            FROM orders o
            WHERE o.event_id = ${eventId}::uuid
              AND o.promoter_link_id IN (${Prisma.join(linkIds.map((id) => Prisma.sql`${id}::uuid`))})
              AND o.status IN ('PAID', 'FULFILLED')
          ),
          money_stats AS (
            SELECT
              promoter_link_id,
              COUNT(*)::int AS paid_orders,
              COALESCE(SUM(total_cents), 0)::bigint AS gross_cents,
              COALESCE(SUM(promoter_commission_cents), 0)::bigint AS commission_cents
            FROM paid_orders
            GROUP BY promoter_link_id
          ),
          ticket_stats AS (
            SELECT
              po.promoter_link_id,
              COALESCE(SUM(oi.quantity), 0)::int AS tickets_sold,
              COALESCE(SUM(CASE WHEN po.promoter_seller_id IS NULL THEN oi.quantity ELSE 0 END), 0)::int AS direct_tickets,
              COALESCE(SUM(CASE WHEN po.promoter_seller_id IS NOT NULL THEN oi.quantity ELSE 0 END), 0)::int AS seller_tickets
            FROM paid_orders po
            INNER JOIN order_items oi ON oi.order_id = po.id
            GROUP BY po.promoter_link_id
          )
          SELECT
            ms.promoter_link_id AS "promoterLinkId",
            ms.paid_orders AS "paidOrders",
            COALESCE(ts.tickets_sold, 0)::int AS "ticketsSold",
            COALESCE(ts.direct_tickets, 0)::int AS "directTickets",
            COALESCE(ts.seller_tickets, 0)::int AS "sellerTickets",
            ms.gross_cents AS "grossCents",
            ms.commission_cents AS "commissionCents"
          FROM money_stats ms
          LEFT JOIN ticket_stats ts ON ts.promoter_link_id = ms.promoter_link_id
        `)
      : [];

    const byLink = new Map(aggregates.map((row) => [row.promoterLinkId, row]));
    const rows = links.map((link) => {
      const stats = byLink.get(link.id);
      return {
        id: link.id,
        status: link.status,
        promoterName: link.promoterUser.name ?? link.promoterUser.email ?? "Promoter",
        promoterUserId: link.promoterUser.id,
        slug: link.slug,
        code: link.code,
        scope: link.eventId ? "EVENT" : "HOUSE",
        activeSellers: link.sellers.length,
        paidOrders: stats?.paidOrders ?? 0,
        ticketsSold: stats?.ticketsSold ?? 0,
        directTickets: stats?.directTickets ?? 0,
        sellerTickets: stats?.sellerTickets ?? 0,
        grossCents: Number(stats?.grossCents ?? 0n),
        commissionCents: Number(stats?.commissionCents ?? 0n),
        commissionType: link.commissionType,
        commissionBps: link.commissionBps,
        commissionFixedCents: link.commissionFixedCents,
      };
    });

    rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === "ACTIVE" ? -1 : 1;
      if (b.ticketsSold !== a.ticketsSold) return b.ticketsSold - a.ticketsSold;
      if (b.grossCents !== a.grossCents) return b.grossCents - a.grossCents;
      return a.promoterName.localeCompare(b.promoterName, "pt-BR");
    });

    let rank = 0;
    const ranked = rows.map((row) => ({
      ...row,
      rank: row.status === "ACTIVE" ? ++rank : null,
    }));

    const active = ranked.filter((row) => row.status === "ACTIVE");
    return {
      event,
      summary: {
        activePromoters: active.length,
        invitedPromoters: ranked.filter((row) => row.status === "INVITED").length,
        ticketsSold: active.reduce((sum, row) => sum + row.ticketsSold, 0),
        paidOrders: active.reduce((sum, row) => sum + row.paidOrders, 0),
        grossCents: active.reduce((sum, row) => sum + row.grossCents, 0),
        commissionCents: active.reduce((sum, row) => sum + row.commissionCents, 0),
      },
      promoters: ranked,
    };
  }
}
