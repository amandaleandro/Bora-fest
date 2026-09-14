import { Injectable } from "@nestjs/common";
import { PERMISSIONS } from "@borafest/auth";
import { Prisma, prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";

type SummaryRow = {
  ticketGrossCents: bigint;
  vipGrossCents: bigint;
  promoterGrossCents: bigint;
  directTicketGrossCents: bigint;
  refundCents: bigint;
  platformFeeCents: bigint;
  commissionCents: bigint;
  netCents: bigint;
};

type TrendRow = {
  month: Date;
  ticketGrossCents: bigint;
  vipGrossCents: bigint;
  refundCents: bigint;
  netCents: bigint;
};

type EventRow = {
  eventId: string;
  title: string;
  startsAt: Date;
  ticketGrossCents: bigint;
  vipGrossCents: bigint;
  promoterGrossCents: bigint;
  refundCents: bigint;
  platformFeeCents: bigint;
  commissionCents: bigint;
  netCents: bigint;
};

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 10_000) / 100;
}

const mappedLedger = (ledgerAccountId: string, organizationId: string) => Prisma.sql`
  WITH entradas AS MATERIALIZED (
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
      en.type,
      en.amount_cents,
      en.created_at,
      COALESCE(o.event_id, po.event_id) AS event_id,
      COALESCE(o.promoter_link_id, po.promoter_link_id) AS promoter_link_id,
      'TICKET'::text AS channel
    FROM entradas en
    LEFT JOIN orders o
      ON en.reference_type = 'order' AND o.id = en.ref
    LEFT JOIN payments p
      ON en.reference_type = 'payment' AND p.id = en.ref
    LEFT JOIN orders po
      ON p.order_id = po.id
    WHERE en.reference_type IN ('order', 'payment')
  ),
  vip_entries AS (
    SELECT
      en.type,
      en.amount_cents,
      en.created_at,
      vi.event_id,
      NULL::uuid AS promoter_link_id,
      'VIP'::text AS channel
    FROM entradas en
    JOIN vip_payments vp
      ON en.reference_type = 'vip_payment' AND vp.id = en.ref
    JOIN vip_reservations vr ON vr.id = vp.vip_reservation_id
    JOIN vip_inventory vi ON vi.id = vr.vip_inventory_id
    WHERE en.reference_type = 'vip_payment'
  ),
  mapped AS (
    SELECT * FROM ticket_entries
    UNION ALL
    SELECT * FROM vip_entries
  ),
  scoped AS (
    SELECT m.*
    FROM mapped m
    JOIN events e ON e.id = m.event_id
    WHERE e.organization_id = ${organizationId}::uuid
  )
`;

