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
  // ACTIVE não basta: um lote pode continuar com esse status após `endsAt`.
  // O preço público só considera o que ainda é vendável agora.
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

@Injectable()
export class HousesService {
  /**
   * "Casa" é a identidade pública permanente de uma organização na BoraFest.
   * Não criamos uma segunda entidade: Organization continua sendo a fonte de
   * verdade e a agenda nasce dos Event já publicados.
   */
  async listPublicHouses(page = 1, pageSize = 50) {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const where = {
      status: { notIn: ["SUSPENDED", "BLOCKED"] as Array<"SUSPENDED" | "BLOCKED"> },
      events: { some: { status: "PUBLISHED" as const } },
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
          logoUrl: true,
          _count: { select: { followers: true } },
        },
      }),
    ]);

    return {
      total,
      page: safePage,
      pageSize: safePageSize,
      houses: houses.map((house) => ({
        id: house.id,
        slug: house.slug,
        name: house.displayName ?? house.name,
        producerType: house.producerType,
        logoUrl: house.logoUrl,
        followersCount: house._count.followers,
      })),
    };
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
      bio: house.bio,
      logoUrl: house.logoUrl,
      instagramUrl: house.instagramUrl,
      websiteUrl: house.websiteUrl,
      since: house.createdAt,
      followersCount: house._count.followers,
      eventsCount: house._count.events,
      location: eventLocation ?? fallbackVenue,
      heroImageUrl: house.coverUrl ?? events.find((event) => event.bannerUrl)?.bannerUrl ?? null,
      events,
    };
  }
}
