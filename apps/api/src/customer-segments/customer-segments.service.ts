import { BadRequestException, Injectable } from "@nestjs/common";
import { PERMISSIONS } from "@borafest/auth";
import { Prisma, prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";

export const CUSTOMER_FINANCIAL_SEGMENTS = [
  "ALL",
  "CHAMPION",
  "HIGH_VALUE",
  "NEW_HIGH_VALUE",
  "LOYAL",
  "AT_RISK",
  "LOST_HIGH_VALUE",
  "VIP_BUYER",
  "PROMOTER_DRIVEN",
  "LOYALTY_ENGAGED",
] as const;

export type CustomerFinancialSegment = (typeof CUSTOMER_FINANCIAL_SEGMENTS)[number];

const SEGMENT_DEFINITIONS: Record<Exclude<CustomerFinancialSegment, "ALL">, { label: string; description: string }> = {
  CHAMPION: {
    label: "Campeões",
    description: "Top 20% de LTV, 3+ eventos e compra nos últimos 30 dias.",
  },
  HIGH_VALUE: {
    label: "Alto valor",
    description: "Clientes no top 20% de LTV da própria Casa.",
  },
  NEW_HIGH_VALUE: {
    label: "Novos de alto valor",
    description: "Primeira compra recente já dentro do top 20% de LTV.",
  },
  LOYAL: {
    label: "Fiéis",
    description: "3+ eventos e compra nos últimos 60 dias.",
  },
  AT_RISK: {
    label: "Em risco",
    description: "2+ eventos, sem próxima compra e há mais de 30 dias sem comprar.",
  },
  LOST_HIGH_VALUE: {
    label: "Alto valor perdido",
    description: "Top 20% de LTV, sem próxima compra e há mais de 60 dias sem comprar.",
  },
  VIP_BUYER: {
    label: "Compradores VIP",
    description: "Já pagaram mesa, camarote, lounge ou outro inventário VIP.",
  },
  PROMOTER_DRIVEN: {
    label: "Dependentes de promoter",
    description: "50% ou mais da receita de ingressos veio por promoter.",
  },
  LOYALTY_ENGAGED: {
    label: "Engajados em fidelidade",
    description: "Já acumularam pontos ou resgataram recompensa.",
  },
};

type SegmentStatsRow = {
  segment: Exclude<CustomerFinancialSegment, "ALL">;
  customers: bigint;
  totalLtvCents: bigint;
  avgLtvCents: bigint;
};

type CustomerSegmentRow = {
  email: string;
  name: string | null;
  ltvCents: bigint;
  ticketGrossCents: bigint;
  vipGrossCents: bigint;
  netContributionCents: bigint;
  promoterGrossCents: bigint;
  eventsCount: bigint;
  purchaseCount: bigint;
  lastPurchaseAt: Date | null;
  nextEventAt: Date | null;
  ticketsCount: bigint;
  checkedInTickets: bigint;
  lifetimePoints: bigint;
  rewardsRedeemed: bigint;
  primaryPromoterName: string | null;
  segments: string[];
};

function safePage(value?: number) {
  return Math.max(1, Math.floor(value || 1));
}

function safePageSize(value?: number) {
  return Math.min(100, Math.max(1, Math.floor(value || 30)));
}

const segmentBase = (organizationId: string, ledgerAccountId: string | null) => Prisma.sql`
  WITH ledger AS MATERIALIZED (
    SELECT reference_type, reference_id::uuid AS ref, type::text AS type, amount_cents, created_at
    FROM ledger_entries
    WHERE ledger_account_id = ${ledgerAccountId}::uuid
      AND reference_type IN ('order', 'payment', 'vip_payment')
  ),
  ticket_entries AS (
    SELECT
      LOWER(TRIM(COALESCE(o.contact_email, po.contact_email))) AS email_key,
      COALESCE(o.event_id, po.event_id) AS event_id,
      COALESCE(o.id, po.id) AS order_id,
      COALESCE(o.status::text, po.status::text) AS order_status,
      COALESCE(o.promoter_link_id, po.promoter_link_id) AS promoter_link_id,
      l.type,
      l.amount_cents,
      l.created_at
    FROM ledger l
    LEFT JOIN orders o ON l.reference_type = 'order' AND o.id = l.ref
    LEFT JOIN payments p ON l.reference_type = 'payment' AND p.id = l.ref
    LEFT JOIN orders po ON p.order_id = po.id
    WHERE l.reference_type IN ('order', 'payment')
      AND LENGTH(TRIM(COALESCE(o.contact_email, po.contact_email, ''))) > 0
  ),
  ticket_order_finance AS (
    SELECT
      email_key,
      event_id,
      order_id,
      order_status,
      promoter_link_id,
      COALESCE(SUM(amount_cents) FILTER (WHERE type = 'SALE_CREDIT'), 0)::bigint AS sale_gross,
      COALESCE(SUM(amount_cents) FILTER (WHERE type = 'PROTECTION_CREDIT' AND amount_cents > 0), 0)::bigint AS protection_gross,
      COALESCE(SUM(amount_cents) FILTER (WHERE type = 'PROTECTION_CREDIT'), 0)::bigint AS protection_balance,
      GREATEST(-COALESCE(SUM(amount_cents) FILTER (WHERE type = 'REFUND_DEBIT'), 0), 0)::bigint AS refund_debit,
      COALESCE(SUM(amount_cents), 0)::bigint AS net,
      MIN(created_at) FILTER (WHERE type = 'SALE_CREDIT') AS purchase_at
    FROM ticket_entries
    GROUP BY email_key, event_id, order_id, order_status, promoter_link_id
  ),
  ticket_finance AS (
    SELECT
      email_key,
      COALESCE(SUM(sale_gross + protection_gross), 0)::bigint AS ticket_gross,
      COALESCE(SUM(
        CASE
          WHEN order_status IN ('REFUNDED', 'CHARGEBACK') THEN
            GREATEST((sale_gross + protection_gross) - GREATEST(protection_balance, 0), 0)
          ELSE LEAST(refund_debit, sale_gross + protection_gross)
        END
      ), 0)::bigint AS ticket_refunds,
      COALESCE(SUM(net), 0)::bigint AS ticket_net,
      COALESCE(SUM(sale_gross + protection_gross) FILTER (WHERE promoter_link_id IS NOT NULL), 0)::bigint AS promoter_gross
    FROM ticket_order_finance
    GROUP BY email_key
  ),
  vip_entries AS (
    SELECT
      LOWER(TRIM(vr.contact_email)) AS email_key,
      vi.event_id,
      vp.id AS payment_id,
      l.type,
      l.amount_cents,
      l.created_at
    FROM ledger l
    JOIN vip_payments vp ON l.reference_type = 'vip_payment' AND vp.id = l.ref
    JOIN vip_reservations vr ON vr.id = vp.vip_reservation_id
    JOIN vip_inventory vi ON vi.id = vr.vip_inventory_id
    JOIN events e ON e.id = vi.event_id
    WHERE l.reference_type = 'vip_payment'
      AND e.organization_id = ${organizationId}::uuid
      AND LENGTH(TRIM(vr.contact_email)) > 0
  ),
  vip_finance AS (
    SELECT
      email_key,
      COALESCE(SUM(amount_cents) FILTER (WHERE type = 'SALE_CREDIT'), 0)::bigint AS vip_gross,
      GREATEST(-COALESCE(SUM(amount_cents) FILTER (WHERE type = 'REFUND_DEBIT'), 0), 0)::bigint AS vip_refunds,
      COALESCE(SUM(amount_cents), 0)::bigint AS vip_net
    FROM vip_entries
    GROUP BY email_key
  ),
  purchase_events AS (
    SELECT email_key, event_id, ('T:' || order_id::text) AS purchase_key, purchase_at AS created_at
    FROM ticket_order_finance
    WHERE sale_gross > 0
    UNION ALL
    SELECT email_key, event_id, ('V:' || payment_id::text) AS purchase_key, created_at
    FROM vip_entries
    WHERE type = 'SALE_CREDIT'
  ),
  event_stats AS (
    SELECT
      pe.email_key,
      COUNT(DISTINCT pe.event_id)::bigint AS events_count,
      COUNT(DISTINCT pe.purchase_key)::bigint AS purchase_count,
      MAX(pe.created_at) AS last_purchase_at,
      MIN(e.starts_at) FILTER (WHERE e.starts_at > NOW()) AS next_event_at
    FROM purchase_events pe
    JOIN events e ON e.id = pe.event_id AND e.organization_id = ${organizationId}::uuid
    GROUP BY pe.email_key
  ),
  identities AS (
    SELECT
      LOWER(TRIM(o.contact_email)) AS email_key,
      o.contact_email AS email,
      o.contact_name AS name,
      COALESCE(o.paid_at, o.created_at) AS occurred_at
    FROM orders o
    JOIN events e ON e.id = o.event_id
    WHERE e.organization_id = ${organizationId}::uuid
      AND o.status IN ('PAID', 'FULFILLED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CHARGEBACK')
      AND LENGTH(TRIM(o.contact_email)) > 0
    UNION ALL
    SELECT
      LOWER(TRIM(vr.contact_email)) AS email_key,
      vr.contact_email AS email,
      vr.contact_name AS name,
      vr.created_at AS occurred_at
    FROM vip_reservations vr
    JOIN vip_inventory vi ON vi.id = vr.vip_inventory_id
    JOIN events e ON e.id = vi.event_id
    WHERE e.organization_id = ${organizationId}::uuid
      AND vr.status = 'CONFIRMED'
      AND LENGTH(TRIM(vr.contact_email)) > 0
  ),
  latest_identity AS (
    SELECT DISTINCT ON (email_key) email_key, email, name
    FROM identities
    ORDER BY email_key, occurred_at DESC
  ),
  attendance AS (
    SELECT
      LOWER(TRIM(o.contact_email)) AS email_key,
      COUNT(t.id)::bigint AS tickets_count,
      COUNT(t.id) FILTER (WHERE t.checked_in_at IS NOT NULL)::bigint AS checked_in_tickets
    FROM orders o
    JOIN events e ON e.id = o.event_id
    LEFT JOIN tickets t ON t.order_id = o.id
    WHERE e.organization_id = ${organizationId}::uuid
      AND LENGTH(TRIM(o.contact_email)) > 0
    GROUP BY LOWER(TRIM(o.contact_email))
  ),
  promoter_value AS (
    SELECT
      tof.email_key,
      pl.promoter_user_id,
      COALESCE(u.name, u.email) AS promoter_name,
      SUM(tof.sale_gross + tof.protection_gross)::bigint AS gross,
      ROW_NUMBER() OVER (
        PARTITION BY tof.email_key
        ORDER BY SUM(tof.sale_gross + tof.protection_gross) DESC, pl.promoter_user_id
      ) AS pos
    FROM ticket_order_finance tof
    JOIN promoter_links pl ON pl.id = tof.promoter_link_id
    JOIN users u ON u.id = pl.promoter_user_id
    WHERE tof.promoter_link_id IS NOT NULL AND tof.sale_gross > 0
    GROUP BY tof.email_key, pl.promoter_user_id, u.name, u.email
  ),
  loyalty_points AS (
    SELECT
      a.id AS account_id,
      a.email_key,
      COALESCE(SUM(le.delta_points) FILTER (WHERE le.source_type <> 'REWARD_REDEEM'), 0)::bigint AS lifetime_points
    FROM loyalty_accounts a
    LEFT JOIN loyalty_entries le ON le.loyalty_account_id = a.id
    WHERE a.organization_id = ${organizationId}::uuid
    GROUP BY a.id, a.email_key
  ),
  loyalty_rewards AS (
    SELECT a.id AS account_id, COUNT(rd.id)::bigint AS rewards_redeemed
    FROM loyalty_accounts a
    LEFT JOIN loyalty_redemptions rd ON rd.loyalty_account_id = a.id
    WHERE a.organization_id = ${organizationId}::uuid
    GROUP BY a.id
  ),
  loyalty AS (
    SELECT
      a.email_key,
      COALESCE(lp.lifetime_points, 0)::bigint AS lifetime_points,
      COALESCE(lr.rewards_redeemed, 0)::bigint AS rewards_redeemed
    FROM loyalty_accounts a
    LEFT JOIN loyalty_points lp ON lp.account_id = a.id
    LEFT JOIN loyalty_rewards lr ON lr.account_id = a.id
    WHERE a.organization_id = ${organizationId}::uuid
  ),
  emails AS (
    SELECT email_key FROM ticket_finance
    UNION SELECT email_key FROM vip_finance
    UNION SELECT email_key FROM event_stats
    UNION SELECT email_key FROM loyalty
  ),
  customer_features AS (
    SELECT
      em.email_key,
      COALESCE(li.email, em.email_key) AS email,
      li.name,
      (
        COALESCE(tf.ticket_gross, 0) + COALESCE(vf.vip_gross, 0)
        - COALESCE(tf.ticket_refunds, 0) - COALESCE(vf.vip_refunds, 0)
      )::bigint AS ltv_cents,
      COALESCE(tf.ticket_gross, 0)::bigint AS ticket_gross_cents,
      COALESCE(vf.vip_gross, 0)::bigint AS vip_gross_cents,
      (COALESCE(tf.ticket_net, 0) + COALESCE(vf.vip_net, 0))::bigint AS net_contribution_cents,
      COALESCE(tf.promoter_gross, 0)::bigint AS promoter_gross_cents,
      COALESCE(es.events_count, 0)::bigint AS events_count,
      COALESCE(es.purchase_count, 0)::bigint AS purchase_count,
      es.last_purchase_at,
      es.next_event_at,
      COALESCE(at.tickets_count, 0)::bigint AS tickets_count,
      COALESCE(at.checked_in_tickets, 0)::bigint AS checked_in_tickets,
      COALESCE(lo.lifetime_points, 0)::bigint AS lifetime_points,
      COALESCE(lo.rewards_redeemed, 0)::bigint AS rewards_redeemed,
      pv.promoter_name AS primary_promoter_name
    FROM emails em
    LEFT JOIN ticket_finance tf ON tf.email_key = em.email_key
    LEFT JOIN vip_finance vf ON vf.email_key = em.email_key
    LEFT JOIN event_stats es ON es.email_key = em.email_key
    LEFT JOIN latest_identity li ON li.email_key = em.email_key
    LEFT JOIN attendance at ON at.email_key = em.email_key
    LEFT JOIN loyalty lo ON lo.email_key = em.email_key
    LEFT JOIN promoter_value pv ON pv.email_key = em.email_key AND pv.pos = 1
  ),
  thresholds AS (
    SELECT
      COALESCE(
        PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY ltv_cents) FILTER (WHERE ltv_cents > 0),
        0
      )::bigint AS high_value_ltv_cents
    FROM customer_features
  ),
  segmented AS (
    SELECT
      cf.*,
      t.high_value_ltv_cents,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN cf.ltv_cents > 0 AND cf.ltv_cents >= t.high_value_ltv_cents
                  AND cf.events_count >= 3
                  AND cf.last_purchase_at >= NOW() - INTERVAL '30 days'
             THEN 'CHAMPION' END,
        CASE WHEN cf.ltv_cents > 0 AND cf.ltv_cents >= t.high_value_ltv_cents
             THEN 'HIGH_VALUE' END,
        CASE WHEN cf.purchase_count = 1
                  AND cf.ltv_cents > 0 AND cf.ltv_cents >= t.high_value_ltv_cents
                  AND cf.last_purchase_at >= NOW() - INTERVAL '60 days'
             THEN 'NEW_HIGH_VALUE' END,
        CASE WHEN cf.events_count >= 3
                  AND cf.last_purchase_at >= NOW() - INTERVAL '60 days'
             THEN 'LOYAL' END,
        CASE WHEN cf.events_count >= 2
                  AND cf.last_purchase_at < NOW() - INTERVAL '30 days'
                  AND cf.next_event_at IS NULL
             THEN 'AT_RISK' END,
        CASE WHEN cf.ltv_cents > 0 AND cf.ltv_cents >= t.high_value_ltv_cents
                  AND cf.last_purchase_at < NOW() - INTERVAL '60 days'
                  AND cf.next_event_at IS NULL
             THEN 'LOST_HIGH_VALUE' END,
        CASE WHEN cf.vip_gross_cents > 0 THEN 'VIP_BUYER' END,
        CASE WHEN cf.ticket_gross_cents > 0
                  AND cf.promoter_gross_cents * 100 >= cf.ticket_gross_cents * 50
             THEN 'PROMOTER_DRIVEN' END,
        CASE WHEN cf.lifetime_points > 0 OR cf.rewards_redeemed > 0
             THEN 'LOYALTY_ENGAGED' END
      ], NULL)::text[] AS segments
    FROM customer_features cf
    CROSS JOIN thresholds t
  )
`;

@Injectable()
export class CustomerSegmentsService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async list(
    organizationId: string,
    actorUserId: string,
    options: { segment?: string; q?: string; page?: number; pageSize?: number },
  ) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);

    const segment = (options.segment || "ALL").toUpperCase() as CustomerFinancialSegment;
    if (!CUSTOMER_FINANCIAL_SEGMENTS.includes(segment)) {
      throw new BadRequestException("Segmento financeiro inválido");
    }

    const page = safePage(options.page);
    const pageSize = safePageSize(options.pageSize);
    const offset = (page - 1) * pageSize;
    const q = options.q?.trim().toLowerCase() || "";
    const ledgerAccount = await prisma.ledgerAccount.findUnique({
      where: { organizationId },
      select: { id: true },
    });
    const base = segmentBase(organizationId, ledgerAccount?.id ?? null);

    const filters: Prisma.Sql[] = [];
    if (q) {
      filters.push(Prisma.sql`(LOWER(email) LIKE ${`%${q}%`} OR LOWER(COALESCE(name, '')) LIKE ${`%${q}%`})`);
    }
    if (segment !== "ALL") {
      filters.push(Prisma.sql`${segment} = ANY(segments)`);
    }
    const where = filters.length
      ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
      : Prisma.empty;

    const [thresholdRows, statRows, customerRows, countRows] = await Promise.all([
      prisma.$queryRaw<Array<{ highValueLtvCents: bigint }>>(Prisma.sql`
        ${base}
        SELECT high_value_ltv_cents AS "highValueLtvCents" FROM thresholds
      `),
      prisma.$queryRaw<SegmentStatsRow[]>(Prisma.sql`
        ${base}
        SELECT
          u.segment::text AS segment,
          COUNT(*)::bigint AS customers,
          COALESCE(SUM(s.ltv_cents), 0)::bigint AS "totalLtvCents",
          COALESCE(AVG(s.ltv_cents), 0)::bigint AS "avgLtvCents"
        FROM segmented s
        CROSS JOIN LATERAL UNNEST(s.segments) AS u(segment)
        GROUP BY u.segment
      `),
      prisma.$queryRaw<CustomerSegmentRow[]>(Prisma.sql`
        ${base}
        SELECT
          email,
          name,
          ltv_cents AS "ltvCents",
          ticket_gross_cents AS "ticketGrossCents",
          vip_gross_cents AS "vipGrossCents",
          net_contribution_cents AS "netContributionCents",
          promoter_gross_cents AS "promoterGrossCents",
          events_count AS "eventsCount",
          purchase_count AS "purchaseCount",
          last_purchase_at AS "lastPurchaseAt",
          next_event_at AS "nextEventAt",
          tickets_count AS "ticketsCount",
          checked_in_tickets AS "checkedInTickets",
          lifetime_points AS "lifetimePoints",
          rewards_redeemed AS "rewardsRedeemed",
          primary_promoter_name AS "primaryPromoterName",
          segments
        FROM segmented
        ${where}
        ORDER BY ltv_cents DESC, last_purchase_at DESC NULLS LAST, email ASC
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
      prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        ${base}
        SELECT COUNT(*)::bigint AS total FROM segmented ${where}
      `),
    ]);

    const stats = new Map(statRows.map((row) => [row.segment, row]));
    const segmentSummaries = (CUSTOMER_FINANCIAL_SEGMENTS.filter((key) => key !== "ALL") as Array<Exclude<CustomerFinancialSegment, "ALL">>)
      .map((key) => {
        const row = stats.get(key);
        return {
          key,
          label: SEGMENT_DEFINITIONS[key].label,
          description: SEGMENT_DEFINITIONS[key].description,
          customers: Number(row?.customers ?? 0n),
          totalLtvCents: Number(row?.totalLtvCents ?? 0n),
          avgLtvCents: Number(row?.avgLtvCents ?? 0n),
        };
      });

    return {
      page,
      pageSize,
      total: Number(countRows[0]?.total ?? 0n),
      selectedSegment: segment,
      thresholds: {
        highValueLtvCents: Number(thresholdRows[0]?.highValueLtvCents ?? 0n),
        highValuePercentile: 80,
      },
      segments: segmentSummaries,
      customers: customerRows.map((row) => {
        const ticketGrossCents = Number(row.ticketGrossCents ?? 0n);
        const promoterGrossCents = Number(row.promoterGrossCents ?? 0n);
        const ticketsCount = Number(row.ticketsCount ?? 0n);
        const checkedInTickets = Number(row.checkedInTickets ?? 0n);
        const daysSinceLastPurchase = row.lastPurchaseAt
          ? Math.max(0, Math.floor((Date.now() - row.lastPurchaseAt.getTime()) / 86_400_000))
          : null;
        return {
          email: row.email,
          name: row.name,
          ltvCents: Number(row.ltvCents ?? 0n),
          ticketGrossCents,
          vipGrossCents: Number(row.vipGrossCents ?? 0n),
          netContributionCents: Number(row.netContributionCents ?? 0n),
          promoterGrossCents,
          promoterSharePct: ticketGrossCents > 0
            ? Math.round((promoterGrossCents / ticketGrossCents) * 10_000) / 100
            : 0,
          primaryPromoterName: row.primaryPromoterName,
          eventsCount: Number(row.eventsCount ?? 0n),
          purchaseCount: Number(row.purchaseCount ?? 0n),
          lastPurchaseAt: row.lastPurchaseAt,
          daysSinceLastPurchase,
          nextEventAt: row.nextEventAt,
          attendanceRatePct: ticketsCount > 0
            ? Math.round((checkedInTickets / ticketsCount) * 10_000) / 100
            : 0,
          lifetimePoints: Number(row.lifetimePoints ?? 0n),
          rewardsRedeemed: Number(row.rewardsRedeemed ?? 0n),
          segments: row.segments,
        };
      }),
    };
  }
}
