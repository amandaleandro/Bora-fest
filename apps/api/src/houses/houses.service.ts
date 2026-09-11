import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma, Prisma } from "@borafest/database";

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

function compareDiscoveryRank(
  a: ReturnType<typeof toHouseCard>,
  b: ReturnType<typeof toHouseCard>,
) {
  if (b.followersCount !== a.followersCount) return b.followersCount - a.followersCount;
  if (b.upcomingEventsCount !== a.upcomingEventsCount) return b.upcomingEventsCount - a.upcomingEventsCount;
  const aDate = a.nextEvent ? new Date(a.nextEvent.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
  const bDate = b.nextEvent ? new Date(b.nextEvent.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (aDate !== bDate) return aDate - bDate;
  return a.id.localeCompare(b.id);
}

@Injectable()
export class HousesService {
  /**
   * Descoberta pública paginada. O PostgreSQL calcula o ranking completo e só
   * devolve as IDs da página pedida; depois o Prisma busca os dados ricos apenas
   * dessas Casas. Assim ranking e paginação continuam consistentes sem carregar
   * toda a vitrine na memória da API.
   */
  async listPublicHouses(page = 1, pageSize = 50, city?: string, query?: string) {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const offset = (safePage - 1) * safePageSize;
    const now = new Date();
    const normalizedQuery = query?.trim();
    const pattern = normalizedQuery ? `%${normalizedQuery}%` : null;
    const eventWhere = {
      status: "PUBLISHED" as const,
      endsAt: { gt: now },
      ...(city ? { venue: { city } } : {}),
    };
    const searchWhere = normalizedQuery
      ? {
          OR: [
            { name: { contains: normalizedQuery, mode: "insensitive" as const } },
            { displayName: { contains: normalizedQuery, mode: "insensitive" as const } },
            { bio: { contains: normalizedQuery, mode: "insensitive" as const } },
            {
              venues: {
                some: {
                  OR: [
                    { name: { contains: normalizedQuery, mode: "insensitive" as const } },
                    { city: { contains: normalizedQuery, mode: "insensitive" as const } },
                    { state: { contains: normalizedQuery, mode: "insensitive" as const } },
                  ],
                },
              },
            },
            {
              events: {
                some: {
                  ...eventWhere,
                  title: { contains: normalizedQuery, mode: "insensitive" as const },
                },
              },
            },
          ],
        }
      : {};
    const where = {
      status: { notIn: ["SUSPENDED", "BLOCKED"] as Array<"SUSPENDED" | "BLOCKED"> },
      events: { some: eventWhere },
      ...searchWhere,
    };

    const cityJoin = city
      ? Prisma.sql`JOIN venues ev ON ev.id = e.venue_id AND ev.city = ${city}`
      : Prisma.sql``;
    const eventSearchCityJoin = city
      ? Prisma.sql`JOIN venues sev ON sev.id = se.venue_id AND sev.city = ${city}`
      : Prisma.sql``;
    const searchSql = pattern
      ? Prisma.sql`
          AND (
            o.name ILIKE ${pattern}
            OR o.display_name ILIKE ${pattern}
            OR o.bio ILIKE ${pattern}
            OR EXISTS (
              SELECT 1
              FROM venues sv
              WHERE sv.organization_id = o.id
                AND (sv.name ILIKE ${pattern} OR sv.city ILIKE ${pattern} OR sv.state ILIKE ${pattern})
            )
            OR EXISTS (
              SELECT 1
              FROM events se
              ${eventSearchCityJoin}
              WHERE se.organization_id = o.id
                AND se.status = 'PUBLISHED'::"EventStatus"
                AND se.ends_at > ${now}
                AND se.title ILIKE ${pattern}
            )
          )
        `
      : Prisma.sql``;

    const [total, ranked] = await Promise.all([
      prisma.organization.count({ where }),
      prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT o.id
        FROM organizations o
        JOIN events e
          ON e.organization_id = o.id
          AND e.status = 'PUBLISHED'::"EventStatus"
          AND e.ends_at > ${now}
        ${cityJoin}
        LEFT JOIN organization_follows f ON f.organization_id = o.id
        WHERE o.status NOT IN ('SUSPENDED'::"OrganizationStatus", 'BLOCKED'::"OrganizationStatus")
        ${searchSql}
        GROUP BY o.id
        ORDER BY
          COUNT(DISTINCT f.id) DESC,
          COUNT(DISTINCT e.id) DESC,
          MIN(e.starts_at) ASC,
          o.id ASC
        LIMIT ${safePageSize}
        OFFSET ${offset}
      `),
    ]);

    const rankedIds = ranked.map((row) => row.id);
    if (rankedIds.length === 0) {
      return { total, page: safePage, pageSize: safePageSize, houses: [] };
    }

    const details = await prisma.organization.findMany({
      where: { id: { in: rankedIds } },
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
    });

    const byId = new Map(details.map((house) => [house.id, toHouseCard(house as DiscoveryHouse)]));
    return {
      total,
      page: safePage,
      pageSize: safePageSize,
      houses: rankedIds.map((id) => byId.get(id)).filter((house): house is NonNullable<typeof house> => Boolean(house)),
    };
  }

  /**
   * O vínculo "seguir" é permanente: a Casa continua aqui mesmo entre duas
   * temporadas sem evento. Quando há cidade escolhida, usamos a localização da
   * Casa ou a agenda futura naquela cidade para decidir se ela pertence ao recorte.
   */
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
        ...(city
          ? {
              OR: [
                { events: { some: eventWhere } },
                { venues: { some: { city } } },
              ],
            }
          : {}),
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
        if (a.nextEvent && !b.nextEvent) return -1;
        if (!a.nextEvent && b.nextEvent) return 1;
        return compareDiscoveryRank(a, b);
      });
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
        bio: true,
        logoUrl: true,
        coverUrl: true,
        instagramUrl: true,
        websiteUrl: true,
        createdAt: true,
        _count: { select: { followers: true } },
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

    const [publishedEventsCount, upcomingEventsCount] = await Promise.all([
      prisma.event.count({ where: { organizationId: house.id, status: "PUBLISHED" } }),
      prisma.event.count({ where: { organizationId: house.id, status: "PUBLISHED", endsAt: { gt: now } } }),
    ]);
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
      eventsCount: publishedEventsCount,
      upcomingEventsCount,
      location: eventLocation ?? fallbackVenue,
      heroImageUrl: house.coverUrl ?? events.find((event) => event.bannerUrl)?.bannerUrl ?? null,
      events,
    };
  }
}
