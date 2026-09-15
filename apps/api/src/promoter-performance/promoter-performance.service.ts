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
  /** ENTREGOU GENTE, NÃO PROMESSA (decisão do Arthur, 2026-09-15) */
  soldCheckedIn: number;
  guestsRegistered: number;
  guestsCheckedIn: number;
};

@Injectable()
export class PromoterPerformanceService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  private async assertCanView(organizationId: string, actorUserId: string) {
    try {
      await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.ORG_MANAGE_MEMBERS);
      return;
    } catch {
      await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
    }
  }

  async forEvent(organizationId: string, eventId: string, actorUserId: string) {
    await this.assertCanView(organizationId, actorUserId);

    const event = await prisma.event.findFirst({
      where: { id: eventId, organizationId },
      select: { id: true, title: true, slug: true, startsAt: true, endsAt: true, status: true },
    });
    if (!event) throw new NotFoundException("Evento não encontrado nesta organização");

    // REMOVED continua no relatório quando já vendeu: revogar o vínculo corta
    // atribuições futuras, mas não pode reescrever o histórico do evento.
    const links = await prisma.promoterLink.findMany({
      where: {
        organizationId,
        status: { in: ["INVITED", "ACTIVE", "REMOVED"] },
        OR: [{ eventId: null }, { eventId }],
      },
      include: {
        promoterUser: { select: { id: true, name: true, email: true } },
        sellers: {
          where: { status: "ACTIVE" },
          select: { id: true },
        },
      },
      orderBy: [{ invitedAt: "asc" }],
    });

    const linkIds = links.map((link) => link.id);
    const aggregates = linkIds.length
      ? await prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
          -- QUEM ENTREGOU GENTE, NÃO SÓ PROMESSA (2026-09-15).
          --
          -- Duas correções junto com a métrica nova:
          --  (1) pedido de lista nasce PAID com total_cents = 0, então caía em
          --      "ingressos vendidos": promoter que só lotou lista aparecia como
          --      vendedor, com receita zero. Venda e lista agora são baldes
          --      separados.
          --  (2) o relatório partia de money_stats, então promoter que fez SÓ
          --      lista não tinha linha nenhuma — sumia do relatório. Agora a base
          --      é todo vínculo com atribuição, e o resto entra por LEFT JOIN.
          WITH attributed AS (
            SELECT
              o.id,
              o.promoter_link_id,
              o.promoter_seller_id,
              o.total_cents,
              o.promoter_commission_cents,
              (o.total_cents = 0 AND EXISTS (
                SELECT 1 FROM guest_list_entries g WHERE g.order_id = o.id
              )) AS is_guest
            FROM orders o
            WHERE o.event_id = ${eventId}::uuid
              AND o.promoter_link_id IN (${Prisma.join(linkIds.map((id) => Prisma.sql`${id}::uuid`))})
              AND o.status IN ('PAID', 'FULFILLED')
          ),
          paid_orders AS (
            SELECT * FROM attributed WHERE is_guest = false AND total_cents > 0
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
          ),
          -- PRESENÇA: o ingresso é a unidade, porque quem entra é a pessoa com
          -- ingresso na mão. "Cadastrou" da lista vem de guest_list_entries (é
          -- literalmente o que o promoter colocou lá); "entrou" vem do ticket,
          -- que é o que a porta carimba.
          presence AS (
            SELECT
              a.promoter_link_id,
              COUNT(*) FILTER (WHERE a.is_guest = false AND t.status = 'CHECKED_IN')::int AS sold_checked_in,
              COUNT(*) FILTER (WHERE a.is_guest = true AND t.status = 'CHECKED_IN')::int AS guests_checked_in
            FROM attributed a
            INNER JOIN tickets t ON t.order_id = a.id
            GROUP BY a.promoter_link_id
          ),
          guest_stats AS (
            SELECT
              a.promoter_link_id,
              COUNT(g.id)::int AS guests_registered
            FROM attributed a
            INNER JOIN guest_list_entries g ON g.order_id = a.id
            WHERE a.is_guest = true
            GROUP BY a.promoter_link_id
          ),
          base AS (
            SELECT DISTINCT promoter_link_id FROM attributed
          )
          SELECT
            b.promoter_link_id AS "promoterLinkId",
            COALESCE(ms.paid_orders, 0)::int AS "paidOrders",
            COALESCE(ts.tickets_sold, 0)::int AS "ticketsSold",
            COALESCE(ts.direct_tickets, 0)::int AS "directTickets",
            COALESCE(ts.seller_tickets, 0)::int AS "sellerTickets",
            COALESCE(ms.gross_cents, 0)::bigint AS "grossCents",
            COALESCE(ms.commission_cents, 0)::bigint AS "commissionCents",
            COALESCE(pr.sold_checked_in, 0)::int AS "soldCheckedIn",
            COALESCE(gs.guests_registered, 0)::int AS "guestsRegistered",
            COALESCE(pr.guests_checked_in, 0)::int AS "guestsCheckedIn"
          FROM base b
          LEFT JOIN money_stats ms ON ms.promoter_link_id = b.promoter_link_id
          LEFT JOIN ticket_stats ts ON ts.promoter_link_id = b.promoter_link_id
          LEFT JOIN presence pr ON pr.promoter_link_id = b.promoter_link_id
          LEFT JOIN guest_stats gs ON gs.promoter_link_id = b.promoter_link_id
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
        // ENTREGOU GENTE (2026-09-15): lotar lista não é performance — a
        // pergunta do Arthur era "quais foram validados de fato". `noShow` sai
        // calculado para a tela não repetir a subtração e poder divergir.
        soldCheckedIn: stats?.soldCheckedIn ?? 0,
        guestsRegistered: stats?.guestsRegistered ?? 0,
        guestsCheckedIn: stats?.guestsCheckedIn ?? 0,
        guestsNoShow: Math.max((stats?.guestsRegistered ?? 0) - (stats?.guestsCheckedIn ?? 0), 0),
        /** % da lista que apareceu — null quando não cadastrou ninguém */
        guestShowRate:
          stats?.guestsRegistered
            ? Math.round((stats.guestsCheckedIn / stats.guestsRegistered) * 100)
            : null,
      };
    });

    // Convites pendentes ficam no final. ACTIVE e REMOVED entram no ranking
    // quando possuem histórico, para que revogar alguém não altere o passado.
    rows.sort((a, b) => {
      const aPending = a.status === "INVITED" ? 1 : 0;
      const bPending = b.status === "INVITED" ? 1 : 0;
      if (aPending !== bPending) return aPending - bPending;
      if (b.ticketsSold !== a.ticketsSold) return b.ticketsSold - a.ticketsSold;
      if (b.grossCents !== a.grossCents) return b.grossCents - a.grossCents;
      return a.promoterName.localeCompare(b.promoterName, "pt-BR");
    });

    let rank = 0;
    const ranked = rows.map((row) => ({
      ...row,
      rank: row.status !== "INVITED" && row.ticketsSold > 0 ? ++rank : null,
    }));

    const measured = ranked.filter((row) => row.status !== "INVITED");
    return {
      event,
      summary: {
        activePromoters: ranked.filter((row) => row.status === "ACTIVE").length,
        invitedPromoters: ranked.filter((row) => row.status === "INVITED").length,
        ticketsSold: measured.reduce((sum, row) => sum + row.ticketsSold, 0),
        paidOrders: measured.reduce((sum, row) => sum + row.paidOrders, 0),
        grossCents: measured.reduce((sum, row) => sum + row.grossCents, 0),
        commissionCents: measured.reduce((sum, row) => sum + row.commissionCents, 0),
        soldCheckedIn: measured.reduce((sum, row) => sum + row.soldCheckedIn, 0),
        guestsRegistered: measured.reduce((sum, row) => sum + row.guestsRegistered, 0),
        guestsCheckedIn: measured.reduce((sum, row) => sum + row.guestsCheckedIn, 0),
        guestsNoShow: measured.reduce((sum, row) => sum + row.guestsNoShow, 0),
      },
      promoters: ranked,
    };
  }
}
