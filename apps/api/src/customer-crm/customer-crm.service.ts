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
  emailKey: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
  userId: string | null;
  paidOrders: number | null;
  eventsCount: number | null;
  spentCents: bigint | null;
  firstPurchaseAt: Date | null;
  lastPurchaseAt: Date | null;
  lastEventAt: Date | null;
  nextEventAt: Date | null;
  ticketsCount: number | null;
  checkedInTickets: number | null;
  attendedEvents: number | null;
  pastEvents: number | null;
  followsHouse: boolean | null;
  emailOffersOptIn: boolean | null;
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
          OR REGEXP_REPLACE(COALESCE(j.phone, ''), '[^0-9]', '', 'g') LIKE ${`%${q.replace(/\D/g, "")}%`}
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
      search_filtered AS (
        SELECT * FROM joined j
        WHERE TRUE
        ${searchFilter}
      ),
      filtered AS (
        SELECT * FROM search_filtered j
        WHERE TRUE
        ${segmentFilter}
      ),
      summary AS (
        SELECT
          (SELECT COUNT(*)::bigint FROM filtered) AS total_rows,
          COUNT(*) FILTER (WHERE sf.events_count >= 2)::bigint AS recurring_rows,
          COUNT(*) FILTER (WHERE sf.events_count >= 3)::bigint AS frequent_rows,
          COUNT(*) FILTER (WHERE sf.next_event_at IS NULL AND sf.last_event_at < NOW() - INTERVAL '30 days')::bigint AS lapsed30_rows,
          COUNT(*) FILTER (WHERE sf.past_events > 0 AND sf.attended_events = 0)::bigint AS no_show_rows,
          COUNT(*) FILTER (WHERE sf.follows_house)::bigint AS followers_rows,
          COUNT(*) FILTER (WHERE sf.email_offers_opt_in)::bigint AS email_opt_in_rows
        FROM search_filtered sf
      ),
      page_rows AS (
        SELECT * FROM filtered
        ORDER BY last_purchase_at DESC, email_key ASC
        LIMIT ${pageSize}
        OFFSET ${offset}
      )
      SELECT
        p.email_key AS "emailKey",
        p.email,
        p.name,
        p.phone,
        p.user_id AS "userId",
        p.paid_orders AS "paidOrders",
        p.events_count AS "eventsCount",
        p.spent_cents AS "spentCents",
        p.first_purchase_at AS "firstPurchaseAt",
        p.last_purchase_at AS "lastPurchaseAt",
        p.last_event_at AS "lastEventAt",
        p.next_event_at AS "nextEventAt",
        p.tickets_count AS "ticketsCount",
        p.checked_in_tickets AS "checkedInTickets",
        p.attended_events AS "attendedEvents",
        p.past_events AS "pastEvents",
        p.follows_house AS "followsHouse",
        p.email_offers_opt_in AS "emailOffersOptIn",
        p.last_promoter_name AS "lastPromoterName",
        s.total_rows AS "totalRows",
        s.recurring_rows AS "recurringRows",
        s.frequent_rows AS "frequentRows",
        s.lapsed30_rows AS "lapsed30Rows",
        s.no_show_rows AS "noShowRows",
        s.followers_rows AS "followersRows",
        s.email_opt_in_rows AS "emailOptInRows"
      FROM summary s
      LEFT JOIN page_rows p ON TRUE
      ORDER BY p.last_purchase_at DESC NULLS LAST, p.email_key ASC NULLS LAST
    `);

    // summary sempre devolve uma linha, mesmo quando o segmento/página não tem
    // clientes. Isso mantém os cards corretos e evita transformar "sem resultado"
    // em "não existem recorrentes na base".
    const first = rows[0];
    const customers = rows
      .filter((row) => row.emailKey && row.email && row.lastPurchaseAt && row.lastEventAt)
      .map((row) => {
        const eventsCount = row.eventsCount ?? 0;
        const pastEvents = row.pastEvents ?? 0;
        const attendedEvents = row.attendedEvents ?? 0;
        const tags: string[] = [];
        if (eventsCount === 1) tags.push("FIRST_TIME");
        if (eventsCount >= 2) tags.push("RECURRING");
        if (eventsCount >= 3) tags.push("FREQUENT");
        if (!row.nextEventAt && row.lastEventAt!.getTime() < Date.now() - 30 * 86_400_000) tags.push("LAPSED_30");
        if (pastEvents > 0 && attendedEvents === 0) tags.push("NO_SHOW");
        if (row.followsHouse) tags.push("FOLLOWER");
        if (row.emailOffersOptIn) tags.push("EMAIL_OPT_IN");

        return {
          email: row.email!,
          name: row.name,
          phone: row.phone,
          userId: row.userId,
          paidOrders: row.paidOrders ?? 0,
          eventsCount,
          spentCents: Number(row.spentCents ?? 0n),
          firstPurchaseAt: row.firstPurchaseAt,
          lastPurchaseAt: row.lastPurchaseAt!,
          lastEventAt: row.lastEventAt!,
          nextEventAt: row.nextEventAt,
          ticketsCount: row.ticketsCount ?? 0,
          checkedInTickets: row.checkedInTickets ?? 0,
          attendedEvents,
          followsHouse: Boolean(row.followsHouse),
          emailOffersOptIn: Boolean(row.emailOffersOptIn),
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
