import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";
import { CustomerSegmentsService } from "../customer-segments/customer-segments.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";
let promoterId = "";
let accountId = "";
let promoterLinkId = "";
const extraEventIds: string[] = [];
const vipIds: string[] = [];
const loyaltyIds: string[] = [];

const service = new CustomerSegmentsService(new OrgAccessService());

async function createEvent(title: string, daysAgo: number) {
  const startsAt = new Date(Date.now() - daysAgo * 86_400_000);
  const event = await prisma.event.create({
    data: {
      organizationId: fixture.organization.id,
      title,
      slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 8)}`,
      status: "COMPLETED",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      publishedAt: startsAt,
    },
  });
  extraEventIds.push(event.id);
  return event;
}

async function paidOrder(input: {
  email: string;
  name: string;
  eventId: string;
  amountCents: number;
  purchaseDaysAgo: number;
  promoter?: boolean;
}) {
  const reservation = await prisma.reservation.create({
    data: {
      eventId: input.eventId,
      status: "CONVERTED",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const order = await prisma.order.create({
    data: {
      eventId: input.eventId,
      reservationId: reservation.id,
      contactEmail: input.email,
      contactName: input.name,
      status: "PAID",
      totalCents: input.amountCents,
      paidAt: new Date(Date.now() - input.purchaseDaysAgo * 86_400_000),
      promoterLinkId: input.promoter ? promoterLinkId : null,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "mock",
      method: "PIX",
      status: "PAID",
      amountCents: input.amountCents,
      paidAt: order.paidAt,
    },
  });
  await prisma.ledgerEntry.create({
    data: {
      ledgerAccountId: accountId,
      type: "SALE_CREDIT",
      amountCents: input.amountCents,
      referenceType: "payment",
      referenceId: payment.id,
      createdAt: new Date(Date.now() - input.purchaseDaysAgo * 86_400_000),
    },
  });
  return { order, payment };
}

describe("N10.3 — segmentos financeiros automáticos", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 50, priceCents: 1000, feeCents: 0 });
    const owner = await prisma.user.create({ data: { email: `n103-owner-${Date.now()}@example.com` } });
    ownerId = owner.id;
    await prisma.organizationMember.create({
      data: {
        organizationId: fixture.organization.id,
        userId: owner.id,
        roleId: fixture.ownerRoleId,
        status: "ACTIVE",
      },
    });
    const promoter = await prisma.user.create({ data: { email: `n103-promoter-${Date.now()}@example.com`, name: "Promoter N10.3" } });
    promoterId = promoter.id;
    const promoterLink = await prisma.promoterLink.create({
      data: {
        organizationId: fixture.organization.id,
        promoterUserId: promoter.id,
        status: "ACTIVE",
        commissionType: "NONE",
        slug: `n103-${randomUUID().slice(0, 8)}`,
      },
    });
    promoterLinkId = promoterLink.id;
    const account = await prisma.ledgerAccount.create({ data: { organizationId: fixture.organization.id } });
    accountId = account.id;

    const recentA = await createEvent("N103 Recent A", 10);
    const recentB = await createEvent("N103 Recent B", 20);
    const recentC = await createEvent("N103 Recent C", 25);
    const oldA = await createEvent("N103 Old A", 80);
    const oldB = await createEvent("N103 Old B", 90);

    // Três clientes empatados no topo garantem p80 = R$ 300 e permitem
    // distinguir campeão, novo de alto valor e alto valor perdido.
    await paidOrder({ email: "champion@example.com", name: "Champion", eventId: recentA.id, amountCents: 10_000, purchaseDaysAgo: 10, promoter: true });
    await paidOrder({ email: "champion@example.com", name: "Champion", eventId: recentB.id, amountCents: 10_000, purchaseDaysAgo: 15, promoter: true });
    await paidOrder({ email: "champion@example.com", name: "Champion", eventId: recentC.id, amountCents: 10_000, purchaseDaysAgo: 20, promoter: true });

    await paidOrder({ email: "new-high@example.com", name: "New High", eventId: recentA.id, amountCents: 30_000, purchaseDaysAgo: 5 });

    await paidOrder({ email: "lost-high@example.com", name: "Lost High", eventId: oldA.id, amountCents: 15_000, purchaseDaysAgo: 75 });
    await paidOrder({ email: "lost-high@example.com", name: "Lost High", eventId: oldB.id, amountCents: 15_000, purchaseDaysAgo: 80 });

    await paidOrder({ email: "loyal@example.com", name: "Loyal", eventId: recentA.id, amountCents: 2000, purchaseDaysAgo: 12 });
    await paidOrder({ email: "loyal@example.com", name: "Loyal", eventId: recentB.id, amountCents: 2000, purchaseDaysAgo: 18 });
    await paidOrder({ email: "loyal@example.com", name: "Loyal", eventId: recentC.id, amountCents: 2000, purchaseDaysAgo: 22 });

    await paidOrder({ email: "risk@example.com", name: "Risk", eventId: oldA.id, amountCents: 2500, purchaseDaysAgo: 45 });
    await paidOrder({ email: "risk@example.com", name: "Risk", eventId: oldB.id, amountCents: 2500, purchaseDaysAgo: 50 });

    await paidOrder({ email: "low@example.com", name: "Low", eventId: recentA.id, amountCents: 1000, purchaseDaysAgo: 8 });

    // VIP pago do cliente novo de alto valor.
    const vipInventoryId = randomUUID();
    const vipReservationId = randomUUID();
    const vipPaymentId = randomUUID();
    vipIds.push(vipInventoryId, vipReservationId, vipPaymentId);
    await prisma.$executeRaw`
      INSERT INTO vip_inventory (
        id, event_id, kind, name, unit_price_cents, quantity, capacity_per_unit,
        max_units_per_reservation, active, created_at, updated_at
      ) VALUES (
        ${vipInventoryId}::uuid, ${recentA.id}::uuid, 'CAMAROTE', 'VIP N10.3',
        5000, 2, 8, 1, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO vip_reservations (
        id, public_token, vip_inventory_id, contact_name, contact_email, contact_phone,
        party_size, units, unit_price_cents, total_cents, status, deposit_cents,
        created_at, updated_at
      ) VALUES (
        ${vipReservationId}::uuid, ${randomUUID()}, ${vipInventoryId}::uuid, 'New High',
        'new-high@example.com', '34999999999', 6, 1, 5000, 5000, 'CONFIRMED', 5000,
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
    await prisma.ledgerEntry.create({
      data: {
        ledgerAccountId: accountId,
        type: "SALE_CREDIT",
        amountCents: 5000,
        referenceType: "vip_payment",
        referenceId: vipPaymentId,
      },
    });

    // Fidelidade engajada do campeão.
    const programId = randomUUID();
    const loyaltyAccountId = randomUUID();
    const loyaltyEntryId = randomUUID();
    loyaltyIds.push(programId, loyaltyAccountId, loyaltyEntryId);
    await prisma.$executeRaw`
      INSERT INTO loyalty_programs (
        id, organization_id, enabled, points_per_real, silver_points, gold_points,
        platinum_points, created_at, updated_at
      ) VALUES (
        ${programId}::uuid, ${fixture.organization.id}::uuid, TRUE, 1, 500, 1500, 3000,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO loyalty_accounts (
        id, organization_id, email_key, display_name, created_at, updated_at
      ) VALUES (
        ${loyaltyAccountId}::uuid, ${fixture.organization.id}::uuid,
        'champion@example.com', 'Champion', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO loyalty_entries (
        id, loyalty_account_id, organization_id, delta_points, source_type, source_id,
        description, created_at
      ) VALUES (
        ${loyaltyEntryId}::uuid, ${loyaltyAccountId}::uuid, ${fixture.organization.id}::uuid,
        300, 'ADJUSTMENT', ${randomUUID()}::uuid, 'Teste N10.3', CURRENT_TIMESTAMP
      )
    `;
  });

  after(async () => {
    await prisma.$executeRaw`DELETE FROM loyalty_redemptions WHERE loyalty_account_id IN (SELECT id FROM loyalty_accounts WHERE organization_id = ${fixture.organization.id}::uuid)`.catch(() => 0);
    await prisma.$executeRaw`DELETE FROM loyalty_entries WHERE organization_id = ${fixture.organization.id}::uuid`.catch(() => 0);
    await prisma.$executeRaw`DELETE FROM loyalty_accounts WHERE organization_id = ${fixture.organization.id}::uuid`.catch(() => 0);
    await prisma.$executeRaw`DELETE FROM loyalty_programs WHERE organization_id = ${fixture.organization.id}::uuid`.catch(() => 0);
    await prisma.$executeRaw`DELETE FROM vip_payment_events WHERE vip_payment_id IN (SELECT vp.id FROM vip_payments vp JOIN vip_reservations vr ON vr.id = vp.vip_reservation_id JOIN vip_inventory vi ON vi.id = vr.vip_inventory_id WHERE vi.event_id IN (SELECT id FROM events WHERE organization_id = ${fixture.organization.id}::uuid))`.catch(() => 0);
    await prisma.$executeRaw`DELETE FROM vip_payments WHERE vip_reservation_id IN (SELECT vr.id FROM vip_reservations vr JOIN vip_inventory vi ON vi.id = vr.vip_inventory_id WHERE vi.event_id IN (SELECT id FROM events WHERE organization_id = ${fixture.organization.id}::uuid))`.catch(() => 0);
    await prisma.$executeRaw`DELETE FROM vip_reservations WHERE vip_inventory_id IN (SELECT id FROM vip_inventory WHERE event_id IN (SELECT id FROM events WHERE organization_id = ${fixture.organization.id}::uuid))`.catch(() => 0);
    await prisma.$executeRaw`DELETE FROM vip_inventory WHERE event_id IN (SELECT id FROM events WHERE organization_id = ${fixture.organization.id}::uuid)`.catch(() => 0);
    await prisma.promoterLink.deleteMany({ where: { organizationId: fixture.organization.id } }).catch(() => undefined);
    await cleanupFixtureEvent(fixture.organization.id);
    if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    if (promoterId) await prisma.user.delete({ where: { id: promoterId } }).catch(() => undefined);
  });

  it("classifica segmentos sobrepostos com limiar relativo da Casa", async () => {
    const result = await service.list(fixture.organization.id, ownerId, { pageSize: 100 });
    assert.equal(result.thresholds.highValueLtvCents, 30_000);

    const byKey = new Map(result.segments.map((item) => [item.key, item.customers]));
    assert.equal(byKey.get("HIGH_VALUE"), 3);
    assert.equal(byKey.get("CHAMPION"), 1);
    assert.equal(byKey.get("NEW_HIGH_VALUE"), 1);
    assert.equal(byKey.get("LOYAL"), 2);
    assert.equal(byKey.get("LOST_HIGH_VALUE"), 1);
    assert.equal(byKey.get("AT_RISK"), 2);
    assert.equal(byKey.get("VIP_BUYER"), 1);
    assert.equal(byKey.get("PROMOTER_DRIVEN"), 1);
    assert.equal(byKey.get("LOYALTY_ENGAGED"), 1);

    const champion = result.customers.find((customer) => customer.email === "champion@example.com");
    assert.ok(champion);
    assert.ok(champion.segments.includes("CHAMPION"));
    assert.ok(champion.segments.includes("HIGH_VALUE"));
    assert.ok(champion.segments.includes("LOYAL"));
    assert.ok(champion.segments.includes("PROMOTER_DRIVEN"));
    assert.ok(champion.segments.includes("LOYALTY_ENGAGED"));
  });

  it("filtra por segmento sem perder as demais classificações do cliente", async () => {
    const result = await service.list(fixture.organization.id, ownerId, { segment: "LOST_HIGH_VALUE", pageSize: 100 });
    assert.equal(result.total, 1);
    assert.equal(result.customers[0]?.email, "lost-high@example.com");
    assert.ok(result.customers[0]?.segments.includes("HIGH_VALUE"));
    assert.ok(result.customers[0]?.segments.includes("AT_RISK"));
    assert.ok(result.customers[0]?.segments.includes("LOST_HIGH_VALUE"));
  });
});
