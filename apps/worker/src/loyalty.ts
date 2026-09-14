import { randomUUID } from "node:crypto";
import { prisma } from "@borafest/database";

async function orderContext(orderId: string) {
  const rows = await prisma.$queryRaw<Array<{
    organizationId: string; userId: string | null; email: string; name: string | null; totalCents: number; status: string;
  }>>`
    SELECT e.organization_id AS "organizationId", o.user_id AS "userId",
      o.contact_email AS email, o.contact_name AS name, o.total_cents AS "totalCents", o.status::text AS status
    FROM orders o JOIN events e ON e.id = o.event_id
    WHERE o.id = ${orderId}::uuid LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function awardLoyaltyForOrder(orderId: string) {
  const order = await orderContext(orderId);
  if (!order || !["PAID", "FULFILLED"].includes(order.status)) return;
  const email = order.email.trim().toLowerCase();
  if (!email) return;

  const programs = await prisma.$queryRaw<Array<{ enabled: boolean; pointsPerReal: number }>>`
    SELECT enabled, points_per_real AS "pointsPerReal"
    FROM loyalty_programs WHERE organization_id = ${order.organizationId}::uuid LIMIT 1
  `;
  const program = programs[0];
  if (!program?.enabled) return;
  const points = Math.floor(order.totalCents / 100) * program.pointsPerReal;
  if (points <= 0) return;

  await prisma.$transaction(async (tx) => {
    const accounts = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO loyalty_accounts (id, organization_id, email_key, user_id, display_name, created_at, updated_at)
      VALUES (${randomUUID()}::uuid, ${order.organizationId}::uuid, ${email}, ${order.userId}::uuid, ${order.name}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (organization_id, email_key) DO UPDATE SET
        user_id = COALESCE(loyalty_accounts.user_id, EXCLUDED.user_id),
        display_name = COALESCE(EXCLUDED.display_name, loyalty_accounts.display_name),
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `;
    await tx.$executeRaw`
      INSERT INTO loyalty_entries (id, loyalty_account_id, organization_id, delta_points, source_type, source_id, description, created_at)
      VALUES (${randomUUID()}::uuid, ${accounts[0]!.id}::uuid, ${order.organizationId}::uuid, ${points}, 'ORDER_EARN', ${orderId}::uuid, 'Pontos por compra paga', CURRENT_TIMESTAMP)
      ON CONFLICT (organization_id, source_type, source_id) DO NOTHING
    `;
  });
}

export async function reverseLoyaltyForOrder(orderId: string) {
  const order = await orderContext(orderId);
  if (!order) return;
  const credits = await prisma.$queryRaw<Array<{ accountId: string; points: number }>>`
    SELECT loyalty_account_id AS "accountId", delta_points AS points
    FROM loyalty_entries
    WHERE organization_id = ${order.organizationId}::uuid AND source_type = 'ORDER_EARN' AND source_id = ${orderId}::uuid
    LIMIT 1
  `;
  const credit = credits[0];
  if (!credit || credit.points <= 0) return;
  await prisma.$executeRaw`
    INSERT INTO loyalty_entries (id, loyalty_account_id, organization_id, delta_points, source_type, source_id, description, created_at)
    VALUES (${randomUUID()}::uuid, ${credit.accountId}::uuid, ${order.organizationId}::uuid, ${-credit.points}, 'ORDER_REVERSAL', ${orderId}::uuid, 'Reversão de pontos por estorno', CURRENT_TIMESTAMP)
    ON CONFLICT (organization_id, source_type, source_id) DO NOTHING
  `;
}
