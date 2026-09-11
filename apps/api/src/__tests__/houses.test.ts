import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { HousesService } from "../houses/houses.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let followerId: string | null = null;

const houses = new HousesService();

describe("BoraFest Casa", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 100, priceCents: 5000, feeCents: 500 });
    await prisma.organization.update({
      where: { id: fixture.organization.id },
      data: { displayName: "Casa Teste BoraFest", producerType: "CASA" },
    });

    const venue = await prisma.venue.create({
      data: {
        organizationId: fixture.organization.id,
        name: "Clube Teste",
        city: "Uberlândia",
        state: "MG",
      },
    });
    await prisma.event.update({
      where: { id: fixture.event.id },
      data: { venueId: venue.id, bannerUrl: "https://example.com/banner.jpg" },
    });

    await prisma.ticketLot.create({
      data: {
        ticketTypeId: fixture.ticketType.id,
        name: "Lote expirado",
        priceCents: 100,
        feeCents: 0,
        capacity: 10,
        status: "ACTIVE",
        endsAt: new Date(Date.now() - 60_000),
      },
    });

    const follower = await prisma.user.create({
      data: { email: `casa-follow-${Math.random().toString(36).slice(2)}@example.com` },
    });
    followerId = follower.id;
    await prisma.organizationFollow.create({
      data: { organizationId: fixture.organization.id, userId: follower.id },
    });
  });

  after(async () => {
    await cleanupFixtureEvent(fixture.organization.id);
    if (followerId) await prisma.user.delete({ where: { id: followerId } }).catch(() => undefined);
  });

  it("expõe a organização como perfil permanente com agenda e seguidores", async () => {
    const profile = await houses.getPublicHouse(fixture.organization.slug);

    assert.equal(profile.id, fixture.organization.id);
    assert.equal(profile.name, "Casa Teste BoraFest");
    assert.equal(profile.producerType, "CASA");
    assert.equal(profile.followersCount, 1);
    assert.equal(profile.location?.city, "Uberlândia");
    assert.equal(profile.location?.state, "MG");
    assert.equal(profile.heroImageUrl, "https://example.com/banner.jpg");
    assert.equal(profile.events.length, 1);
    assert.equal(profile.upcomingEventsCount, 1);
    assert.equal(profile.events[0]?.id, fixture.event.id);
    assert.equal(profile.events[0]?.fromPriceCents, 5500);
  });

  it("resolve a URL permanente pelo id da organização", async () => {
    const resolved = await houses.resolvePublicHouseById(fixture.organization.id);
    assert.equal(resolved.slug, fixture.organization.slug);
    assert.equal(resolved.name, "Casa Teste BoraFest");
  });

  it("lista Casa com sinais de descoberta e filtra por cidade", async () => {
    const result = await houses.listPublicHouses(1, 100, "Uberlândia");
    const current = result.houses.find((house) => house.id === fixture.organization.id);
    assert.ok(result.total >= 1);
    assert.ok(current);
    assert.equal(current?.name, "Casa Teste BoraFest");
    assert.equal(current?.followersCount, 1);
    assert.equal(current?.upcomingEventsCount, 1);
    assert.equal(current?.location?.city, "Uberlândia");
    assert.equal(current?.nextEvent?.id, fixture.event.id);

    const outraCidade = await houses.listPublicHouses(1, 100, "São Paulo");
    assert.equal(outraCidade.houses.some((house) => house.id === fixture.organization.id), false);
  });

  it("ranqueia globalmente antes de dividir em páginas", async () => {
    const shallow = await createFixtureEvent({ lotCapacity: 20, priceCents: 2000, feeCents: 200 });
    const deep = await createFixtureEvent({ lotCapacity: 20, priceCents: 2000, feeCents: 200 });
    const city = `Ranking-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const [shallowVenue, deepVenue] = await Promise.all([
        prisma.venue.create({
          data: { organizationId: shallow.organization.id, name: "Casa Rasa", city, state: "MG" },
        }),
        prisma.venue.create({
          data: { organizationId: deep.organization.id, name: "Casa Profunda", city, state: "MG" },
        }),
      ]);
      await Promise.all([
        prisma.event.update({ where: { id: shallow.event.id }, data: { venueId: shallowVenue.id } }),
        prisma.event.update({ where: { id: deep.event.id }, data: { venueId: deepVenue.id } }),
      ]);

      await prisma.event.create({
        data: {
          organizationId: deep.organization.id,
          venueId: deepVenue.id,
          title: "Segundo evento da agenda",
          slug: `ranking-extra-${Math.random().toString(36).slice(2, 10)}`,
          status: "PUBLISHED",
          startsAt: new Date(Date.now() + 7 * 86_400_000),
          endsAt: new Date(Date.now() + 8 * 86_400_000),
          publishedAt: new Date(),
        },
      });

      const firstPage = await houses.listPublicHouses(1, 1, city);
      const secondPage = await houses.listPublicHouses(2, 1, city);

      assert.equal(firstPage.total, 2);
      assert.equal(firstPage.houses[0]?.id, deep.organization.id);
      assert.equal(firstPage.houses[0]?.upcomingEventsCount, 2);
      assert.equal(secondPage.houses[0]?.id, shallow.organization.id);
    } finally {
      await cleanupFixtureEvent(shallow.organization.id);
      await cleanupFixtureEvent(deep.organization.id);
    }
  });

  it("retorna as Casas seguidas com agenda ativa", async () => {
    assert.ok(followerId);
    const result = await houses.listFollowedHouses(followerId!, "Uberlândia");
    const current = result.find((house) => house.id === fixture.organization.id);
    assert.ok(current);
    assert.equal(current?.nextEvent?.id, fixture.event.id);
  });

  it("tira evento vencido da descoberta sem perder a Casa seguida", async () => {
    await prisma.event.update({
      where: { id: fixture.event.id },
      data: { endsAt: new Date(Date.now() - 60_000) },
    });

    const result = await houses.listPublicHouses(1, 100);
    assert.equal(result.houses.some((house) => house.id === fixture.organization.id), false);

    const followed = await houses.listFollowedHouses(followerId!);
    const current = followed.find((house) => house.id === fixture.organization.id);
    assert.ok(current);
    assert.equal(current?.nextEvent, null);
    assert.equal(current?.upcomingEventsCount, 0);

    await prisma.event.update({
      where: { id: fixture.event.id },
      data: { endsAt: fixture.event.endsAt },
    });
  });

  it("não expõe casa bloqueada", async () => {
    await prisma.organization.update({
      where: { id: fixture.organization.id },
      data: { status: "BLOCKED" },
    });

    await assert.rejects(() => houses.getPublicHouse(fixture.organization.slug), /Casa não encontrada/);
    await assert.rejects(() => houses.resolvePublicHouseById(fixture.organization.id), /Casa não encontrada/);

    await prisma.organization.update({
      where: { id: fixture.organization.id },
      data: { status: "ACTIVE" },
    });
  });
});
