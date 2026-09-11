import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";

const publicEventSelect = {
  id: true,
  title: true,
  slug: true,
  bannerUrl: true,
  category: true,
  startsAt: true,
  timezone: true,
  venue: { select: { name: true, city: true, state: true } },
  ticketTypes: {
    select: {
      lots: {
        where: { status: "ACTIVE" as const, pdvOnly: false, promoterOnly: false },
        select: { priceCents: true, feeCents: true, feeMode: true, endsAt: true },
      },
    },
  },
} as const;

function toEventCard(event: {
  id: string;
  title: string;
  slug: string;
  bannerUrl: string | null;
  category: string | null;
  startsAt: Date;
  timezone: string;
  venue: { name: string; city: string; state: string } | null;
  ticketTypes: Array<{
    lots: Array<{ priceCents: number; feeCents: number; feeMode: string; endsAt: Date | null }>;
  }>;
}) {
  const lots = event.ticketTypes.flatMap((type) => type.lots);
  const totals = lots.map((lot) => lot.priceCents + (lot.feeMode !== "PRODUCER" ? lot.feeCents : 0));
  const now = Date.now();
  const futureLotEnds = lots
    .map((lot) => lot.endsAt)
    .filter((date): date is Date => date !== null && date.getTime() > now)
    .sort((a, b) => a.getTime() - b.getTime());

  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    bannerUrl: event.bannerUrl,
    category: event.category,
    startsAt: event.startsAt,
    timezone: event.timezone,
    venue: event.venue,
    fromPriceCents: totals.length > 0 ? Math.min(...totals) : null,
    currentLotEndsAt: futureLotEnds[0] ?? null,
  };
}

@Injectable()
export class HousesService {
  /**
   * "Casa" é a identidade pública permanente de uma organização na BoraFest.
   * Não criamos uma segunda entidade: Organization continua sendo a fonte de
   * verdade e a agenda nasce dos Event já publicados.
   */
  async listPublicHouses() {
    const houses = await prisma.organization.findMany({
      where: {
        status: { notIn: ["SUSPENDED", "BLOCKED"] },
        events: { some: { status: "PUBLISHED" } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        slug: true,
        name: true,
        displayName: true,
        producerType: true,
        _count: { select: { followers: true } },
      },
    });

    return houses.map((house) => ({
      id: house.id,
      slug: house.slug,
      name: house.displayName ?? house.name,
      producerType: house.producerType,
      followersCount: house._count.followers,
    }));
  }

  async resolvePublicHouseById(id: string) {
    const house = await prisma.organization.findFirst({
      where: {
        id,
        status: { notIn: ["SUSPENDED", "BLOCKED"] },
        events: { some: { status: "PUBLISHED" } },
      },
      select: { id: true, slug: true, name: true, displayName: true, producerType: true },
    });
    if (!house) throw new NotFoundException("Casa não encontrada");
    return {
      id: house.id,
      slug: house.slug,
      name: house.displayName ?? house.name,
      producerType: house.producerType,
    };
  }

  async getPublicHouse(slug: string) {
    const now = new Date();
    const house = await prisma.organization.findFirst({
      where: {
        slug,
        status: { notIn: ["SUSPENDED", "BLOCKED"] },
        events: { some: { status: "PUBLISHED" } },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        displayName: true,
        producerType: true,
        createdAt: true,
        _count: { select: { followers: true, events: true } },
        venues: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { name: true, city: true, state: true },
        },
        events: {
          where: { status: "PUBLISHED", endsAt: { gt: now } },
          orderBy: { startsAt: "asc" },
          take: 24,
          select: publicEventSelect,
        },
      },
    });

    if (!house) throw new NotFoundException("Casa não encontrada");

    const events = house.events.map(toEventCard);
    const eventLocation = events.find((event) => event.venue)?.venue ?? null;
    const fallbackVenue = house.venues[0] ?? null;

    return {
      id: house.id,
      slug: house.slug,
      name: house.displayName ?? house.name,
      producerType: house.producerType,
      since: house.createdAt,
      followersCount: house._count.followers,
      eventsCount: house._count.events,
      location: eventLocation ?? fallbackVenue,
      heroImageUrl: events.find((event) => event.bannerUrl)?.bannerUrl ?? null,
      events,
    };
  }
}
