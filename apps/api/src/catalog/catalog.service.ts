import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { computePlatformFeeCents } from "@borafest/payments";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateTicketLotInput, CreateTicketTypeInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";


/** Campos do cartão de vitrine (home/listas) — um só select para lista e home. */
const showcaseSelect = {
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
        where: { status: "ACTIVE" as const },
        select: { priceCents: true, feeCents: true, feeMode: true, endsAt: true },
      },
    },
  },
} as const;

type ShowcaseRow = {
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
};

/** preço honesto (o que o comprador paga) + urgência real (fim do lote ativo). */
function toShowcaseCard(event: ShowcaseRow) {
  const lots = event.ticketTypes.flatMap((type) => type.lots);
  const totals = lots.map(
    (lot) => lot.priceCents + (lot.feeMode !== "PRODUCER" ? lot.feeCents : 0),
  );
  const now = Date.now();
  const ends = lots
    .map((lot) => lot.endsAt)
    .filter((d): d is Date => d !== null && d.getTime() > now)
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
    currentLotEndsAt: ends[0] ?? null,
  };
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly orgAccess: OrgAccessService,
    private readonly inventory: InventoryService,
  ) {}

  private async assertEventAccess(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);
    return event;
  }

  async createTicketType(eventId: string, actorUserId: string, input: CreateTicketTypeInput) {
    await this.assertEventAccess(eventId, actorUserId);

    return prisma.ticketType.create({
      data: {
        eventId,
        name: input.name,
        description: input.description,
        position: input.position,
      },
    });
  }

  async createLot(ticketTypeId: string, actorUserId: string, input: CreateTicketLotInput) {
    const ticketType = await prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
      include: { event: { include: { organization: true } } },
    });
    if (!ticketType) throw new NotFoundException("Tipo de ingresso não encontrado");
    await this.orgAccess.assertPermission(ticketType.event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    // taxa de serviço é da PLATAFORMA, nunca digitada pelo produtor (decisão
    // 2026-08-01): mostrado = cobrado = contabilizado. Ingresso grátis não
    // paga piso.
    const feeCents =
      input.priceCents === 0
        ? 0
        : computePlatformFeeCents("PIX", input.priceCents, ticketType.event.organization);

    return prisma.ticketLot.create({
      data: {
        ticketTypeId,
        name: input.name,
        priceCents: input.priceCents,
        feeCents,
        capacity: input.capacity,
        maxPerOrder: input.maxPerOrder,
        feeMode: input.feeMode ?? "BUYER",
        nominal: input.nominal ?? false,
        halfPriceEnabled: input.halfPriceEnabled ?? false,
        requiresCpf: input.requiresCpf ?? false,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
      },
    });
  }

  async activateLot(lotId: string, actorUserId: string) {
    const lot = await prisma.ticketLot.findUnique({
      where: { id: lotId },
      include: { ticketType: { include: { event: true } } },
    });
    if (!lot) throw new NotFoundException("Lote não encontrado");
    await this.orgAccess.assertPermission(
      lot.ticketType.event.organizationId,
      actorUserId,
      PERMISSIONS.EVENT_CREATE,
    );

    if (lot.status !== "DRAFT" && lot.status !== "SCHEDULED") {
      throw new BadRequestException("Lote não pode ser ativado a partir do estado atual");
    }

    return prisma.ticketLot.update({ where: { id: lotId }, data: { status: "ACTIVE" } });
  }

  /** Encerra as vendas do lote (some do site). Definitivo — crie outro lote se precisar. */
  async closeLot(lotId: string, actorUserId: string) {
    const lot = await prisma.ticketLot.findUnique({
      where: { id: lotId },
      include: { ticketType: { include: { event: true } } },
    });
    if (!lot) throw new NotFoundException("Lote não encontrado");
    await this.orgAccess.assertPermission(
      lot.ticketType.event.organizationId,
      actorUserId,
      PERMISSIONS.EVENT_CREATE,
    );
    if (lot.status === "CLOSED") throw new BadRequestException("Lote já está encerrado");
    return prisma.ticketLot.update({ where: { id: lotId }, data: { status: "CLOSED" } });
  }

  /** Apaga o lote — só sem nenhuma venda/reserva; com movimento, use encerrar. */
  async deleteLot(lotId: string, actorUserId: string) {
    const lot = await prisma.ticketLot.findUnique({
      where: { id: lotId },
      include: { ticketType: { include: { event: true } } },
    });
    if (!lot) throw new NotFoundException("Lote não encontrado");
    await this.orgAccess.assertPermission(
      lot.ticketType.event.organizationId,
      actorUserId,
      PERMISSIONS.EVENT_CREATE,
    );
    if (lot.soldCount > 0) {
      throw new BadRequestException("Lote já tem vendas — encerre as vendas em vez de apagar");
    }
    if (lot.reservedCount > 0) {
      throw new BadRequestException("Há reservas em andamento neste lote — tente de novo em alguns minutos");
    }
    try {
      await prisma.ticketLot.delete({ where: { id: lotId } });
    } catch {
      // FK (pedido/ingresso/lista antiga apontando pro lote): não dá para apagar com histórico
      throw new BadRequestException("Lote tem histórico vinculado — encerre as vendas em vez de apagar");
    }
    return { deleted: true };
  }

  /**
   * Cidades que TÊM evento publicado e futuro — alimenta o seletor de
   * localização da home (decisão 2026-07-30: mostrar o que existe de fato na
   * cidade, nunca uma localização fixa/aleatória).
   */
  async listPublicCities() {
    const venues = await prisma.event.findMany({
      where: { status: "PUBLISHED", endsAt: { gt: new Date() }, venueId: { not: null } },
      select: { venue: { select: { city: true, state: true } } },
      distinct: ["venueId"],
    });
    const unique = new Map<string, { city: string; state: string }>();
    for (const item of venues) {
      if (!item.venue) continue;
      unique.set(`${item.venue.city}|${item.venue.state}`, item.venue);
    }
    return [...unique.values()].sort((a, b) => a.city.localeCompare(b.city, "pt-BR"));
  }

  /** Descoberta de eventos (Fase 12): lista eventos publicados, futuros primeiro. */
  async listPublicEvents(options: { page: number; pageSize: number; city?: string; category?: string }) {
    const where = {
      status: "PUBLISHED" as const,
      endsAt: { gt: new Date() },
      ...(options.city
        ? { venue: { is: { city: { equals: options.city, mode: "insensitive" as const } } } }
        : {}),
      ...(options.category ? { category: options.category as never } : {}),
    };

    const [total, events] = await Promise.all([
      prisma.event.count({ where }),
      prisma.event.findMany({
        where,
        orderBy: { startsAt: "asc" },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
        select: showcaseSelect,
      }),
    ]);

    return {
      total,
      page: options.page,
      pageSize: options.pageSize,
      events: events.map(toShowcaseCard),
    };
  }


  /**
   * Home viva (decisão 2026-08-08): Em alta por PLACAR DE VENDAS com peso na
   * noite — pontos = vendas 24h × 3 + vendas 7 dias × 1 — e prateleiras por
   * categoria que só nascem com densidade (3+ eventos). Regras de
   * honestidade: Em alta só existe com 2+ eventos vendendo de verdade;
   * prateleira rala devolve os eventos para "Próximos".
   */
  async getHomeSections(city?: string) {
    const where = {
      status: "PUBLISHED" as const,
      endsAt: { gt: new Date() },
      ...(city
        ? { venue: { is: { city: { equals: city, mode: "insensitive" as const } } } }
        : {}),
    };
    const rows = await prisma.event.findMany({
      where,
      orderBy: { startsAt: "asc" },
      take: 200,
      select: showcaseSelect,
    });
    const events = rows.map(toShowcaseCard);
    const ids = events.map((e) => e.id);

    const now = Date.now();
    const soldSince = async (since: Date) => {
      const grouped = await prisma.ticket.groupBy({
        by: ["eventId"],
        where: {
          eventId: { in: ids },
          issuedAt: { gte: since },
          status: { notIn: ["CANCELED", "REFUNDED"] },
        },
        _count: { eventId: true },
      });
      return new Map(grouped.map((g) => [g.eventId, g._count.eventId]));
    };
    const [sold24h, sold7d] = ids.length
      ? await Promise.all([
          soldSince(new Date(now - 24 * 3600_000)),
          soldSince(new Date(now - 7 * 24 * 3600_000)),
        ])
      : [new Map<string, number>(), new Map<string, number>()];

    const score = (id: string) => (sold24h.get(id) ?? 0) * 3 + (sold7d.get(id) ?? 0);
    const comVenda = events.filter((e) => score(e.id) > 0);
    // Em alta honesto: precisa de 2+ eventos com venda real na janela
    const highlights =
      comVenda.length >= 2
        ? [...comVenda].sort((a, b) => score(b.id) - score(a.id)).slice(0, 8)
        : [];

    // prateleiras: categoria com 3+ eventos ativos; ordenadas por procura
    const porCategoria = new Map<string, typeof events>();
    for (const event of events) {
      if (!event.category) continue;
      const lista = porCategoria.get(event.category) ?? [];
      lista.push(event);
      porCategoria.set(event.category, lista);
    }
    const shelves = [...porCategoria.entries()]
      .filter(([, lista]) => lista.length >= 3)
      .map(([category, lista]) => ({
        category,
        events: [...lista]
          .sort((a, b) => score(b.id) - score(a.id) || +a.startsAt - +b.startsAt)
          .slice(0, 8),
      }))
      .sort(
        (a, b) =>
          b.events.reduce((s, e) => s + score(e.id), 0) -
          a.events.reduce((s, e) => s + score(e.id), 0),
      );

    // remanescente: quem não ganhou prateleira segue na lista geral
    const emPrateleira = new Set(shelves.flatMap((shelf) => shelf.events.map((e) => e.id)));
    const upcoming = shelves.length
      ? events.filter((e) => !emPrateleira.has(e.id))
      : events;

    return { highlights, shelves, upcoming };
  }

  async getPublicEvent(slug: string) {
    const event = await prisma.event.findFirst({
      where: { slug, status: "PUBLISHED" },
      include: {
        venue: true,
        organization: { select: { id: true, name: true, displayName: true, slug: true } },
        ticketTypes: {
          orderBy: { position: "asc" },
          include: {
            lots: {
              where: { status: "ACTIVE" },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        addOns: {
          where: { active: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!event) throw new NotFoundException("Evento não encontrado");
    // público vê o nome comercial; o nome civil/razão social nem trafega
    const { displayName, ...organization } = event.organization;
    return {
      ...event,
      organization: { ...organization, name: displayName ?? organization.name },
    };
  }

  async getPublicAvailability(slug: string) {
    const event = await this.getPublicEvent(slug);

    return Promise.all(
      event.ticketTypes.flatMap((type) =>
        type.lots.map(async (lot) => {
          const availability = await this.inventory.getAvailability(lot.id);
          return {
            ticketTypeId: type.id,
            ticketTypeName: type.name,
            lotId: lot.id,
            lotName: lot.name,
            priceCents: lot.priceCents,
            feeCents: lot.feeCents,
            halfPriceEnabled: lot.halfPriceEnabled,
            available: availability?.available ?? 0,
          };
        }),
      ),
    );
  }
}
