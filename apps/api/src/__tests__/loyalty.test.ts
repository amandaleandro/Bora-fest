import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";
import { LoyaltyService } from "../loyalty/loyalty.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";
const loyalty = new LoyaltyService(new OrgAccessService());

describe("N9 — fidelidade da Casa", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 50, priceCents: 5000, feeCents: 0 });
    const owner = await prisma.user.create({ data: { email: `loyalty-owner-${Date.now()}@example.com` } });
    ownerId = owner.id;
    await prisma.organizationMember.create({
      data: {
        organizationId: fixture.organization.id,
        userId: owner.id,
        roleId: fixture.ownerRoleId,
        status: "ACTIVE",
      },
    });
  });

  after(async () => {
    await cleanupFixtureEvent(fixture.organization.id);
    if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
  });

  it("nasce pausado e permite configurar pontos e faixas", async () => {
    const initial = await loyalty.getProgram(fixture.organization.id, ownerId);
    assert.equal(initial.enabled, false);
    assert.equal(initial.pointsPerReal, 1);

    const updated = await loyalty.updateProgram(fixture.organization.id, ownerId, {
      enabled: true,
      pointsPerReal: 2,
      silverPoints: 200,
      goldPoints: 600,
      platinumPoints: 1000,
    });
    assert.equal(updated.enabled, true);
    assert.equal(updated.goldPoints, 600);
  });

  it("resgate reduz saldo sem rebaixar, mas compra estornada deixa de qualificar", async () => {
    const accountId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO loyalty_accounts (id, organization_id, email_key, display_name, created_at, updated_at)
      VALUES (${accountId}::uuid, ${fixture.organization.id}::uuid, 'cliente-n9@example.com', 'Cliente N9', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    await prisma.$executeRaw`
      INSERT INTO loyalty_entries (id, loyalty_account_id, organization_id, delta_points, source_type, source_id, description, created_at)
      VALUES
        (${randomUUID()}::uuid, ${accountId}::uuid, ${fixture.organization.id}::uuid, 1000, 'ADJUSTMENT', ${randomUUID()}::uuid, 'Carga de teste', CURRENT_TIMESTAMP),
        (${randomUUID()}::uuid, ${accountId}::uuid, ${fixture.organization.id}::uuid, -100, 'REWARD_REDEEM', ${randomUUID()}::uuid, 'Resgate de teste', CURRENT_TIMESTAMP),
        (${randomUUID()}::uuid, ${accountId}::uuid, ${fixture.organization.id}::uuid, -200, 'ORDER_REVERSAL', ${randomUUID()}::uuid, 'Compra estornada de teste', CURRENT_TIMESTAMP)
    `;

    const result = await loyalty.listAccounts(fixture.organization.id, ownerId, { q: "cliente-n9", page: 1, pageSize: 10 });
    assert.equal(result.total, 1);
    assert.equal(result.accounts[0]?.points, 700);
    assert.equal(result.accounts[0]?.lifetimePoints, 800);
    assert.equal(result.accounts[0]?.level, "GOLD");
    assert.equal(result.summary.gold, 1);
    assert.equal(result.summary.pointsOutstanding, 700);
  });
});
