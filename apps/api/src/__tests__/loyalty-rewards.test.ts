import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { IdempotencyService } from "../common/idempotency.service";
import { OrgAccessService } from "../common/org-access.service";
import { LoyaltyRewardsService } from "../loyalty/loyalty-rewards.service";
import { LoyaltyService } from "../loyalty/loyalty.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";
const createdUsers: string[] = [];
const access = new OrgAccessService();
const loyalty = new LoyaltyService(access);
const rewards = new LoyaltyRewardsService(access, new IdempotencyService());

async function customer(email: string, points: number) {
  const user = await prisma.user.create({ data: { email } });
  createdUsers.push(user.id);
  const accountId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO loyalty_accounts (id, organization_id, user_id, email_key, display_name, created_at, updated_at)
    VALUES (${accountId}::uuid, ${fixture.organization.id}::uuid, ${user.id}::uuid, ${email}, 'Cliente teste', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await prisma.$executeRaw`
    INSERT INTO loyalty_entries (id, loyalty_account_id, organization_id, delta_points, source_type, source_id, description, created_at)
    VALUES (${randomUUID()}::uuid, ${accountId}::uuid, ${fixture.organization.id}::uuid, ${points}, 'ADJUSTMENT', ${randomUUID()}::uuid, 'Saldo teste', CURRENT_TIMESTAMP)
  `;
  return { userId: user.id, accountId };
}

function fulfilled<T>(results: PromiseSettledResult<T>[]) {
  return results.filter((item): item is PromiseFulfilledResult<T> => item.status === "fulfilled");
}

describe("N9.1 — recompensas de fidelidade", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 50, priceCents: 5000, feeCents: 0 });
    const owner = await prisma.user.create({ data: { email: `loyalty-rewards-owner-${Date.now()}@example.com` } });
    ownerId = owner.id;
    createdUsers.push(owner.id);
    await prisma.organizationMember.create({ data: { organizationId: fixture.organization.id, userId: owner.id, roleId: fixture.ownerRoleId, status: "ACTIVE" } });
    await loyalty.updateProgram(fixture.organization.id, ownerId, { enabled: true, pointsPerReal: 1, silverPoints: 200, goldPoints: 500, platinumPoints: 1000 });
  });

  after(async () => {
    await cleanupFixtureEvent(fixture.organization.id);
    for (const id of createdUsers) await prisma.user.delete({ where: { id } }).catch(() => undefined);
  });

  it("confirma apenas um resgate quando duas pessoas disputam a última unidade", async () => {
    const a = await customer(`loyalty-a-${Date.now()}@example.com`, 1000);
    const b = await customer(`loyalty-b-${Date.now()}@example.com`, 1000);
    const reward = await rewards.createReward(fixture.organization.id, ownerId, { name: "Último drink", pointsCost: 500, quantity: 1, maxPerCustomer: 1 });

    const result = await Promise.allSettled([
      rewards.redeem(a.userId, fixture.organization.id, reward.id),
      rewards.redeem(b.userId, fixture.organization.id, reward.id),
    ]);
    assert.equal(fulfilled(result).length, 1);

    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM loyalty_redemptions WHERE reward_id = ${reward.id}::uuid
    `;
    assert.equal(Number(rows[0]?.count ?? 0n), 1);
  });

  it("não deixa o mesmo saldo ser gasto duas vezes em recompensas diferentes", async () => {
    const person = await customer(`loyalty-balance-${Date.now()}@example.com`, 1000);
    const first = await rewards.createReward(fixture.organization.id, ownerId, { name: "Benefício A", pointsCost: 800, quantity: 10, maxPerCustomer: 2 });
    const second = await rewards.createReward(fixture.organization.id, ownerId, { name: "Benefício B", pointsCost: 800, quantity: 10, maxPerCustomer: 2 });

    const result = await Promise.allSettled([
      rewards.redeem(person.userId, fixture.organization.id, first.id),
      rewards.redeem(person.userId, fixture.organization.id, second.id),
    ]);
    assert.equal(fulfilled(result).length, 1);

    const balance = await prisma.$queryRaw<Array<{ points: bigint }>>`
      SELECT COALESCE(SUM(delta_points), 0)::bigint AS points FROM loyalty_entries WHERE loyalty_account_id = ${person.accountId}::uuid
    `;
    assert.equal(Number(balance[0]?.points ?? 0n), 200);
  });

  it("usar o mesmo voucher novamente é idempotente", async () => {
    const person = await customer(`loyalty-voucher-${Date.now()}@example.com`, 1000);
    const reward = await rewards.createReward(fixture.organization.id, ownerId, { name: "Água", pointsCost: 100, quantity: 10, maxPerCustomer: 2 });
    const redemption = await rewards.redeem(person.userId, fixture.organization.id, reward.id);
    const first = await rewards.consumeCode(fixture.organization.id, ownerId, redemption.code);
    const second = await rewards.consumeCode(fixture.organization.id, ownerId, redemption.code);
    assert.equal(first.status, "USED");
    assert.equal(second.status, "USED");
    assert.equal(second.usedAt?.getTime(), first.usedAt?.getTime());
  });
});