@Injectable()
export class RevenueIntelligenceService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async get(organizationId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);

    const ledgerAccount = await prisma.ledgerAccount.findUnique({
      where: { organizationId },
      select: { id: true },
    });

    if (!ledgerAccount) {
      return {
        summary: {
          grossCents: 0,
          ticketGrossCents: 0,
          vipGrossCents: 0,
          vipRevenueSharePct: 0,
          promoterGrossCents: 0,
          promoterRevenueSharePct: 0,
          directTicketGrossCents: 0,
          refundCents: 0,
          platformFeeCents: 0,
          commissionCents: 0,
          netCents: 0,
        },
        trend: [],
        events: [],
      };
    }

    const base = mappedLedger(ledgerAccount.id, organizationId);
    const [summaryRows, trendRows, eventRows] = await Promise.all([
      prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
        ${base}
        SELECT
          COALESCE(SUM(amount_cents) FILTER (WHERE type = 'SALE_CREDIT' AND channel = 'TICKET'), 0)::bigint AS "ticketGrossCents",
          COALESCE(SUM(amount_cents) FILTER (WHERE type = 'SALE_CREDIT' AND channel = 'VIP'), 0)::bigint AS "vipGrossCents",
          COALESCE(SUM(amount_cents) FILTER (
            WHERE type = 'SALE_CREDIT' AND channel = 'TICKET' AND promoter_link_id IS NOT NULL
          ), 0)::bigint AS "promoterGrossCents",
          COALESCE(SUM(amount_cents) FILTER (
            WHERE type = 'SALE_CREDIT' AND channel = 'TICKET' AND promoter_link_id IS NULL
          ), 0)::bigint AS "directTicketGrossCents",
          GREATEST(-COALESCE(SUM(amount_cents) FILTER (WHERE type = 'REFUND_DEBIT'), 0), 0)::bigint AS "refundCents",
          GREATEST(-COALESCE(SUM(amount_cents) FILTER (WHERE type = 'PLATFORM_FEE'), 0), 0)::bigint AS "platformFeeCents",
          GREATEST(-COALESCE(SUM(amount_cents) FILTER (WHERE type = 'COMMISSION_DEBIT'), 0), 0)::bigint AS "commissionCents",
          COALESCE(SUM(amount_cents), 0)::bigint AS "netCents"
        FROM scoped
      `),
      prisma.$queryRaw<TrendRow[]>(Prisma.sql`
        ${base}
        , months AS (
          SELECT generate_series(
            DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
            DATE_TRUNC('month', NOW()),
            INTERVAL '1 month'
          ) AS month
        ), monthly AS (
          SELECT
            DATE_TRUNC('month', created_at) AS month,
            COALESCE(SUM(amount_cents) FILTER (WHERE type = 'SALE_CREDIT' AND channel = 'TICKET'), 0)::bigint AS ticket_gross,
            COALESCE(SUM(amount_cents) FILTER (WHERE type = 'SALE_CREDIT' AND channel = 'VIP'), 0)::bigint AS vip_gross,
            GREATEST(-COALESCE(SUM(amount_cents) FILTER (WHERE type = 'REFUND_DEBIT'), 0), 0)::bigint AS refunds,
            COALESCE(SUM(amount_cents), 0)::bigint AS net
          FROM scoped
          WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
          GROUP BY DATE_TRUNC('month', created_at)
        )
        SELECT
          m.month,
          COALESCE(x.ticket_gross, 0)::bigint AS "ticketGrossCents",
          COALESCE(x.vip_gross, 0)::bigint AS "vipGrossCents",
          COALESCE(x.refunds, 0)::bigint AS "refundCents",
          COALESCE(x.net, 0)::bigint AS "netCents"
        FROM months m
        LEFT JOIN monthly x ON x.month = m.month
        ORDER BY m.month ASC
      `),
      prisma.$queryRaw<EventRow[]>(Prisma.sql`
        ${base}
        SELECT
          e.id AS "eventId",
          e.title,
          e.starts_at AS "startsAt",
          COALESCE(SUM(s.amount_cents) FILTER (WHERE s.type = 'SALE_CREDIT' AND s.channel = 'TICKET'), 0)::bigint AS "ticketGrossCents",
          COALESCE(SUM(s.amount_cents) FILTER (WHERE s.type = 'SALE_CREDIT' AND s.channel = 'VIP'), 0)::bigint AS "vipGrossCents",
          COALESCE(SUM(s.amount_cents) FILTER (
            WHERE s.type = 'SALE_CREDIT' AND s.channel = 'TICKET' AND s.promoter_link_id IS NOT NULL
          ), 0)::bigint AS "promoterGrossCents",
          GREATEST(-COALESCE(SUM(s.amount_cents) FILTER (WHERE s.type = 'REFUND_DEBIT'), 0), 0)::bigint AS "refundCents",
          GREATEST(-COALESCE(SUM(s.amount_cents) FILTER (WHERE s.type = 'PLATFORM_FEE'), 0), 0)::bigint AS "platformFeeCents",
          GREATEST(-COALESCE(SUM(s.amount_cents) FILTER (WHERE s.type = 'COMMISSION_DEBIT'), 0), 0)::bigint AS "commissionCents",
          COALESCE(SUM(s.amount_cents), 0)::bigint AS "netCents"
        FROM scoped s
        JOIN events e ON e.id = s.event_id
        GROUP BY e.id
        ORDER BY e.starts_at DESC
        LIMIT 20
      `),
    ]);

    const raw = summaryRows[0];
    const ticketGrossCents = Number(raw?.ticketGrossCents ?? 0n);
    const vipGrossCents = Number(raw?.vipGrossCents ?? 0n);
    const grossCents = ticketGrossCents + vipGrossCents;
    const promoterGrossCents = Number(raw?.promoterGrossCents ?? 0n);

    return {
      summary: {
        grossCents,
        ticketGrossCents,
        vipGrossCents,
        vipRevenueSharePct: pct(vipGrossCents, grossCents),
        promoterGrossCents,
        promoterRevenueSharePct: pct(promoterGrossCents, ticketGrossCents),
        directTicketGrossCents: Number(raw?.directTicketGrossCents ?? 0n),
        refundCents: Number(raw?.refundCents ?? 0n),
        platformFeeCents: Number(raw?.platformFeeCents ?? 0n),
        commissionCents: Number(raw?.commissionCents ?? 0n),
        netCents: Number(raw?.netCents ?? 0n),
      },
      trend: trendRows.map((row) => ({
        month: row.month,
        ticketGrossCents: Number(row.ticketGrossCents),
        vipGrossCents: Number(row.vipGrossCents),
        refundCents: Number(row.refundCents),
        netCents: Number(row.netCents),
      })),
      events: eventRows.map((row) => {
        const ticketGross = Number(row.ticketGrossCents);
        const vipGross = Number(row.vipGrossCents);
        const gross = ticketGross + vipGross;
        const promoterGross = Number(row.promoterGrossCents);
        return {
          eventId: row.eventId,
          title: row.title,
          startsAt: row.startsAt,
          grossCents: gross,
          ticketGrossCents: ticketGross,
          vipGrossCents: vipGross,
          vipRevenueSharePct: pct(vipGross, gross),
          promoterGrossCents: promoterGross,
          promoterRevenueSharePct: pct(promoterGross, ticketGross),
          refundCents: Number(row.refundCents),
          platformFeeCents: Number(row.platformFeeCents),
          commissionCents: Number(row.commissionCents),
          netCents: Number(row.netCents),
        };
      }),
    };
  }
}
