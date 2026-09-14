import { Injectable } from "@nestjs/common";
import { PERMISSIONS } from "@borafest/auth";
import { Prisma, prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";

type CustomerRow = {
  emailKey: string;
  email: string;
  name: string | null;
  phone: string | null;
  userId: string | null;
  ltvCents: bigint;
  ticketGrossCents: bigint;
  vipGrossCents: bigint;
  refundCents: bigint;
  netContributionCents: bigint;
  promoterGrossCents: bigint;
  eventsCount: bigint;
  purchaseCount: bigint;
  lastPurchaseAt: Date | null;
  lastEventAt: Date | null;
  nextEventAt: Date | null;
  ticketsCount: bigint;
  checkedInTickets: bigint;
  vipPurchases: bigint;
  loyaltyPoints: bigint;
  lifetimePoints: bigint;
  rewardsRedeemed: bigint;
  loyaltyEnabled: boolean | null;
  silverPoints: number | null;
  goldPoints: number | null;
  platinumPoints: number | null;
  primaryPromoterName: string | null;
};

type SummaryRow = {
  totalCustomers: bigint;
  totalLtvCents: bigint;
  vipCustomers: bigint;
  loyaltyMembers: bigint;
  promoterCustomers: bigint;
};

function safePage(value?: number) {
  return Math.max(1, Math.floor(value || 1));
}

function safePageSize(value?: number) {
  return Math.min(100, Math.max(1, Math.floor(value || 30)));
}

function level(row: CustomerRow) {
  if (!row.loyaltyEnabled) return null;
  const lifetime = Number(row.lifetimePoints ?? 0n);
  if (row.platinumPoints !== null && lifetime >= row.platinumPoints) return "PLATINUM" as const;
  if (row.goldPoints !== null && lifetime >= row.goldPoints) return "GOLD" as const;
  if (row.silverPoints !== null && lifetime >= row.silverPoints) return "SILVER" as const;
  return "BRONZE" as const;
}

const customerBase = (organizationId: string, ledgerAccountId: string | null) => Prisma.sql`
  WITH ledger AS MATERIALIZED (
    SELECT
      reference_type,
      reference_id::uuid AS ref,
      type::text AS type,
      amount_cents,
      created_at
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
      COALESCE(SUM(amount_cents), 0)::bigint AS vip_net,
      COUNT(DISTINCT payment_id) FILTER (WHERE type = 'SALE_CREDIT')::bigint AS vip_purchases
    FROM vip_entries
    GROUP BY email_key
  ),
  purchase_events AS (
    SELECT
      email_key,
      event_id,
      ('T:' || order_id::text) AS purchase_key,
      purchase_at AS created_at
    FROM ticket_order_finance
    WHERE sale_gross > 0
    UNION ALL
    SELECT
      email_key,
      event_id,
      ('V:' || payment_id::text) AS purchase_key,
      created_at
    FROM vip_entries
    WHERE type = 'SALE_CREDIT'
  ),
  event_stats AS (
    SELECT
      pe.email_key,
      COUNT(DISTINCT pe.event_id)::bigint AS events_count,
      COUNT(DISTINCT pe.purchase_key)::bigint AS purchase_count,
      MAX(pe.created_at) AS last_purchase_at,
      MAX(e.starts_at) FILTER (WHERE e.starts_at <= NOW()) AS last_event_at,
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
      o.contact_phone AS phone,
      o.user_id,
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
      vr.contact_phone AS phone,
      NULL::uuid AS user_id,
      vr.created_at AS occurred_at
    FROM vip_reservations vr
    JOIN vip_inventory vi ON vi.id = vr.vip_inventory_id
    JOIN events e ON e.id = vi.event_id
    WHERE e.organization_id = ${organizationId}::uuid
      AND vr.status = 'CONFIRMED'
      AND LENGTH(TRIM(vr.contact_email)) > 0
  ),
  latest_identity AS (
    SELECT DISTINCT ON (email_key)
      email_key, email, name, phone, user_id
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
      COALESCE(SUM(le.delta_points), 0)::bigint AS loyalty_points,
      COALESCE(SUM(le.delta_points) FILTER (WHERE le.source_type <> 'REWARD_REDEEM'), 0)::bigint AS lifetime_points
    FROM loyalty_accounts a
    LEFT JOIN loyalty_entries le ON le.loyalty_account_id = a.id
    WHERE a.organization_id = ${organizationId}::uuid
    GROUP BY a.id, a.email_key
  ),
  loyalty_rewards AS (
    SELECT
      a.id AS account_id,
      COUNT(rd.id)::bigint AS rewards_redeemed
    FROM loyalty_accounts a
    LEFT JOIN loyalty_redemptions rd ON rd.loyalty_account_id = a.id
    WHERE a.organization_id = ${organizationId}::uuid
    GROUP BY a.id
  ),
  loyalty AS (
    SELECT
      a.email_key,
      p.enabled AS loyalty_enabled,
      p.silver_points,
      p.gold_points,
      p.platinum_points,
      COALESCE(lp.loyalty_points, 0)::bigint AS loyalty_points,
      COALESCE(lp.lifetime_points, 0)::bigint AS lifetime_points,
      COALESCE(lr.rewards_redeemed, 0)::bigint AS rewards_redeemed
    FROM loyalty_accounts a
    JOIN loyalty_programs p ON p.organization_id = a.organization_id
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
  customer_rows AS (
    SELECT
      em.email_key,
      COALESCE(li.email, em.email_key) AS email,
      li.name,
      li.phone,
      li.user_id,
      (
        COALESCE(tf.ticket_gross, 0) + COALESCE(vf.vip_gross, 0)
        - COALESCE(tf.ticket_refunds, 0) - COALESCE(vf.vip_refunds, 0)
      )::bigint AS ltv_cents,
      COALESCE(tf.ticket_gross, 0)::bigint AS ticket_gross_cents,
      COALESCE(vf.vip_gross, 0)::bigint AS vip_gross_cents,
      (COALESCE(tf.ticket_refunds, 0) + COALESCE(vf.vip_refunds, 0))::bigint AS refund_cents,
      (COALESCE(tf.ticket_net, 0) + COALESCE(vf.vip_net, 0))::bigint AS net_contribution_cents,
      COALESCE(tf.promoter_gross, 0)::bigint AS promoter_gross_cents,
      COALESCE(es.events_count, 0)::bigint AS events_count,
      COALESCE(es.purchase_count, 0)::bigint AS purchase_count,
      es.last_purchase_at,
      es.last_event_at,
      es.next_event_at,
      COALESCE(at.tickets_count, 0)::bigint AS tickets_count,
      COALESCE(at.checked_in_tickets, 0)::bigint AS checked_in_tickets,
      COALESCE(vf.vip_purchases, 0)::bigint AS vip_purchases,
      COALESCE(lo.loyalty_points, 0)::bigint AS loyalty_points,
      COALESCE(lo.lifetime_points, 0)::bigint AS lifetime_points,
      COALESCE(lo.rewards_redeemed, 0)::bigint AS rewards_redeemed,
      lo.loyalty_enabled,
      lo.silver_points,
      lo.gold_points,
      lo.platinum_points,
      pv.promoter_name AS primary_promoter_name
    FROM emails em
    LEFT JOIN ticket_finance tf ON tf.email_key = em.email_key
    LEFT JOIN vip_finance vf ON vf.email_key = em.email_key
    LEFT JOIN event_stats es ON es.email_key = em.email_key
    LEFT JOIN latest_identity li ON li.email_key = em.email_key
    LEFT JOIN attendance at ON at.email_key = em.email_key
    LEFT JOIN loyalty lo ON lo.email_key = em.email_key
    LEFT JOIN promoter_value pv ON pv.email_key = em.email_key AND pv.pos = 1
  )
`;

@Injectable()
export class CustomerIntelligenceService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async list(
    organizationId: string,
    actorUserId: string,
    options: { q?: string; page?: number; pageSize?: number },
  ) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);

    const page = safePage(options.page);
    const pageSize = safePageSize(options.pageSize);
    const offset = (page - 1) * pageSize;
    const q = options.q?.trim().toLowerCase() || "";
    const ledgerAccount = await prisma.ledgerAccount.findUnique({
      where: { organizationId },
      select: { id: true },
    });
    const base = customerBase(organizationId, ledgerAccount?.id ?? null);
    const search = q
      ? Prisma.sql`WHERE LOWER(email) LIKE ${`%${q}%`} OR LOWER(COALESCE(name, '')) LIKE ${`%${q}%`}`
      : Prisma.empty;

    const [summaryRows, rows, countRows] = await Promise.all([
      prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
        ${base}
        SELECT
          COUNT(*)::bigint AS "totalCustomers",
          COALESCE(SUM(ltv_cents), 0)::bigint AS "totalLtvCents",
          COUNT(*) FILTER (WHERE vip_gross_cents > 0)::bigint AS "vipCustomers",
          COUNT(*) FILTER (WHERE loyalty_enabled IS NOT NULL)::bigint AS "loyaltyMembers",
          COUNT(*) FILTER (WHERE promoter_gross_cents > 0)::bigint AS "promoterCustomers"
        FROM customer_rows
      `),
      prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
        ${base}
        SELECT
          email_key AS "emailKey",
          email,
          name,
          phone,
          user_id AS "userId",
          ltv_cents AS "ltvCents",
          ticket_gross_cents AS "ticketGrossCents",
          vip_gross_cents AS "vipGrossCents",
          refund_cents AS "refundCents",
          net_contribution_cents AS "netContributionCents",
          promoter_gross_cents AS "promoterGrossCents",
          events_count AS "eventsCount",
          purchase_count AS "purchaseCount",
          last_purchase_at AS "lastPurchaseAt",
          last_event_at AS "lastEventAt",
          next_event_at AS "nextEventAt",
          tickets_count AS "ticketsCount",
          checked_in_tickets AS "checkedInTickets",
          vip_purchases AS "vipPurchases",
          loyalty_points AS "loyaltyPoints",
          lifetime_points AS "lifetimePoints",
          rewards_redeemed AS "rewardsRedeemed",
          loyalty_enabled AS "loyaltyEnabled",
          silver_points AS "silverPoints",
          gold_points AS "goldPoints",
          platinum_points AS "platinumPoints",
          primary_promoter_name AS "primaryPromoterName"
        FROM customer_rows
        ${search}
        ORDER BY ltv_cents DESC, last_purchase_at DESC NULLS LAST, email_key ASC
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
      prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        ${base}
        SELECT COUNT(*)::bigint AS total FROM customer_rows ${search}
      `),
    ]);

    const summary = summaryRows[0];
    const totalCustomers = Number(summary?.totalCustomers ?? 0n);
    const totalLtvCents = Number(summary?.totalLtvCents ?? 0n);

    return {
      page,
      pageSize,
      total: Number(countRows[0]?.total ?? 0n),
      summary: {
        totalCustomers,
        totalLtvCents,
        avgLtvCents: totalCustomers > 0 ? Math.round(totalLtvCents / totalCustomers) : 0,
        vipCustomers: Number(summary?.vipCustomers ?? 0n),
        loyaltyMembers: Number(summary?.loyaltyMembers ?? 0n),
        promoterCustomers: Number(summary?.promoterCustomers ?? 0n),
      },
      customers: rows.map((row) => {
        const ltvCents = Number(row.ltvCents ?? 0n);
        const ticketGrossCents = Number(row.ticketGrossCents ?? 0n);
        const purchaseCount = Number(row.purchaseCount ?? 0n);
        const promoterGrossCents = Number(row.promoterGrossCents ?? 0n);
        const daysSinceLastPurchase = row.lastPurchaseAt
          ? Math.max(0, Math.floor((Date.now() - row.lastPurchaseAt.getTime()) / 86_400_000))
          : null;
        return {
          email: row.email,
          name: row.name,
          phone: row.phone,
          userId: row.userId,
          ltvCents,
          ticketGrossCents,
          vipGrossCents: Number(row.vipGrossCents ?? 0n),
          refundCents: Number(row.refundCents ?? 0n),
          netContributionCents: Number(row.netContributionCents ?? 0n),
          avgPurchaseCents: purchaseCount > 0 ? Math.round(ltvCents / purchaseCount) : 0,
          promoterGrossCents,
          promoterSharePct: ticketGrossCents > 0 ? Math.round((promoterGrossCents / ticketGrossCents) * 10_000) / 100 : 0,
          primaryPromoterName: row.primaryPromoterName,
          eventsCount: Number(row.eventsCount ?? 0n),
          purchaseCount,
          lastPurchaseAt: row.lastPurchaseAt,
          daysSinceLastPurchase,
          lastEventAt: row.lastEventAt,
          nextEventAt: row.nextEventAt,
          ticketsCount: Number(row.ticketsCount ?? 0n),
          checkedInTickets: Number(row.checkedInTickets ?? 0n),
          vipPurchases: Number(row.vipPurchases ?? 0n),
          loyalty: {
            enabled: Boolean(row.loyaltyEnabled),
            points: Number(row.loyaltyPoints ?? 0n),
            lifetimePoints: Number(row.lifetimePoints ?? 0n),
            level: level(row),
            rewardsRedeemed: Number(row.rewardsRedeemed ?? 0n),
          },
        };
      }),
    };
  }
}
