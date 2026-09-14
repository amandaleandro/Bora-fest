import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";
import { CustomerIntelligenceService } from "../customer-intelligence/customer-intelligence.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";
const service = new CustomerIntelligenceService(new OrgAccessService());

describe("N10.2 — LTV após reembolso protegido", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 10, priceCents: 5000, feeCents: 500 });
    const owner = await prisma.user.create({ data: { email: `n10-refund-${Date.now()}@example.com` } });
    ownerId = owner.id;
    await prisma.organizationMember.create({
      data: { organizationId: fixture.organization.id, userId: owner.id, roleId: fixture.ownerRoleId, status: "ACTIVE" },
    });
  });

  after(async () => {
    await cleanupFixtureEvent(fixture.organization.id);
    if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
  });

  it("mantém somente o prêmio quando o ingresso inteiro foi devolvido e a proteção não", async () => {
    const reservation = await prisma.reservation.create({
      data: { eventId: fixture.event.id, status: "CONVERTED", expiresAt: new Date(Date.now() + 60_000) },
    });
    const order = await prisma.order.create({
      data: {
        eventId: fixture.event.id,
        reservationId: reservation.id,
        contactEmail: "refund-protection@example.com",
        contactName: "Cliente Protegido",
        status: "REFUNDED",
        totalCents: 5650,
        protectionPurchased: true,
        protectionFeeCents: 150,
        paidAt: new Date(),
      },
    });
    const payment = await prisma.payment.create({
      data: { orderId: order.id, provider: "mock", method: "PIX", status: "REFUNDED", amountCents: 5650, paidAt: new Date() },
    });
    const ledger = await prisma.ledgerAccount.create({ data: { organizationId: fixture.organization.id } });
    await prisma.ledgerEntry.createMany({
      data: [
        { ledgerAccountId: ledger.id, type: "SALE_CREDIT", amountCents: 5500, referenceType: "payment", referenceId: payment.id },
        { ledgerAccountId: ledger.id, type: "PLATFORM_FEE", amountCents: -500, referenceType: "payment", referenceId: payment.id },
        { ledgerAccountId: ledger.id, type: "PROTECTION_CREDIT", amountCents: 150, referenceType: "payment", referenceId: payment.id },
        { ledgerAccountId: ledger.id, type: "REFUND_DEBIT", amountCents: -5000, referenceType: "payment", referenceId: payment.id },
      ],
    });

    const result = await service.list(fixture.organization.id, ownerId, { q: "refund-protection", page: 1, pageSize: 10 });
    const customer = result.customers[0]!;
    assert.equal(customer.ticketGrossCents, 5650);
    assert.equal(customer.refundCents, 5500);
    assert.equal(customer.ltvCents, 150);
    assert.equal(customer.netContributionCents, 150);
  });
});
