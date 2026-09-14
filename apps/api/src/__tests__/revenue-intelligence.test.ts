import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { getEarningsByEventCents, getEventNetCents } from "../common/ledger";
import { OrgAccessService } from "../common/org-access.service";
import { RevenueIntelligenceService } from "../revenue-intelligence/revenue-intelligence.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";
let vipInventoryId = "";
let vipReservationId = "";
let vipPaymentId = "";

const service = new RevenueIntelligenceService(new OrgAccessService());

describe("N10.1 — receita unificada", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 20, priceCents: 10_000, feeCents: 0 });
    const owner = await prisma.user.create({ data: { email: `n10-owner-${Date.now()}@example.com` } });
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
    if (vipInventoryId) {
      await prisma.$executeRaw`DELETE FROM vip_payment_events WHERE vip_payment_id = ${vipPaymentId}::uuid`.catch(() => 0);
      await prisma.$executeRaw`DELETE FROM vip_payments WHERE id = ${vipPaymentId}::uuid`.catch(() => 0);
      await prisma.$executeRaw`DELETE FROM vip_reservations WHERE id = ${vipReservationId}::uuid`.catch(() => 0);
      await prisma.$executeRaw`DELETE FROM vip_inventory WHERE id = ${vipInventoryId}::uuid`.catch(() => 0);
    }
    await cleanupFixtureEvent(fixture.organization.id);
    if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
  });

  it("consolida ingresso + VIP + estorno + taxa sem duplicar a contabilidade", async () => {
    const reservation = await prisma.reservation.create({
      data: {
        eventId: fixture.event.id,
        status: "CONVERTED",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const order = await prisma.order.create({
      data: {
        eventId: fixture.event.id,
        reservationId: reservation.id,
        contactEmail: "cliente-n10@example.com",
        contactName: "Cliente N10",
        status: "PAID",
        totalCents: 10_000,
        paidAt: new Date(),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "mock",
        method: "PIX",
        status: "PAID",
        amountCents: 10_000,
        paidAt: new Date(),
      },
    });

    vipInventoryId = randomUUID();
    vipReservationId = randomUUID();
    vipPaymentId = randomUUID();
    const vipToken = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO vip_inventory (
        id, event_id, kind, name, unit_price_cents, quantity, capacity_per_unit,
        max_units_per_reservation, active, created_at, updated_at
      ) VALUES (
        ${vipInventoryId}::uuid, ${fixture.event.id}::uuid, 'CAMAROTE', 'Camarote N10',
        5000, 2, 8, 1, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO vip_reservations (
        id, public_token, vip_inventory_id, contact_name, contact_email, contact_phone,
        party_size, units, unit_price_cents, total_cents, status, deposit_cents,
        created_at, updated_at
      ) VALUES (
        ${vipReservationId}::uuid, ${vipToken}, ${vipInventoryId}::uuid, 'Cliente VIP',
        'vip-n10@example.com', '34999999999', 6, 1, 5000, 5000, 'CONFIRMED', 5000,
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

    const account = await prisma.ledgerAccount.create({ data: { organizationId: fixture.organization.id } });
    await prisma.ledgerEntry.createMany({
      data: [
        { ledgerAccountId: account.id, type: "SALE_CREDIT", amountCents: 10_000, referenceType: "payment", referenceId: payment.id },
        { ledgerAccountId: account.id, type: "PLATFORM_FEE", amountCents: -500, referenceType: "payment", referenceId: payment.id },
        { ledgerAccountId: account.id, type: "COMMISSION_DEBIT", amountCents: -300, referenceType: "payment", referenceId: payment.id },
        { ledgerAccountId: account.id, type: "REFUND_DEBIT", amountCents: -1000, referenceType: "payment", referenceId: payment.id },
        { ledgerAccountId: account.id, type: "SALE_CREDIT", amountCents: 5000, referenceType: "vip_payment", referenceId: vipPaymentId },
        { ledgerAccountId: account.id, type: "PLATFORM_FEE", amountCents: -250, referenceType: "vip_payment", referenceId: vipPaymentId },
      ],
    });

    const result = await service.get(fixture.organization.id, ownerId);
    assert.equal(result.summary.ticketGrossCents, 10_000);
    assert.equal(result.summary.vipGrossCents, 5000);
    assert.equal(result.summary.grossCents, 15_000);
    assert.equal(result.summary.refundCents, 1000);
    assert.equal(result.summary.platformFeeCents, 750);
    assert.equal(result.summary.commissionCents, 300);
    assert.equal(result.summary.netCents, 12_950);
    assert.equal(result.summary.vipRevenueSharePct, 33.33);

    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]?.eventId, fixture.event.id);
    assert.equal(result.events[0]?.ticketGrossCents, 10_000);
    assert.equal(result.events[0]?.vipGrossCents, 5000);
    assert.equal(result.events[0]?.netCents, 12_950);

    const eventNet = await getEventNetCents(fixture.event.id);
    assert.equal(eventNet, 12_950);
    const byEvent = await getEarningsByEventCents(fixture.organization.id);
    assert.equal(byEvent.get(fixture.event.id), 12_950);
  });
});
