import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";
import { RetentionIntelligenceService } from "../customer-crm/retention-intelligence.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let otherFixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";
let secondEventId = "";
let secondTicketTypeId = "";
let secondLotId = "";
const userIds: string[] = [];
const retention = new RetentionIntelligenceService(new OrgAccessService());

async function createPaidOrder(input: {
  eventId: string;
  lotId: string;
  email: string;
  totalCents: number;
  checkedIn?: boolean;
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
      status: "PAID",
      totalCents: input.totalCents,
      paidAt: new Date(),
    },
  });
  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      ticketLotId: input.lotId,
      quantity: 1,
      priceCents: input.totalCents,
      feeCents: 0,
    },
  });
  await prisma.ticket.create({
    data: {
      orderId: order.id,
      orderItemId: item.id,
      eventId: input.eventId,
      ticketLotId: input.lotId,
      seq: 1,
      code: `ret-${Math.random().toString(36).slice(2)}`,
      qrToken: `qr-${Math.random().toString(36).slice(2)}`,
      status: input.checkedIn ? "CHECKED_IN" : "ACTIVE",
      checkedInAt: input.checkedIn ? new Date() : null,
    },
  });
  return order;
}

describe("N6 — inteligência de retenção da Casa", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 100, priceCents: 4000, feeCents: 0 });
    otherFixture = await createFixtureEvent({ lotCapacity: 50, priceCents: 3000, feeCents: 0 });

    const firstStart = new Date(Date.now() - 60 * 86_400_000);
    await prisma.event.update({
      where: { id: fixture.event.id },
      data: {
        startsAt: firstStart,
        endsAt: new Date(firstStart.getTime() + 4 * 3_600_000),
        status: "COMPLETED",
      },
    });

    const secondStart = new Date(Date.now() - 20 * 86_400_000);
    const secondEvent = await prisma.event.create({
      data: {
        organizationId: fixture.organization.id,
        title: "Segunda Festa Retenção",
        slug: `retencao-segunda-${Date.now()}`,
        status: "COMPLETED",
        startsAt: secondStart,
        endsAt: new Date(secondStart.getTime() + 4 * 3_600_000),
      },
    });
    secondEventId = secondEvent.id;
    const secondType = await prisma.ticketType.create({ data: { eventId: secondEvent.id, name: "Pista" } });
    secondTicketTypeId = secondType.id;
    const secondLot = await prisma.ticketLot.create({
      data: {
        ticketTypeId: secondType.id,
        name: "Único",
        priceCents: 5000,
        feeCents: 0,
        capacity: 100,
        status: "ACTIVE",
      },
    });
    secondLotId = secondLot.id;

    const owner = await prisma.user.create({ data: { email: `ret-owner-${Date.now()}@example.com` } });
    ownerId = owner.id;
    userIds.push(owner.id);
    await prisma.organizationMember.create({
      data: {
        organizationId: fixture.organization.id,
        userId: owner.id,
        roleId: fixture.ownerRoleId,
        status: "ACTIVE",
      },
    });

    const ana = `ana-ret-${Date.now()}@example.com`;
    const bia = `bia-ret-${Date.now()}@example.com`;
    await createPaidOrder({ eventId: fixture.event.id, lotId: fixture.lot.id, email: ana, totalCents: 10_000, checkedIn: true });
    await createPaidOrder({ eventId: secondEvent.id, lotId: secondLot.id, email: ana.toUpperCase(), totalCents: 15_000, checkedIn: true });
    await createPaidOrder({ eventId: secondEvent.id, lotId: secondLot.id, email: bia, totalCents: 5_000, checkedIn: false });

    await createPaidOrder({
      eventId: otherFixture.event.id,
      lotId: otherFixture.lot.id,
      email: `outra-ret-${Date.now()}@example.com`,
      totalCents: 99_000,
      checkedIn: true,
    });
  });

  after(async () => {
    if (secondEventId) {
      await prisma.ticket.deleteMany({ where: { eventId: secondEventId } });
      await prisma.orderItem.deleteMany({ where: { order: { eventId: secondEventId } } });
      await prisma.order.deleteMany({ where: { eventId: secondEventId } });
      await prisma.reservation.deleteMany({ where: { eventId: secondEventId } });
      if (secondLotId) await prisma.ticketLot.deleteMany({ where: { id: secondLotId } });
      if (secondTicketTypeId) await prisma.ticketType.deleteMany({ where: { id: secondTicketTypeId } });
      await prisma.event.deleteMany({ where: { id: secondEventId } });
    }
    await cleanupFixtureEvent(fixture.organization.id);
    await cleanupFixtureEvent(otherFixture.organization.id);
    for (const id of userIds.reverse()) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it("mede retorno, receita recorrente e isola outra Casa", async () => {
    const result = await retention.get(fixture.organization.id, ownerId);
    assert.equal(result.summary.totalCustomers, 2);
    assert.equal(result.summary.repeatCustomers, 1);
    assert.equal(result.summary.repeatRatePct, 50);
    assert.equal(result.summary.frequentCustomers, 0);
    assert.equal(result.summary.noShowCustomers, 1);
    assert.equal(result.summary.totalRevenueCents, 30_000);
    assert.equal(result.summary.repeatRevenueCents, 25_000);
    assert.equal(result.summary.repeatRevenueSharePct, 83.33);
    assert.equal(result.summary.totalRevenueCents < 99_000, true);
  });

  it("mostra clientes novos e recorrentes por evento, com presença real", async () => {
    const result = await retention.get(fixture.organization.id, ownerId);
    const second = result.events.find((event) => event.eventId === secondEventId);
    assert.ok(second);
    assert.equal(second?.buyers, 2);
    assert.equal(second?.newCustomers, 1);
    assert.equal(second?.returningCustomers, 1);
    assert.equal(second?.returnRatePct, 50);
    assert.equal(second?.ticketsCount, 2);
    assert.equal(second?.checkedInTickets, 1);
    assert.equal(second?.attendanceRatePct, 50);
  });
});
