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
  const now = Date.now();
  const lots = event.ticketTypes
    .flatMap((type) => type.lots)
    .filter((lot) => lot.endsAt === null || lot.endsAt.getTime() > now);
  const totals = lots.map((lot) => lot.priceCents + (lot.feeMode !== "PRODUCER" ? lot.feeCents : 0));
  const futureLotEnds = lots
    .map((lot) => lot.endsAt)
    .filter((date): date is Date => date !== null)
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

type DiscoveryHouse = {
  id: string;
  slug: string;
  name: string;
  displayName: string | null;
  producerType: string | null;
  bio: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  _count: { followers: number; events: number };
  venues: Array<{ name: string; city: string; state: string }>;
  events: Array<Parameters<typeof toEventCard>[0]>;
};

function toHouseCard(house: DiscoveryHouse) {
  const nextEvent = house.events[0] ? toEventCard(house.events[0]) : null;
  const location = nextEvent?.venue ?? house.venues[0] ?? null;
  return {
    id: house.id,
    slug: house.slug,
    name: house.displayName ?? house.name,
    producerType: house.producerType,
    bio: house.bio,
    logoUrl: house.logoUrl,
    coverUrl: house.coverUrl,
    heroImageUrl: house.coverUrl ?? nextEvent?.bannerUrl ?? null,
    followersCount: house._count.followers,
    upcomingEventsCount: house._count.events,
    location,
    nextEvent,
  };
}

@Injectable()
export class HousesService {
  /**
   * Vitrine de Casas: só entra quem tem ao menos um evento publicado que ainda
   * não terminou. Assim uma festa antiga não mantém uma Casa artificialmente
   * em destaque meses depois.
   */
  async listPublicHouses(page = 1, pageSize = 50, city?: string) {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const now = new Date();
    const eventWhere = {
      status: "PUBLISHED" as const,
      endsAt: { gt: now },
      ...(city ? { venue: { city } } : {}),
    };
    const where = {
      status: { notIn: ["SUSPENDED", "BLOCKED"] as Array<"SUSPENDED" | "BLOCKED"> },
      events: { some: eventWhere },
    };

    const [total, houses] = await Promise.all([
      prisma.organization.count({ where }),
      prisma.organization.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        select: {
          id: true,
          slug: true,
          name: true,
          displayName: true,
          producerType: true,
          bio: true,
          logoUrl: true,
          coverUrl: true,
          _count: {
            select: {
              followers: true,
              events: { where: eventWhere },
            },
          },
          venues: {
            ...(city ? { where: { city } } : {}),
            orderBy: { createdAt: "desc" as const },
            take: 1,
            select: { name: true, city: true, state: true },
          },
          events: {
            where: eventWhere,
            orderBy: { startsAt: "asc" as const },
            take: 1,
            select: publicEventSelect,
          },
        },
      }),
    ]);

    // Dentro da página, usa sinais reais: primeiro audiência já conquistada,
    // depois profundidade da agenda e, por fim, o próximo evento mais cedo.
    const cards = houses.map((house) => toHouseCard(house as DiscoveryHouse));
    cards.sort((a, b) => {
      if (b.followersCount !== a.followersCount) return b.followersCount - a.followersCount;
      if (b.upcomingEventsCount !== a.upcomingEventsCount) return b.upcomingEventsCount - a.upcomingEventsCount;
      const aDate = a.nextEvent ? new Date(a.nextEvent.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDate = b.nextEvent ? new Date(b.nextEvent.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aDate - bDate;
    });

    return { total, page: safePage, pageSize: safePageSize, houses: cards };
  }

  /** Casas seguidas pelo comprador, já filtradas para agenda futura. */
  async listFollowedHouses(userId: string, city?: string) {
    const now = new Date();
    const eventWhere = {
      status: "PUBLISHED" as const,
      endsAt: { gt: now },
      ...(city ? { venue: { city } } : {}),
    };
    const houses = await prisma.organization.findMany({
      where: {
        status: { notIn: ["SUSPENDED", "BLOCKED"] },
        followers: { some: { userId } },
        events: { some: eventWhere },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        displayName: true,
        producerType: true,
        bio: true,
        logoUrl: true,
        coverUrl: true,
        _count: {
          select: {
            followers: true,
            events: { where: eventWhere },
          },
        },
        venues: {
          ...(city ? { where: { city } } : {}),
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { name: true, city: true, state: true },
        },
        events: {
          where: eventWhere,
          orderBy: { startsAt: "asc" },
          take: 1,
          select: publicEventSelect,
        },
      },
    });

    return houses
      .map((house) => toHouseCard(house as DiscoveryHouse))
      .sort((a, b) => {
        const aDate = a.nextEvent ? new Date(a.nextEvent.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bDate = b.nextEvent ? new Date(b.nextEvent.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
        return aDate - bDate;
      });
  }

  /** Resolução leve usada na página do evento para descobrir a URL permanente. */
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
        bio: true,
        logoUrl: true,
        coverUrl: true,
        instagramUrl: true,
        websiteUrl: true,
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
          take: 100,
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
      bio: house.bio,
      logoUrl: house.logoUrl,
      instagramUrl: house.instagramUrl,
      websiteUrl: house.websiteUrl,
      since: house.createdAt,
      followersCount: house._count.followers,
      eventsCount: house._count.events,
      upcomingEventsCount: events.length,
      location: eventLocation ?? fallbackVenue,
      heroImageUrl: house.coverUrl ?? events.find((event) => event.bannerUrl)?.bannerUrl ?? null,
      events,
    };
  }
}
