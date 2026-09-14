import { Injectable } from "@nestjs/common";
import { PERMISSIONS } from "@borafest/auth";
import { Prisma, prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";

type SummaryRow = {
  totalCustomers: bigint;
  repeatCustomers: bigint;
  frequentCustomers: bigint;
  lapsed30Customers: bigint;
  noShowCustomers: bigint;
  totalRevenueCents: bigint;
  repeatRevenueCents: bigint;
  promoterRevenueCents: bigint;
};

type TrendRow = {
  month: Date;
  uniqueCustomers: bigint;
  newCustomers: bigint;
  returningCustomers: bigint;
  revenueCents: bigint;
};

type EventRow = {
  eventId: string;
  title: string;
  startsAt: Date;
  buyers: bigint;
  newCustomers: bigint;
  returningCustomers: bigint;
  revenueCents: bigint;
  ticketsCount: bigint;
  checkedInTickets: bigint;
};

function percentage(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 10_000) / 100;
}

@Injectable()
export class RetentionIntelligenceService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async get(organizationId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);

    const [summaryRows, trendRows, eventRows] = await Promise.all([
      prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
        WITH paid_orders AS (
          SELECT
            o.id,
            LOWER(TRIM(o.contact_email)) AS email_key,
            o.event_id,
            o.total_cents,
            o.promoter_link_id,
            e.starts_at,
            e.ends_at
          FROM orders o
          INNER JOIN events e ON e.id = o.event_id
          WHERE e.organization_id = ${organizationId}::uuid
            AND o.status IN ('PAID', 'FULFILLED')
            AND LENGTH(TRIM(o.contact_email)) > 0
        ),
        customer_stats AS (
          SELECT
            email_key,
            COUNT(DISTINCT event_id)::bigint AS events_count,
            COALESCE(SUM(total_cents), 0)::bigint AS revenue_cents,
            MAX(starts_at) FILTER (WHERE starts_at <= NOW()) AS last_event_at,
            MIN(starts_at) FILTER (WHERE starts_at > NOW()) AS next_event_at,
            COUNT(DISTINCT event_id) FILTER (WHERE starts_at <= NOW())::bigint AS past_events,
            COALESCE(SUM(total_cents) FILTER (WHERE promoter_link_id IS NOT NULL), 0)::bigint AS promoter_revenue_cents
          FROM paid_orders
          GROUP BY email_key
        ),
        attendance AS (
          SELECT
            po.email_key,
            COUNT(DISTINCT po.event_id) FILTER (WHERE t.checked_in_at IS NOT NULL)::bigint AS attended_events
          FROM paid_orders po
          LEFT JOIN tickets t ON t.order_id = po.id
          GROUP BY po.email_key
        )
        SELECT
          COUNT(*)::bigint AS "totalCustomers",
          COUNT(*) FILTER (WHERE cs.events_count >= 2)::bigint AS "repeatCustomers",
          COUNT(*) FILTER (WHERE cs.events_count >= 3)::bigint AS "frequentCustomers",
          COUNT(*) FILTER (
            WHERE cs.next_event_at IS NULL
              AND cs.last_event_at < NOW() - INTERVAL '30 days'
          )::bigint AS "lapsed30Customers",
          COUNT(*) FILTER (
            WHERE cs.past_events > 0
              AND COALESCE(a.attended_events, 0) = 0
          )::bigint AS "noShowCustomers",
          COALESCE(SUM(cs.revenue_cents), 0)::bigint AS "totalRevenueCents",
          COALESCE(SUM(cs.revenue_cents) FILTER (WHERE cs.events_count >= 2), 0)::bigint AS "repeatRevenueCents",
          COALESCE(SUM(cs.promoter_revenue_cents), 0)::bigint AS "promoterRevenueCents"
        FROM customer_stats cs
        LEFT JOIN attendance a ON a.email_key = cs.email_key
      `),
      prisma.$queryRaw<TrendRow[]>(Prisma.sql`
        WITH months AS (
          SELECT generate_series(
            DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
            DATE_TRUNC('month', NOW()),
            INTERVAL '1 month'
          ) AS month
        ),
        paid_orders AS (
          SELECT
            LOWER(TRIM(o.contact_email)) AS email_key,
            COALESCE(o.paid_at, o.created_at) AS purchase_at,
            o.total_cents
          FROM orders o
          INNER JOIN events e ON e.id = o.event_id
          WHERE e.organization_id = ${organizationId}::uuid
            AND o.status IN ('PAID', 'FULFILLED')
            AND LENGTH(TRIM(o.contact_email)) > 0
        ),
        first_purchase AS (
          SELECT email_key, MIN(purchase_at) AS first_purchase_at
          FROM paid_orders
          GROUP BY email_key
        ),
        monthly AS (
          SELECT
            DATE_TRUNC('month', po.purchase_at) AS month,
            COUNT(DISTINCT po.email_key)::bigint AS unique_customers,
            COUNT(DISTINCT po.email_key) FILTER (
              WHERE DATE_TRUNC('month', fp.first_purchase_at) = DATE_TRUNC('month', po.purchase_at)
            )::bigint AS new_customers,
            COUNT(DISTINCT po.email_key) FILTER (
              WHERE DATE_TRUNC('month', fp.first_purchase_at) < DATE_TRUNC('month', po.purchase_at)
            )::bigint AS returning_customers,
            COALESCE(SUM(po.total_cents), 0)::bigint AS revenue_cents
          FROM paid_orders po
          INNER JOIN first_purchase fp ON fp.email_key = po.email_key
          WHERE po.purchase_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
          GROUP BY DATE_TRUNC('month', po.purchase_at)
        )
        SELECT
          m.month AS "month",
          COALESCE(x.unique_customers, 0)::bigint AS "uniqueCustomers",
          COALESCE(x.new_customers, 0)::bigint AS "newCustomers",
          COALESCE(x.returning_customers, 0)::bigint AS "returningCustomers",
          COALESCE(x.revenue_cents, 0)::bigint AS "revenueCents"
        FROM months m
        LEFT JOIN monthly x ON x.month = m.month
        ORDER BY m.month ASC
      `),
      prisma.$queryRaw<EventRow[]>(Prisma.sql`
        WITH paid_orders AS (
          SELECT
            o.id,
            o.event_id,
            LOWER(TRIM(o.contact_email)) AS email_key,
            o.total_cents,
            e.starts_at
          FROM orders o
          INNER JOIN events e ON e.id = o.event_id
          WHERE e.organization_id = ${organizationId}::uuid
            AND o.status IN ('PAID', 'FULFILLED')
            AND LENGTH(TRIM(o.contact_email)) > 0
        ),
        first_event AS (
          SELECT email_key, MIN(starts_at) AS first_event_at
          FROM paid_orders
          GROUP BY email_key
        ),
        event_customer AS (
          SELECT
            po.event_id,
            po.email_key,
            MIN(po.starts_at) AS starts_at,
            SUM(po.total_cents)::bigint AS revenue_cents,
            MIN(fe.first_event_at) AS first_event_at
          FROM paid_orders po
          INNER JOIN first_event fe ON fe.email_key = po.email_key
          GROUP BY po.event_id, po.email_key
        ),
        event_stats AS (
          SELECT
            ec.event_id,
            COUNT(*)::bigint AS buyers,
            COUNT(*) FILTER (WHERE ec.starts_at = ec.first_event_at)::bigint AS new_customers,
            COUNT(*) FILTER (WHERE ec.starts_at > ec.first_event_at)::bigint AS returning_customers,
            COALESCE(SUM(ec.revenue_cents), 0)::bigint AS revenue_cents
          FROM event_customer ec
          GROUP BY ec.event_id
        ),
        ticket_stats AS (
          SELECT
            o.event_id,
            COUNT(t.id)::bigint AS tickets_count,
            COUNT(t.id) FILTER (WHERE t.checked_in_at IS NOT NULL)::bigint AS checked_in_tickets
          FROM orders o
          INNER JOIN events e ON e.id = o.event_id
          LEFT JOIN tickets t ON t.order_id = o.id
          WHERE e.organization_id = ${organizationId}::uuid
            AND o.status IN ('PAID', 'FULFILLED')
          GROUP BY o.event_id
        )
        SELECT
          e.id AS "eventId",
          e.title,
          e.starts_at AS "startsAt",
          COALESCE(es.buyers, 0)::bigint AS buyers,
          COALESCE(es.new_customers, 0)::bigint AS "newCustomers",
          COALESCE(es.returning_customers, 0)::bigint AS "returningCustomers",
          COALESCE(es.revenue_cents, 0)::bigint AS "revenueCents",
          COALESCE(ts.tickets_count, 0)::bigint AS "ticketsCount",
          COALESCE(ts.checked_in_tickets, 0)::bigint AS "checkedInTickets"
        FROM events e
        LEFT JOIN event_stats es ON es.event_id = e.id
        LEFT JOIN ticket_stats ts ON ts.event_id = e.id
        WHERE e.organization_id = ${organizationId}::uuid
          AND e.status IN ('PUBLISHED', 'SALES_CLOSED', 'COMPLETED')
          AND e.starts_at <= NOW()
        ORDER BY e.starts_at DESC
        LIMIT 8
      `),
    ]);

    const raw = summaryRows[0];
    const totalCustomers = Number(raw?.totalCustomers ?? 0n);
    const repeatCustomers = Number(raw?.repeatCustomers ?? 0n);
    const frequentCustomers = Number(raw?.frequentCustomers ?? 0n);
    const lapsed30Customers = Number(raw?.lapsed30Customers ?? 0n);
    const noShowCustomers = Number(raw?.noShowCustomers ?? 0n);
    const totalRevenueCents = Number(raw?.totalRevenueCents ?? 0n);
    const repeatRevenueCents = Number(raw?.repeatRevenueCents ?? 0n);
    const promoterRevenueCents = Number(raw?.promoterRevenueCents ?? 0n);

    return {
      summary: {
        totalCustomers,
        repeatCustomers,
        repeatRatePct: percentage(repeatCustomers, totalCustomers),
        frequentCustomers,
        lapsed30Customers,
        noShowCustomers,
        totalRevenueCents,
        repeatRevenueCents,
        repeatRevenueSharePct: percentage(repeatRevenueCents, totalRevenueCents),
        promoterRevenueCents,
        promoterRevenueSharePct: percentage(promoterRevenueCents, totalRevenueCents),
        avgRevenuePerCustomerCents: totalCustomers > 0 ? Math.round(totalRevenueCents / totalCustomers) : 0,
      },
      trend: trendRows.map((row) => ({
        month: row.month,
        uniqueCustomers: Number(row.uniqueCustomers),
        newCustomers: Number(row.newCustomers),
        returningCustomers: Number(row.returningCustomers),
        revenueCents: Number(row.revenueCents),
      })),
      events: eventRows.map((row) => {
        const buyers = Number(row.buyers);
        const returningCustomers = Number(row.returningCustomers);
        const ticketsCount = Number(row.ticketsCount);
        const checkedInTickets = Number(row.checkedInTickets);
        return {
          eventId: row.eventId,
          title: row.title,
          startsAt: row.startsAt,
          buyers,
          newCustomers: Number(row.newCustomers),
          returningCustomers,
          returnRatePct: percentage(returningCustomers, buyers),
          revenueCents: Number(row.revenueCents),
          ticketsCount,
          checkedInTickets,
          attendanceRatePct: percentage(checkedInTickets, ticketsCount),
        };
      }),
    };
  }
}
