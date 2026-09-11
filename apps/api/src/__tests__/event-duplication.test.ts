import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { OrgAccessService } from "../common/org-access.service";
import { EventDuplicationService } from "../events/event-duplication.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

const duplication = new EventDuplicationService(new OrgAccessService());

async function ownerFor(organizationId: string, roleId: string) {
  const user = await prisma.user.create({
    data: { email: `n3-${Math.random().toString(36).slice(2, 10)}@borafest.dev` },
  });
  await prisma.organizationMember.create({
    data: { organizationId, userId: user.id, roleId, status: "ACTIVE" },
  });
  return user;
}

describe("N3 — próxima edição", () => {
  it("clona estrutura, desloca datas e zera todo estado comercial", async () => {
    const fixture = await createFixtureEvent({ lotCapacity: 100, priceCents: 4500, feeCents: 500 });
    const owner = await ownerFor(fixture.organization.id, fixture.ownerRoleId);

    try {
      const venue = await prisma.venue.create({
        data: {
          organizationId: fixture.organization.id,
          name: "Casa N3",
          city: "Uberlândia",
          state: "MG",
        },
      });
      const lotStartsAt = new Date(fixture.event.startsAt.getTime() - 2 * 86_400_000);
      const lotEndsAt = new Date(fixture.event.startsAt.getTime() + 2 * 60 * 60_000);

      await prisma.event.update({
        where: { id: fixture.event.id },
        data: {
          venueId: venue.id,
          bannerUrl: "https://example.com/n3.webp",
          waitingRoomEnabled: true,
          waitingRoomConcurrency: 77,
          pixelSettings: { metaPixelId: "META123" },
          metaCapiToken: "segredo-capi-n3",
        },
      });
      await prisma.ticketLot.update({
        where: { id: fixture.lot.id },
        data: {
          status: "SOLD_OUT",
          soldCount: 80,
          reservedCount: 20,
          startsAt: lotStartsAt,
          endsAt: lotEndsAt,
          halfPriceEnabled: true,
        },
      });
      await prisma.eventAddOn.create({
        data: { eventId: fixture.event.id, name: "Copo", priceCents: 1500, active: true },
      });
      const partner = await prisma.salesPartner.create({
        data: {
          organizationId: fixture.organization.id,
          name: `Atlética N3 ${Math.random().toString(36).slice(2, 6)}`,
          slug: `atletica-n3-${Math.random().toString(36).slice(2, 8)}`,
          commissionBps: 1000,
        },
      });
      await prisma.eventSalesPartner.create({
        data: { eventId: fixture.event.id, partnerId: partner.id },
      });
      await prisma.checkinPoint.create({
        data: { eventId: fixture.event.id, name: "Portaria principal", active: true },
      });

      const result = await duplication.duplicate(fixture.event.id, owner.id, {
        cadence: "WEEKLY",
        copyTickets: true,
        copyAddOns: true,
        copySalesPartners: true,
        copyCheckinPoints: true,
        copyMarketing: false,
      });

      assert.equal(result.event.status, "DRAFT");
      assert.notEqual(result.event.id, fixture.event.id);
      assert.notEqual(result.event.slug, fixture.event.slug);
      assert.equal(result.event.organizationId, fixture.organization.id);
      assert.equal(result.event.venueId, venue.id);
      assert.equal(result.event.bannerUrl, "https://example.com/n3.webp");
      assert.equal(result.copied.ticketTypes, 1);
      assert.equal(result.copied.lots, 1);
      assert.equal(result.copied.addOns, 1);
      assert.equal(result.copied.salesPartners, 1);
      assert.equal(result.copied.checkinPoints, 1);

      const sourceDuration = fixture.event.endsAt.getTime() - fixture.event.startsAt.getTime();
      const targetDuration = result.event.endsAt.getTime() - result.event.startsAt.getTime();
      assert.equal(targetDuration, sourceDuration, "mantém a duração do evento");
      assert.equal(
        result.event.startsAt.getTime() - fixture.event.startsAt.getTime(),
        7 * 86_400_000,
        "edição semanal futura mantém o intervalo de 7 dias",
      );

      const newEvent = await prisma.event.findUniqueOrThrow({ where: { id: result.event.id } });
      assert.equal(newEvent.waitingRoomEnabled, true);
      assert.equal(newEvent.waitingRoomConcurrency, 77);
      assert.equal(newEvent.pixelSettings, null, "marketing não é copiado sem opt-in");
      assert.equal(newEvent.metaCapiToken, null, "segredo de CAPI não é copiado sem opt-in");
      assert.equal(newEvent.publishedAt, null);
      assert.equal(newEvent.canceledAt, null);

      const newLots = await prisma.ticketLot.findMany({
        where: { ticketType: { eventId: result.event.id } },
      });
      assert.equal(newLots.length, 1);
      assert.equal(newLots[0]?.priceCents, 4500);
      assert.equal(newLots[0]?.capacity, 100);
      assert.equal(newLots[0]?.soldCount, 0, "vendas nunca atravessam edição");
      assert.equal(newLots[0]?.reservedCount, 0, "reservas nunca atravessam edição");
      assert.equal(newLots[0]?.status, "ACTIVE", "lote esgotado renasce disponível na nova edição");
      assert.equal(newLots[0]?.halfPriceEnabled, true);
      assert.equal(
        newLots[0]?.startsAt?.getTime(),
        lotStartsAt.getTime() + 7 * 86_400_000,
        "janela do lote acompanha a data do novo evento",
      );
      assert.equal(newLots[0]?.endsAt?.getTime(), lotEndsAt.getTime() + 7 * 86_400_000);

      assert.equal(await prisma.eventAddOn.count({ where: { eventId: result.event.id } }), 1);
      assert.equal(await prisma.eventSalesPartner.count({ where: { eventId: result.event.id } }), 1);
      assert.equal(await prisma.checkinPoint.count({ where: { eventId: result.event.id } }), 1);
      assert.equal(await prisma.order.count({ where: { eventId: result.event.id } }), 0);
      assert.equal(await prisma.ticket.count({ where: { eventId: result.event.id } }), 0);
      assert.equal(await prisma.reservation.count({ where: { eventId: result.event.id } }), 0);
      assert.equal(await prisma.guestListEntry.count({ where: { eventId: result.event.id } }), 0);
      assert.equal(await prisma.checkin.count({ where: { eventId: result.event.id } }), 0);
      assert.equal(await prisma.validatorCredential.count({ where: { eventId: result.event.id } }), 0);
      assert.equal(await prisma.validatorDevice.count({ where: { eventId: result.event.id } }), 0);
      assert.equal(await prisma.eventReview.count({ where: { eventId: result.event.id } }), 0);
    } finally {
      await cleanupFixtureEvent(fixture.organization.id);
      await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    }
  });

  it("avança uma edição antiga até a primeira ocorrência futura", async () => {
    const fixture = await createFixtureEvent({ lotCapacity: 10 });
    const owner = await ownerFor(fixture.organization.id, fixture.ownerRoleId);

    try {
      const sourceStart = new Date(Date.now() - 31 * 86_400_000);
      const sourceEnd = new Date(sourceStart.getTime() + 4 * 60 * 60_000);
      await prisma.event.update({
        where: { id: fixture.event.id },
        data: { startsAt: sourceStart, endsAt: sourceEnd },
      });

      const result = await duplication.duplicate(fixture.event.id, owner.id, {
        cadence: "WEEKLY",
        copyTickets: false,
        copyAddOns: false,
        copySalesPartners: false,
        copyCheckinPoints: false,
        copyMarketing: false,
      });

      assert.ok(result.event.startsAt.getTime() > Date.now());
      const delta = result.event.startsAt.getTime() - sourceStart.getTime();
      assert.equal(delta % (7 * 86_400_000), 0, "a nova data continua na grade semanal original");
      assert.equal(result.event.endsAt.getTime() - result.event.startsAt.getTime(), 4 * 60 * 60_000);
    } finally {
      await cleanupFixtureEvent(fixture.organization.id);
      await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    }
  });

  it("copia marketing somente com opt-in e nunca devolve o token secreto", async () => {
    const fixture = await createFixtureEvent({ lotCapacity: 10 });
    const owner = await ownerFor(fixture.organization.id, fixture.ownerRoleId);

    try {
      await prisma.event.update({
        where: { id: fixture.event.id },
        data: { pixelSettings: { ga4MeasurementId: "G123" }, metaCapiToken: "token-ultra-secreto" },
      });

      const result = await duplication.duplicate(fixture.event.id, owner.id, {
        cadence: "WEEKLY",
        copyTickets: false,
        copyAddOns: false,
        copySalesPartners: false,
        copyCheckinPoints: false,
        copyMarketing: true,
      });

      const row = await prisma.event.findUniqueOrThrow({ where: { id: result.event.id } });
      assert.deepEqual(row.pixelSettings, { ga4MeasurementId: "G123" });
      assert.equal(row.metaCapiToken, "token-ultra-secreto");
      assert.equal("metaCapiToken" in result.event, false, "resposta pública nunca vaza CAPI");
    } finally {
      await cleanupFixtureEvent(fixture.organization.id);
      await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    }
  });

  it("rejeita data manual no passado", async () => {
    const fixture = await createFixtureEvent({ lotCapacity: 10 });
    const owner = await ownerFor(fixture.organization.id, fixture.ownerRoleId);

    try {
      await assert.rejects(
        () =>
          duplication.duplicate(fixture.event.id, owner.id, {
            cadence: "CUSTOM",
            startsAt: new Date(Date.now() - 60_000).toISOString(),
            copyTickets: true,
            copyAddOns: true,
            copySalesPartners: true,
            copyCheckinPoints: true,
            copyMarketing: false,
          }),
        /precisa começar no futuro/,
      );
    } finally {
      await cleanupFixtureEvent(fixture.organization.id);
      await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    }
  });
});
