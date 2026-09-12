import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";
import { PromoterPerformanceService } from "../promoter-performance/promoter-performance.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";
const userIds: string[] = [];
const performance = new PromoterPerformanceService(new OrgAccessService());

async function attributedOrder(input: {
  promoterLinkId: string;
  promoterSellerId?: string;
  quantity: number;
  totalCents: number;
  commissionCents: number;
  email: string;
}) {
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
      contactEmail: input.email,
      status: "PAID",
      totalCents: input.totalCents,
      promoterLinkId: input.promoterLinkId,
      promoterSellerId: input.promoterSellerId,
      promoterCommissionCents: input.commissionCents,
      paidAt: new Date(),
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      ticketLotId: fixture.lot.id,
      quantity: input.quantity,
      priceCents: fixture.lot.priceCents,
      feeCents: fixture.lot.feeCents,
    },
  });
  return order;
}

describe("N4 — performance de promoters por evento", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 500, priceCents: 4000, feeCents: 400 });

    const owner = await prisma.user.create({ data: { email: `n4-owner-${Date.now()}@example.com` } });
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

    const promoterA = await prisma.user.create({ data: { email: `n4-a-${Date.now()}@example.com`, name: "Ana Promoter" } });
    const promoterB = await prisma.user.create({ data: { email: `n4-b-${Date.now()}@example.com`, name: "Bia Promoter" } });
    const invited = await prisma.user.create({ data: { email: `n4-c-${Date.now()}@example.com`, name: "Clara Promoter" } });
    const seller = await prisma.user.create({ data: { email: `n4-v-${Date.now()}@example.com`, name: "Vendedor A" } });
    userIds.push(promoterA.id, promoterB.id, invited.id, seller.id);

    const linkA = await prisma.promoterLink.create({
      data: {
        organizationId: fixture.organization.id,
        promoterUserId: promoterA.id,
        status: "ACTIVE",
        slug: `ana-${Date.now()}`,
        code: `ANA${String(Date.now()).slice(-5)}`,
        commissionType: "PERCENT",
        commissionBps: 1000,
      },
    });
    const linkB = await prisma.promoterLink.create({
      data: {
        organizationId: fixture.organization.id,
        promoterUserId: promoterB.id,
        status: "ACTIVE",
        slug: `bia-${Date.now()}`,
        eventId: fixture.event.id,
        commissionType: "FIXED",
        commissionFixedCents: 500,
      },
    });
    await prisma.promoterLink.create({
      data: {
        organizationId: fixture.organization.id,
        promoterUserId: invited.id,
        status: "INVITED",
        slug: `clara-${Date.now()}`,
      },
    });
    const sellerLink = await prisma.promoterSeller.create({
      data: {
        promoterLinkId: linkA.id,
        sellerUserId: seller.id,
        status: "ACTIVE",
        slug: `seller-${Date.now()}`,
      },
    });

    await attributedOrder({
      promoterLinkId: linkA.id,
      quantity: 2,
      totalCents: 10_000,
      commissionCents: 1_000,
      email: "a1@example.com",
    });
    await attributedOrder({
      promoterLinkId: linkA.id,
      promoterSellerId: sellerLink.id,
      quantity: 3,
      totalCents: 15_000,
      commissionCents: 1_500,
      email: "a2@example.com",
    });
    await attributedOrder({
      promoterLinkId: linkB.id,
      quantity: 1,
      totalCents: 5_000,
      commissionCents: 500,
      email: "b1@example.com",
    });
  });

  after(async () => {
    await cleanupFixtureEvent(fixture.organization.id);
    for (const id of userIds.reverse()) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it("ranqueia por ingressos e separa venda direta da equipe", async () => {
    const result = await performance.forEvent(fixture.organization.id, fixture.event.id, ownerId);

    assert.equal(result.summary.activePromoters, 2);
    assert.equal(result.summary.invitedPromoters, 1);
    assert.equal(result.summary.ticketsSold, 6);
    assert.equal(result.summary.paidOrders, 3);
    assert.equal(result.summary.grossCents, 30_000);
    assert.equal(result.summary.commissionCents, 3_000);

    const first = result.promoters[0];
    assert.equal(first?.promoterName, "Ana Promoter");
    assert.equal(first?.rank, 1);
    assert.equal(first?.ticketsSold, 5);
    assert.equal(first?.directTickets, 2);
    assert.equal(first?.sellerTickets, 3);
    assert.equal(first?.activeSellers, 1);

    const second = result.promoters[1];
    assert.equal(second?.promoterName, "Bia Promoter");
    assert.equal(second?.rank, 2);
    assert.equal(second?.ticketsSold, 1);

    const pending = result.promoters[2];
    assert.equal(pending?.status, "INVITED");
    assert.equal(pending?.rank, null);
  });

  it("não deixa consultar evento de outra organização", async () => {
    await assert.rejects(
      () => performance.forEvent(fixture.organization.id, "00000000-0000-0000-0000-000000000001", ownerId),
      /Evento não encontrado nesta organização/,
    );
  });
});
