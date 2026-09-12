import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { CustomerCrmService } from "../customer-crm/customer-crm.service";
import { OrgAccessService } from "../common/org-access.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let otherFixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";
const userIds: string[] = [];
const crm = new CustomerCrmService(new OrgAccessService());

async function paidOrder(input: {
  eventId: string;
  email: string;
  totalCents: number;
  userId?: string;
  name?: string;
  phone?: string;
}) {
  const reservation = await prisma.reservation.create({
    data: {
      eventId: input.eventId,
      userId: input.userId,
      status: "CONVERTED",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return prisma.order.create({
    data: {
      eventId: input.eventId,
      reservationId: reservation.id,
      userId: input.userId,
      contactEmail: input.email,
      contactName: input.name,
      contactPhone: input.phone,
      status: "PAID",
      totalCents: input.totalCents,
      paidAt: new Date(),
    },
  });
}

describe("N5 — CRM de clientes da Casa", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 200, priceCents: 4000, feeCents: 400 });
    otherFixture = await createFixtureEvent({ lotCapacity: 50, priceCents: 3000, feeCents: 300 });

    const pastStart = new Date(Date.now() - 45 * 86_400_000);
    await prisma.event.update({
      where: { id: fixture.event.id },
      data: { startsAt: pastStart, endsAt: new Date(pastStart.getTime() + 4 * 3_600_000) },
    });

    const futureEvent = await prisma.event.create({
      data: {
        organizationId: fixture.organization.id,
        title: "Próxima edição CRM",
        slug: `crm-future-${Date.now()}`,
        status: "PUBLISHED",
        category: "FESTAS",
        startsAt: new Date(Date.now() + 20 * 86_400_000),
        endsAt: new Date(Date.now() + 20 * 86_400_000 + 4 * 3_600_000),
      },
    });

    const owner = await prisma.user.create({ data: { email: `crm-owner-${Date.now()}@example.com` } });
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

    const recurring = await prisma.user.create({
      data: {
        email: `ana-crm-${Date.now()}@example.com`,
        name: "Ana Cliente",
        notifyEmailOffers: true,
      },
    });
    userIds.push(recurring.id);
    await prisma.organizationFollow.create({
      data: { organizationId: fixture.organization.id, userId: recurring.id },
    });

    await paidOrder({
      eventId: fixture.event.id,
      email: recurring.email!,
      userId: recurring.id,
      name: "Ana Cliente",
      phone: "(34) 99999-1000",
      totalCents: 10_000,
    });
    await paidOrder({
      eventId: futureEvent.id,
      email: recurring.email!.toUpperCase(),
      userId: recurring.id,
      name: "Ana Cliente",
      phone: "34999991000",
      totalCents: 15_000,
    });

    await paidOrder({
      eventId: fixture.event.id,
      email: `bia-crm-${Date.now()}@example.com`,
      name: "Bia Primeira Compra",
      totalCents: 5_000,
    });

    await paidOrder({
      eventId: otherFixture.event.id,
      email: `outra-casa-${Date.now()}@example.com`,
      name: "Cliente Outra Casa",
      totalCents: 99_000,
    });
  });

  after(async () => {
    await cleanupFixtureEvent(fixture.organization.id);
    await cleanupFixtureEvent(otherFixture.organization.id);
    for (const id of userIds.reverse()) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it("consolida e-mail normalizado e identifica recorrência, seguidor e opt-in", async () => {
    const result = await crm.list(fixture.organization.id, ownerId, { segment: "ALL" });
    assert.equal(result.total, 2);

    const ana = result.customers.find((customer) => customer.name === "Ana Cliente");
    assert.ok(ana);
    assert.equal(ana?.eventsCount, 2);
    assert.equal(ana?.paidOrders, 2);
    assert.equal(ana?.spentCents, 25_000);
    assert.equal(ana?.followsHouse, true);
    assert.equal(ana?.emailOffersOptIn, true);
    assert.ok(ana?.tags.includes("RECURRING"));
    assert.ok(ana?.tags.includes("FOLLOWER"));
    assert.ok(ana?.tags.includes("EMAIL_OPT_IN"));
  });

  it("segmenta sem alterar o significado dos cards de resumo", async () => {
    const recurring = await crm.list(fixture.organization.id, ownerId, { segment: "RECURRING" });
    assert.equal(recurring.total, 1);
    assert.equal(recurring.customers[0]?.name, "Ana Cliente");
    assert.equal(recurring.summary.recurring, 1);
    // Bia continua compondo o resumo da base pesquisada mesmo fora do segmento.
    assert.equal(recurring.summary.noShow, 1);
  });

  it("busca por nome e isola clientes de outra organização", async () => {
    const search = await crm.list(fixture.organization.id, ownerId, { q: "Bia Primeira" });
    assert.equal(search.total, 1);
    assert.equal(search.customers[0]?.name, "Bia Primeira Compra");

    const all = await crm.list(fixture.organization.id, ownerId, {});
    assert.equal(all.customers.some((customer) => customer.name === "Cliente Outra Casa"), false);
  });

  it("rejeita segmento desconhecido", async () => {
    await assert.rejects(
      () => crm.list(fixture.organization.id, ownerId, { segment: "QUALQUER" }),
      /Segmento de clientes inválido/,
    );
  });
});
