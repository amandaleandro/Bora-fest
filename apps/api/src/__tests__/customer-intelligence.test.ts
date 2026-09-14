import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";
import { CustomerIntelligenceService } from "../customer-intelligence/customer-intelligence.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";
const service = new CustomerIntelligenceService(new OrgAccessService());

describe("N10.2 — LTV e inteligência por cliente", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 20, priceCents: 10_000, feeCents: 0 });
    const owner = await prisma.user.create({ data: { email: `n10-ltv-owner-${Date.now()}@example.com` } });
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

  it("une ingresso, proteção, VIP, estorno e fidelidade sem multiplicar métricas", async () => {
    const email = "cliente-ltv@example.com";
    const reservation = await prisma.reservation.create({
      data: { eventId: fixture.event.id, status: "CONVERTED", expiresAt: new Date(Date.now() + 60_000) },
    });
    const order = await prisma.order.create({
      data: {
        eventId: fixture.event.id,
        reservationId: reservation.id,
        contactEmail: "Cliente-LTV@Example.com",
        contactName: "Cliente LTV",
        contactPhone: "34999999999",
        status: "PAID",
        totalCents: 10_150,
        protectionPurchased: true,
        protectionFeeCents: 150,
        paidAt: new Date(),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "mock",
        method: "PIX",
        status: "PAID",
        amountCents: 10_150,
        paidAt: new Date(),
      },
    });

    const vipInventoryId = randomUUID();
    const vipReservationId = randomUUID();
    const vipPaymentId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO vip_inventory (
        id, event_id, kind, name, unit_price_cents, quantity, capacity_per_unit,
        max_units_per_reservation, active, created_at, updated_at
      ) VALUES (
        ${vipInventoryId}::uuid, ${fixture.event.id}::uuid, 'CAMAROTE', 'Camarote LTV',
        5000, 2, 8, 1, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO vip_reservations (
        id, public_token, vip_inventory_id, contact_name, contact_email, contact_phone,
        party_size, units, unit_price_cents, total_cents, status, deposit_cents,
        created_at, updated_at
      ) VALUES (
        ${vipReservationId}::uuid, ${randomUUID()}, ${vipInventoryId}::uuid, 'Cliente LTV VIP',
        ${email}, '34988888888', 6, 1, 5000, 5000, 'CONFIRMED', 5000,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO vip_payments (
        id, vip_reservation_id, provider, method, status, amount_cents, paid_at, created_at, updated_at
      ) VALUES (
        ${vipPaymentId}::uuid, ${vipReservationId}::uuid, 'mock', 'PIX', 'PAID', 5000,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;

    const ledger = await prisma.ledgerAccount.create({ data: { organizationId: fixture.organization.id } });
    await prisma.ledgerEntry.createMany({
      data: [
        { ledgerAccountId: ledger.id, type: "SALE_CREDIT", amountCents: 10_000, referenceType: "payment", referenceId: payment.id },
        { ledgerAccountId: ledger.id, type: "PROTECTION_CREDIT", amountCents: 150, referenceType: "payment", referenceId: payment.id },
        { ledgerAccountId: ledger.id, type: "PLATFORM_FEE", amountCents: -500, referenceType: "payment", referenceId: payment.id },
        { ledgerAccountId: ledger.id, type: "REFUND_DEBIT", amountCents: -1000, referenceType: "payment", referenceId: payment.id },
        { ledgerAccountId: ledger.id, type: "SALE_CREDIT", amountCents: 5000, referenceType: "vip_payment", referenceId: vipPaymentId },
        { ledgerAccountId: ledger.id, type: "PLATFORM_FEE", amountCents: -250, referenceType: "vip_payment", referenceId: vipPaymentId },
      ],
    });

    const accountId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO loyalty_programs (
        id, organization_id, enabled, points_per_real, silver_points, gold_points, platinum_points,
        created_at, updated_at
      ) VALUES (
        ${randomUUID()}::uuid, ${fixture.organization.id}::uuid, TRUE, 1, 500, 1500, 3000,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO loyalty_accounts (
        id, organization_id, email_key, display_name, created_at, updated_at
      ) VALUES (
        ${accountId}::uuid, ${fixture.organization.id}::uuid, ${email}, 'Cliente LTV', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    const redeemA = randomUUID();
    const redeemB = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO loyalty_entries (
        id, loyalty_account_id, organization_id, delta_points, source_type, source_id, description, created_at
      ) VALUES
        (${randomUUID()}::uuid, ${accountId}::uuid, ${fixture.organization.id}::uuid, 1200, 'ADJUSTMENT', ${randomUUID()}::uuid, 'Carga teste', CURRENT_TIMESTAMP),
        (${randomUUID()}::uuid, ${accountId}::uuid, ${fixture.organization.id}::uuid, -100, 'REWARD_REDEEM', ${redeemA}::uuid, 'Resgate A', CURRENT_TIMESTAMP),
        (${randomUUID()}::uuid, ${accountId}::uuid, ${fixture.organization.id}::uuid, -100, 'REWARD_REDEEM', ${redeemB}::uuid, 'Resgate B', CURRENT_TIMESTAMP)
    `;
    const rewardId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO loyalty_rewards (
        id, organization_id, name, points_cost, quantity, max_per_customer, active, created_at, updated_at
      ) VALUES (
        ${rewardId}::uuid, ${fixture.organization.id}::uuid, 'Benefício teste', 100, 10, 10, TRUE,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO loyalty_redemptions (
        id, organization_id, reward_id, loyalty_account_id, code, points_cost, status, created_at
      ) VALUES
        (${redeemA}::uuid, ${fixture.organization.id}::uuid, ${rewardId}::uuid, ${accountId}::uuid, ${`BF-${redeemA.slice(0, 8)}`}, 100, 'ISSUED', CURRENT_TIMESTAMP),
        (${redeemB}::uuid, ${fixture.organization.id}::uuid, ${rewardId}::uuid, ${accountId}::uuid, ${`BF-${redeemB.slice(0, 8)}`}, 100, 'USED', CURRENT_TIMESTAMP)
    `;

    const result = await service.list(fixture.organization.id, ownerId, { q: "cliente-ltv", page: 1, pageSize: 10 });
    assert.equal(result.total, 1);
    assert.equal(result.summary.totalCustomers, 1);
    assert.equal(result.summary.totalLtvCents, 14_150);
    assert.equal(result.summary.avgLtvCents, 14_150);
    assert.equal(result.summary.vipCustomers, 1);
    assert.equal(result.summary.loyaltyMembers, 1);

    const customer = result.customers[0]!;
    assert.equal(customer.email.toLowerCase(), email);
    assert.equal(customer.ticketGrossCents, 10_150);
    assert.equal(customer.vipGrossCents, 5000);
    assert.equal(customer.refundCents, 1000);
    assert.equal(customer.ltvCents, 14_150);
    assert.equal(customer.netContributionCents, 13_400);
    assert.equal(customer.purchaseCount, 2);
    assert.equal(customer.avgPurchaseCents, 7075);
    assert.equal(customer.vipPurchases, 1);
    assert.equal(customer.loyalty.points, 1000);
    assert.equal(customer.loyalty.lifetimePoints, 1200);
    assert.equal(customer.loyalty.level, "SILVER");
    assert.equal(customer.loyalty.rewardsRedeemed, 2);
  });
});
