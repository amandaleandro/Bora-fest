import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";
import { RevenueIntelligenceService } from "../revenue-intelligence/revenue-intelligence.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";
const service = new RevenueIntelligenceService(new OrgAccessService());

describe("N10 — proteção na receita unificada", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 10, priceCents: 5000, feeCents: 0 });
    const owner = await prisma.user.create({ data: { email: `n10-protection-${Date.now()}@example.com` } });
    ownerId = owner.id;
    await prisma.organizationMember.create({
      data: { organizationId: fixture.organization.id, userId: owner.id, roleId: fixture.ownerRoleId, status: "ACTIVE" },
    });
  });

  after(async () => {
    await cleanupFixtureEvent(fixture.organization.id);
    if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
  });

  it("conta o prêmio de proteção no bruto sem duplicar o líquido", async () => {
    const reservation = await prisma.reservation.create({
      data: { eventId: fixture.event.id, status: "CONVERTED", expiresAt: new Date(Date.now() + 60_000) },
    });
    const order = await prisma.order.create({
      data: {
        eventId: fixture.event.id,
        reservationId: reservation.id,
        contactEmail: "protection@example.com",
        status: "PAID",
        totalCents: 5150,
        protectionPurchased: true,
        protectionFeeCents: 150,
        paidAt: new Date(),
      },
    });
    const payment = await prisma.payment.create({
      data: { orderId: order.id, provider: "mock", method: "PIX", status: "PAID", amountCents: 5150, paidAt: new Date() },
    });
    const ledger = await prisma.ledgerAccount.create({ data: { organizationId: fixture.organization.id } });
    await prisma.ledgerEntry.createMany({
      data: [
        { ledgerAccountId: ledger.id, type: "SALE_CREDIT", amountCents: 5000, referenceType: "payment", referenceId: payment.id },
        { ledgerAccountId: ledger.id, type: "PROTECTION_CREDIT", amountCents: 150, referenceType: "payment", referenceId: payment.id },
        { ledgerAccountId: ledger.id, type: "PLATFORM_FEE", amountCents: -500, referenceType: "payment", referenceId: payment.id },
      ],
    });

    const result = await service.get(fixture.organization.id, ownerId);
    assert.equal(result.summary.ticketGrossCents, 5150);
    assert.equal(result.summary.grossCents, 5150);
    assert.equal(result.summary.netCents, 4650);
    assert.equal(result.events[0]?.ticketGrossCents, 5150);
    assert.equal(result.events[0]?.netCents, 4650);
  });
});
