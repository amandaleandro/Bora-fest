import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { EventRecurrenceService } from "../events/event-recurrence.service";
import { OrgAccessService } from "../common/org-access.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";

const recurrence = new EventRecurrenceService(new OrgAccessService());

describe("N3 — eventos recorrentes", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 120, priceCents: 4500, feeCents: 500 });

    const owner = await prisma.user.create({
      data: { email: `recurrence-${Math.random().toString(36).slice(2)}@example.com` },
    });
    ownerId = owner.id;
    await prisma.organizationMember.create({
      data: {
        organizationId: fixture.organization.id,
        userId: owner.id,
        roleId: fixture.ownerRoleId,
        status: "ACTIVE",
      },
    });

    await prisma.event.update({
      where: { id: fixture.event.id },
      data: {
        bannerUrl: "https://example.com/weekly.jpg",
        description: "Festa semanal",
        lineup: "DJ A\nDJ B",
        amenities: "Open bar",
        minAge: 18,
        waitingRoomEnabled: true,
        waitingRoomConcurrency: 50,
      },
    });

    await prisma.ticketLot.update({
      where: { id: fixture.lot.id },
      data: {
        status: "ACTIVE",
        soldCount: 17,
        reservedCount: 3,
        startsAt: new Date(fixture.event.startsAt.getTime() - 24 * 60 * 60 * 1000),
        endsAt: new Date(fixture.event.startsAt.getTime() - 60 * 60 * 1000),
        nominal: true,
        requiresCpf: true,
        halfPriceEnabled: true,
        promoterOnly: true,
      },
    });

    await prisma.eventAddOn.create({
      data: {
        eventId: fixture.event.id,
        name: "Copo",
        description: "Copo oficial",
        priceCents: 1500,
        active: true,
      },
    });
  });

  after(async () => {
    await cleanupFixtureEvent(fixture.organization.id);
    if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
  });

  it("cria a próxima semana como rascunho e zera todo estado operacional do lote", async () => {
    const created = await recurrence.nextEdition(fixture.event.id, ownerId, {
      cadenceDays: 7,
      copyTicketCatalog: true,
    });

    assert.equal(created.status, "DRAFT");
    assert.equal(created.title, fixture.event.title);
    assert.equal(created.copiedFromEventId, fixture.event.id);
    assert.equal(created.copiedTicketTypes, 1);
    assert.equal(created.copiedLots, 1);
    assert.equal(created.copiedAddOns, 1);
    assert.equal(
      new Date(created.startsAt).getTime() - fixture.event.startsAt.getTime(),
      7 * 24 * 60 * 60 * 1000,
    );

    const copied = await prisma.event.findUniqueOrThrow({
      where: { id: created.id },
      include: { ticketTypes: { include: { lots: true } }, addOns: true },
    });
    assert.equal(copied.bannerUrl, "https://example.com/weekly.jpg");
    assert.equal(copied.description, "Festa semanal");
    assert.equal(copied.ticketTypes.length, 1);
    assert.equal(copied.addOns.length, 1);

    const lot = copied.ticketTypes[0]?.lots[0];
    assert.ok(lot);
    assert.equal(lot?.status, "DRAFT");
    assert.equal(lot?.soldCount, 0);
    assert.equal(lot?.reservedCount, 0);
    assert.equal(lot?.priceCents, fixture.lot.priceCents);
    assert.equal(lot?.capacity, fixture.lot.capacity);
    assert.equal(lot?.nominal, true);
    assert.equal(lot?.requiresCpf, true);
    assert.equal(lot?.halfPriceEnabled, true);
    assert.equal(lot?.promoterOnly, true);

    const sourceLot = await prisma.ticketLot.findUniqueOrThrow({ where: { id: fixture.lot.id } });
    assert.equal(
      lot?.startsAt?.getTime(),
      (sourceLot.startsAt?.getTime() ?? 0) + 7 * 24 * 60 * 60 * 1000,
    );
    assert.equal(
      lot?.endsAt?.getTime(),
      (sourceLot.endsAt?.getTime() ?? 0) + 7 * 24 * 60 * 60 * 1000,
    );
  });

  it("permite duplicar para data personalizada sem copiar o catálogo", async () => {
    const start = new Date(fixture.event.startsAt.getTime() + 21 * 24 * 60 * 60 * 1000);
    const end = new Date(fixture.event.endsAt.getTime() + 21 * 24 * 60 * 60 * 1000);
    const created = await recurrence.duplicate(fixture.event.id, ownerId, {
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      title: "Edição especial",
      copyTicketCatalog: false,
    });

    assert.equal(created.title, "Edição especial");
    assert.equal(created.copiedTicketTypes, 0);
    assert.equal(created.copiedLots, 0);

    const copiedTypes = await prisma.ticketType.count({ where: { eventId: created.id } });
    assert.equal(copiedTypes, 0);
  });

  it("rejeita uma edição cujo fim não seja posterior ao início", async () => {
    const when = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await assert.rejects(
      () => recurrence.duplicate(fixture.event.id, ownerId, {
        startsAt: when,
        endsAt: when,
        copyTicketCatalog: true,
      }),
      /terminar depois do início/,
    );
  });
});
