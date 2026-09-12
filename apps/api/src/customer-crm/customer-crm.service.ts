import { BadRequestException, Injectable } from "@nestjs/common";
import { PERMISSIONS } from "@borafest/auth";
import { Prisma, prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";

export const CRM_SEGMENTS = [
  "ALL",
  "FIRST_TIME",
  "RECURRING",
  "FREQUENT",
  "LAPSED_30",
  "NO_SHOW",
  "FOLLOWER",
  "EMAIL_OPT_IN",
] as const;
export type CrmSegment = (typeof CRM_SEGMENTS)[number];

type CustomerRow = {
  emailKey: string;
  email: string;
  name: string | null;
  phone: string | null;
  userId: string | null;
  paidOrders: number;
  eventsCount: number;
  spentCents: bigint;
  firstPurchaseAt: Date;
  lastPurchaseAt: Date;
  lastEventAt: Date;
  nextEventAt: Date | null;
  ticketsCount: number;
  checkedInTickets: number;
  attendedEvents: number;
  pastEvents: number;
  followsHouse: boolean;
  emailOffersOptIn: boolean;
  lastPromoterName: string | null;
  totalRows: bigint;
  recurringRows: bigint;
  frequentRows: bigint;
  lapsed30Rows: bigint;
  noShowRows: bigint;
  followersRows: bigint;
  emailOptInRows: bigint;
};

function safePage(value?: number) {
  return Math.max(1, Math.floor(value || 1));
}

function safePageSize(value?: number) {
  return Math.min(100, Math.max(1, Math.floor(value || 30)));
}

@Injectable()
export class CustomerCrmService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async list(
    organizationId: string,
    actorUserId: string,
    options: { q?: string; segment?: string; page?: number; pageSize?: number },
  ) {
    // CRM expõe PII de compradores. Não basta conseguir criar evento/equipe:
    // só perfis que já podem ver pedidos/financeiro enxergam esta visão.
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);

    const segment = (options.segment || "ALL").toUpperCase();
    if (!CRM_SEGMENTS.includes(segment as CrmSegment)) {
      throw new BadRequestException("Segmento de clientes inválido");
    }

    const page = safePage(options.page);
    const pageSize = safePageSize(options.pageSize);
    const offset = (page - 1) * pageSize;
    const q = options.q?.trim().toLowerCase() || "";

    const searchFilter = q
      ? Prisma.sql`AND (
          LOWER(j.email) LIKE ${`%${q}%`}
          OR LOWER(COALESCE(j.name, '')) LIKE ${`%${q}%`}
          OR COALESCE(j.phone, '') LIKE ${`%${q.replace(/\D/g, "")}%`}
        )`
      : Prisma.empty;

    const segmentFilter =
      segment === "FIRST_TIME" ? Prisma.sql`AND j.events_count = 1`
      : segment === "RECURRING" ? Prisma.sql`AND j.events_count >= 2`
      : segment === "FREQUENT" ? Prisma.sql`AND j.events_count >= 3`
      : segment === "LAPSED_30" ? Prisma.sql`AND j.next_event_at IS NULL AND j.last_event_at < NOW() - INTERVAL '30 days'`
      : segment === "NO_SHOW" ? Prisma.sql`AND j.past_events > 0 AND j.attended_events = 0`
      : segment === "FOLLOWER" ? Prisma.sql`AND j.follows_house = TRUE`
      : segment === "EMAIL_OPT_IN" ? Prisma.sql`AND j.email_offers_opt_in = TRUE`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
      WITH paid_orders AS (
        SELECT
          o.id,
          o.user_id,
          o.event_id,
          o.contact_email,
          o.contact_name,
          o.contact_phone,
          o.total_cents,
          o.promoter_link_id,
          COALESCE(o.paid_at, o.created_at) AS purchase_at,
          e.starts_at
        FROM orders o
        INNER JOIN events e ON e.id = o.event_id
        WHERE e.organization_id = ${organizationId}::uuid
          AND o.status IN ('PAID', 'FULFILLED')
          AND LENGTH(TRIM(o.contact_email)) > 0
      ),
      customer_stats AS (
        SELECT
          LOWER(TRIM(contact_email)) AS email_key,
          COUNT(*)::int AS paid_orders,
          COUNT(DISTINCT event_id)::int AS events_count,
          COALESCE(SUM(total_cents), 0)::bigint AS spent_cents,
          MIN(purchase_at) AS first_purchase_at,
          MAX(purchase_at) AS last_purchase_at,
          MAX(starts_at) AS last_event_at,
          MIN(starts_at) FILTER (WHERE starts_at > NOW()) AS next_event_at,
          COUNT(DISTINCT event_id) FILTER (WHERE starts_at < NOW())::int AS past_events
        FROM paid_orders
        GROUP BY LOWER(TRIM(contact_email))
      ),
      ticket_stats AS (
        SELECT
          LOWER(TRIM(po.contact_email)) AS email_key,
          COUNT(t.id)::int AS tickets_count,
          COUNT(t.id) FILTER (WHERE t.checked_in_at IS NOT NULL)::int AS checked_in_tickets,
          COUNT(DISTINCT po.event_id) FILTER (WHERE t.checked_in_at IS NOT NULL)::int AS attended_events
        FROM paid_orders po
        LEFT JOIN tickets t ON t.order_id = po.id
        GROUP BY LOWER(TRIM(po.contact_email))
      ),
      latest_order AS (
        SELECT DISTINCT ON (LOWER(TRIM(contact_email)))
          LOWER(TRIM(contact_email)) AS email_key,
          contact_email AS email,
          contact_name AS name,
          contact_phone AS phone,
          user_id,
          promoter_link_id
        FROM paid_orders
        ORDER BY LOWER(TRIM(contact_email)), purchase_at DESC, id DESC
      ),
      joined AS (
        SELECT
          cs.email_key,
          lo.email,
          lo.name,
          lo.phone,
          lo.user_id,
          cs.paid_orders,
          cs.events_count,
          cs.spent_cents,
          cs.first_purchase_at,
          cs.last_purchase_at,
          cs.last_event_at,
          cs.next_event_at,
          COALESCE(ts.tickets_count, 0)::int AS tickets_count,
          COALESCE(ts.checked_in_tickets, 0)::int AS checked_in_tickets,
          COALESCE(ts.attended_events, 0)::int AS attended_events,
          cs.past_events,
          (ofol.id IS NOT NULL) AS follows_house,
          COALESCE(u.notify_email_offers, FALSE) AS email_offers_opt_in,
          pu.name AS last_promoter_name
        FROM customer_stats cs
        INNER JOIN latest_order lo ON lo.email_key = cs.email_key
        LEFT JOIN ticket_stats ts ON ts.email_key = cs.email_key
        LEFT JOIN users u ON u.id = lo.user_id
        LEFT JOIN organization_follows ofol
          ON ofol.organization_id = ${organizationId}::uuid AND ofol.user_id = lo.user_id
        LEFT JOIN promoter_links pl ON pl.id = lo.promoter_link_id
        LEFT JOIN users pu ON pu.id = pl.promoter_user_id
      ),
      filtered AS (
        SELECT * FROM joined j
        WHERE TRUE
        ${searchFilter}
        ${segmentFilter}
      )
      SELECT
        f.email_key AS "emailKey",
        f.email,
        f.name,
        f.phone,
        f.user_id AS "userId",
        f.paid_orders AS "paidOrders",
        f.events_count AS "eventsCount",
        f.spent_cents AS "spentCents",
        f.first_purchase_at AS "firstPurchaseAt",
        f.last_purchase_at AS "lastPurchaseAt",
        f.last_event_at AS "lastEventAt",
        f.next_event_at AS "nextEventAt",
        f.tickets_count AS "ticketsCount",
        f.checked_in_tickets AS "checkedInTickets",
        f.attended_events AS "attendedEvents",
        f.past_events AS "pastEvents",
        f.follows_house AS "followsHouse",
        f.email_offers_opt_in AS "emailOffersOptIn",
        f.last_promoter_name AS "lastPromoterName",
        COUNT(*) OVER()::bigint AS "totalRows",
        COUNT(*) FILTER (WHERE f.events_count >= 2) OVER()::bigint AS "recurringRows",
        COUNT(*) FILTER (WHERE f.events_count >= 3) OVER()::bigint AS "frequentRows",
        COUNT(*) FILTER (WHERE f.next_event_at IS NULL AND f.last_event_at < NOW() - INTERVAL '30 days') OVER()::bigint AS "lapsed30Rows",
        COUNT(*) FILTER (WHERE f.past_events > 0 AND f.attended_events = 0) OVER()::bigint AS "noShowRows",
        COUNT(*) FILTER (WHERE f.follows_house) OVER()::bigint AS "followersRows",
        COUNT(*) FILTER (WHERE f.email_offers_opt_in) OVER()::bigint AS "emailOptInRows"
      FROM filtered f
      ORDER BY f.last_purchase_at DESC, f.email_key ASC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `);

    const first = rows[0];
    const customers = rows.map((row) => {
      const tags: string[] = [];
      if (row.eventsCount === 1) tags.push("FIRST_TIME");
      if (row.eventsCount >= 2) tags.push("RECURRING");
      if (row.eventsCount >= 3) tags.push("FREQUENT");
      if (!row.nextEventAt && row.lastEventAt.getTime() < Date.now() - 30 * 86_400_000) tags.push("LAPSED_30");
      if (row.pastEvents > 0 && row.attendedEvents === 0) tags.push("NO_SHOW");
      if (row.followsHouse) tags.push("FOLLOWER");
      if (row.emailOffersOptIn) tags.push("EMAIL_OPT_IN");

      return {
        email: row.email,
        name: row.name,
        phone: row.phone,
        userId: row.userId,
        paidOrders: row.paidOrders,
        eventsCount: row.eventsCount,
        spentCents: Number(row.spentCents),
        firstPurchaseAt: row.firstPurchaseAt,
        lastPurchaseAt: row.lastPurchaseAt,
        lastEventAt: row.lastEventAt,
        nextEventAt: row.nextEventAt,
        ticketsCount: row.ticketsCount,
        checkedInTickets: row.checkedInTickets,
        attendedEvents: row.attendedEvents,
        followsHouse: row.followsHouse,
        emailOffersOptIn: row.emailOffersOptIn,
        lastPromoterName: row.lastPromoterName,
        tags,
      };
    });

    return {
      page,
      pageSize,
      total: Number(first?.totalRows ?? 0n),
      summary: {
        recurring: Number(first?.recurringRows ?? 0n),
        frequent: Number(first?.frequentRows ?? 0n),
        lapsed30: Number(first?.lapsed30Rows ?? 0n),
        noShow: Number(first?.noShowRows ?? 0n),
        followers: Number(first?.followersRows ?? 0n),
        emailOptIn: Number(first?.emailOptInRows ?? 0n),
      },
      customers,
    };
  }
}
