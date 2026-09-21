import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { computePlatformFeeCents } from "@borafest/payments";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateTicketLotInput, CreateTicketTypeInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";


function excludedPublicOrganizationSlugs(): string[] {
  return (process.env.PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
}

function publicCatalogOrganizationFilter() {
  const excluded = excludedPublicOrganizationSlugs();
  return excluded.length > 0
    ? { organization: { is: { slug: { notIn: excluded } } } }
    : {};
}

function publicOrganizationFilter() {
  const excluded = excludedPublicOrganizationSlugs();
  return excluded.length > 0 ? { slug: { notIn: excluded } } : {};
}

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
  organization: { select: { name: true, displayName: true, slug: true } },
  lineup: true,
  ticketTypes: {
    select: {
      lots: {
        where: { status: { in: ["ACTIVE", "SOLD_OUT"] as const }, pdvOnly: false, promoterOnly: false },
        select: { status: true, priceCents: true, feeCents: true, feeMode: true, startsAt: true, endsAt: true },
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
  organization: { name: string; displayName: string | null; slug: string };
  lineup: string | null;
  ticketTypes: Array<{
    lots: Array<{ status: string; priceCents: number; feeCents: number; feeMode: string; startsAt: Date | null; endsAt: Date | null }>;
  }>;
};

/** preço honesto (o que o comprador paga) + urgência real (fim do lote ativo). */
function toShowcaseCard(event: ShowcaseRow) {
  const now = Date.now();
  const lots = event.ticketTypes
    .flatMap((type) => type.lots)
    .filter(
      (lot) =>
        (!lot.startsAt || lot.startsAt.getTime() <= now) &&
        (!lot.endsAt || lot.endsAt.getTime() > now),
    );
  const sellableLots = lots.filter((lot) => lot.status === "ACTIVE");
  const totals = sellableLots.map(
    (lot) => lot.priceCents + (lot.feeMode !== "PRODUCER" ? lot.feeCents : 0),
  );
  const ends = sellableLots
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
    organization: {
      name: event.organization.displayName ?? event.organization.name,
      slug: event.organization.slug,
    },
    lineup: event.lineup,
    fromPriceCents: totals.length > 0 ? Math.min(...totals) : null,
    currentLotEndsAt: ends[0] ?? null,
  };
}

@Injectable()
export class CatalogService {
  /**
   * Micro-cache em memória (perf 2026-08-30): as rotas públicas já declaram
   * frescor de 5s no Cache-Control, mas o SERVIDOR recomputava tudo em cada
   * request (home/sections: 200 eventos + 2 groupBy = ~2s). Mesmo TTL que o
   * produto já prometeu ao cliente — zero mudança de semântica. Instância
   * única hoje; com réplicas cada uma tem o seu (aceitável p/ TTLs curtos).
   */
  private readonly microCache = new Map<string, { ate: number; valor: Promise<unknown> }>();

  private async lembrado<T>(chave: string, ttlMs: number, calcula: () => Promise<T>): Promise<T> {
    // testes exercitam frescor de propósito (cria → lê → edita → relê em ms);
    // cache ali só produz flakiness — produção segue com o TTL normal
    if (process.env.NODE_ENV === "test") return calcula();
    const agora = Date.now();
    const hit = this.microCache.get(chave);
    if (hit && hit.ate > agora) return hit.valor as Promise<T>;
    // memoiza a PROMISE na hora do miss (achado 2026-09-01): sem isso, todo
    // request concorrente na expiração recomputava o cálculo pesado em paralelo
    const valor = calcula();
    this.microCache.set(chave, { ate: agora + ttlMs, valor });
    valor.catch(() => this.microCache.delete(chave)); // erro não fica cacheado
    if (this.microCache.size > 500) {
      for (const [k, v] of this.microCache) if (v.ate <= agora) this.microCache.delete(k);
    }
    return valor;
  }

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
        pdvOnly: input.pdvOnly ?? false,
        promoterOnly: input.promoterOnly ?? false,
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
    if (lot.endsAt && lot.endsAt.getTime() <= Date.now()) {
      throw new BadRequestException("Atualize o término do lote antes de ativar as vendas");
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
      where: {
        status: "PUBLISHED",
        endsAt: { gt: new Date() },
        venueId: { not: null },
        ...publicCatalogOrganizationFilter(),
      },
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

  /**
   * Autocomplete público. Mantém a resposta pequena e separa entidades para a
   * UI não precisar adivinhar se o texto é evento, Casa ou atração.
   */
  async getSearchSuggestions(rawQuery: string, city?: string) {
    const query = rawQuery.trim().slice(0, 80);
    if (query.length < 2) return { events: [], houses: [], attractions: [] };

    const now = new Date();
    const cityEventFilter = city
      ? { venue: { is: { city: { equals: city, mode: "insensitive" as const } } } }
      : {};

    const publicEventBase = {
      status: "PUBLISHED" as const,
      endsAt: { gt: now },
      ...publicCatalogOrganizationFilter(),
      ...cityEventFilter,
    };

    const [eventRows, houseRows, attractionRows] = await Promise.all([
      prisma.event.findMany({
        where: {
          ...publicEventBase,
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { lineup: { contains: query, mode: "insensitive" } },
            { venue: { is: { name: { contains: query, mode: "insensitive" } } } },
            { venue: { is: { city: { contains: query, mode: "insensitive" } } } },
            { organization: { is: { name: { contains: query, mode: "insensitive" } } } },
            { organization: { is: { displayName: { contains: query, mode: "insensitive" } } } },
          ],
        },
        orderBy: { startsAt: "asc" },
        take: 5,
        select: showcaseSelect,
      }),
      prisma.organization.findMany({
        where: {
          status: { notIn: ["SUSPENDED", "BLOCKED"] },
          ...publicOrganizationFilter(),
          events: {
            some: {
              status: "PUBLISHED",
              endsAt: { gt: now },
              ...(city
                ? { venue: { is: { city: { equals: city, mode: "insensitive" } } } }
                : {}),
            },
          },
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { displayName: { contains: query, mode: "insensitive" } },
            { bio: { contains: query, mode: "insensitive" } },
            { venues: { some: { name: { contains: query, mode: "insensitive" } } } },
            { venues: { some: { city: { contains: query, mode: "insensitive" } } } },
            {
              events: {
                some: {
                  status: "PUBLISHED",
                  endsAt: { gt: now },
                  OR: [
                    { title: { contains: query, mode: "insensitive" } },
                    { lineup: { contains: query, mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
        },
        orderBy: [{ displayName: "asc" }, { name: "asc" }],
        take: 5,
        select: {
          id: true,
          slug: true,
          name: true,
          displayName: true,
          logoUrl: true,
          venues: {
            ...(city
              ? { where: { city: { equals: city, mode: "insensitive" as const } } }
              : {}),
            take: 1,
            orderBy: { createdAt: "desc" as const },
            select: { city: true, state: true },
          },
        },
      }),
      prisma.event.findMany({
        where: {
          ...publicEventBase,
          lineup: { contains: query, mode: "insensitive" },
        },
        orderBy: { startsAt: "asc" },
        take: 12,
        select: {
          slug: true,
          title: true,
          lineup: true,
          organization: { select: { name: true, displayName: true } },
        },
      }),
    ]);

    const normalized = query
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const seenAttractions = new Set<string>();
    const attractions: Array<{
      name: string;
      eventSlug: string;
      eventTitle: string;
      houseName: string;
    }> = [];

    for (const row of attractionRows) {
      for (const rawName of (row.lineup ?? "").split("\n")) {
        const name = rawName.trim();
        if (!name) continue;
        const searchable = name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        if (!searchable.includes(normalized)) continue;
        const key = searchable;
        if (seenAttractions.has(key)) continue;
        seenAttractions.add(key);
        attractions.push({
          name,
          eventSlug: row.slug,
          eventTitle: row.title,
          houseName: row.organization.displayName ?? row.organization.name,
        });
        if (attractions.length >= 6) break;
      }
      if (attractions.length >= 6) break;
    }

    return {
      events: eventRows.map(toShowcaseCard),
      houses: houseRows.map((house) => ({
        id: house.id,
        slug: house.slug,
        name: house.displayName ?? house.name,
        logoUrl: house.logoUrl,
        location: house.venues[0] ?? null,
      })),
      attractions,
    };
  }

  /** Descoberta de eventos (Fase 12): lista eventos publicados, futuros primeiro. */
  async listPublicEvents(options: { page: number; pageSize: number; city?: string; category?: string; query?: string }) {
    const chave = `evlist:${options.page}:${options.pageSize}:${options.city ?? ""}:${options.category ?? ""}:${options.query ?? ""}`;
    return this.lembrado(chave, 5_000, () => this.listPublicEventsFresco(options));
  }

  private async listPublicEventsFresco(options: { page: number; pageSize: number; city?: string; category?: string; query?: string }) {
    const query = options.query?.trim();
    const where = {
      status: "PUBLISHED" as const,
      endsAt: { gt: new Date() },
      ...publicCatalogOrganizationFilter(),
      ...(options.city
        ? { venue: { is: { city: { equals: options.city, mode: "insensitive" as const } } } }
        : {}),
      ...(options.category ? { category: options.category as never } : {}),
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" as const } },
              { lineup: { contains: query, mode: "insensitive" as const } },
              { venue: { is: { name: { contains: query, mode: "insensitive" as const } } } },
              { venue: { is: { city: { contains: query, mode: "insensitive" as const } } } },
              { organization: { is: { name: { contains: query, mode: "insensitive" as const } } } },
              { organization: { is: { displayName: { contains: query, mode: "insensitive" as const } } } },
              { organization: { is: { slug: { contains: query, mode: "insensitive" as const } } } },
            ],
          }
        : {}),
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
    return this.lembrado(`home:sections:${city ?? "all"}`, 60_000, () => this.getHomeSectionsFresco(city));
  }

  private async getHomeSectionsFresco(city?: string) {
    const where = {
      status: "PUBLISHED" as const,
      endsAt: { gt: new Date() },
      ...publicCatalogOrganizationFilter(),
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

  async getPublicEvent(slug: string, promoterSlug?: string, sellerSlug?: string) {
    // cache por (evento + promoter/vendedor): quem chega por link exclusivo vê
    // uma lista diferente de lotes; nunca compartilhar com o público geral.
    return this.lembrado(`ev:${slug}:${promoterSlug ?? "-"}:${sellerSlug ?? "-"}`, 5_000, () =>
      this.getPublicEventFresco(slug, promoterSlug, sellerSlug),
    );
  }

  private async getPublicEventFresco(slug: string, promoterSlug?: string, sellerSlug?: string) {
    const event = await prisma.event.findFirst({
      where: {
        slug,
        status: "PUBLISHED",
        ...publicCatalogOrganizationFilter(),
      },
      include: {
        venue: true,
        organization: { select: { id: true, name: true, displayName: true, slug: true } },
        ticketTypes: {
          orderBy: { position: "asc" },
          include: {
            lots: {
              // só-balcão fica invisível pro público (cortesia via promoter)
              where: {
                status: { in: ["ACTIVE", "SOLD_OUT"] },
                pdvOnly: false,
                AND: [
                  { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
                  { OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
                ],
              },
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

    // LOTE EXCLUSIVO DO PROMOTER: fica de fora, a menos que o visitante tenha
    // chegado pelo link de um promoter ATIVO desta casa (e deste evento, se o
    // vínculo tiver escopo). Slug inválido ou de outra casa não revela nada —
    // falha fechada.
    const sellerValido = sellerSlug
      ? await prisma.promoterSeller.findFirst({
          where: {
            slug: sellerSlug,
            status: "ACTIVE",
            promoterLink: {
              organizationId: event.organizationId,
              status: "ACTIVE",
              OR: [{ eventId: null }, { eventId: event.id }],
            },
          },
          select: { id: true },
        })
      : null;
    const promoterValido = !sellerValido && promoterSlug
      ? await prisma.promoterLink.findFirst({
          where: {
            slug: promoterSlug,
            status: "ACTIVE",
            organizationId: event.organizationId,
            OR: [{ eventId: null }, { eventId: event.id }],
          },
          select: { id: true },
        })
      : null;
    if (!promoterValido && !sellerValido) {
      event.ticketTypes = event.ticketTypes.map((tt) => ({
        ...tt,
        lots: tt.lots.filter((l) => !l.promoterOnly),
      }));
    }
    // público vê o nome comercial; o nome civil/razão social nem trafega
    const { displayName, ...organization } = event.organization;
    // esta consulta usa `include`, então devolve TODOS os campos do evento —
    // o token da API de Conversões é segredo e sai daqui explicitamente
    const { metaCapiToken: _segredo, ...publico } = event;
    return {
      ...publico,
      organization: { ...organization, name: displayName ?? organization.name },
    };
  }

  async getPublicAvailability(slug: string) {
    // SEM micro-cache aqui (achado 2026-09-01): esta rota é o estoque em tempo
    // real do seletor de ingressos — 5s velho perto do esgotamento mostraria
    // vaga que não existe. O ganho anti-N+1 continua (conta dos lotes abaixo).
    const event = await this.getPublicEventFresco(slug);

    // perf 2026-08-30: era 1 findUnique POR LOTE (N+1) rebuscando linhas que o
    // getPublicEvent JÁ trouxe — capacity/soldCount/reservedCount estão nos
    // próprios lotes retornados. Mesma conta do InventoryService, zero query extra.
    return event.ticketTypes.flatMap((type) =>
      type.lots.map((lot) => ({
        ticketTypeId: type.id,
        ticketTypeName: type.name,
        lotId: lot.id,
        lotName: lot.name,
        priceCents: lot.priceCents,
        feeCents: lot.feeCents,
        halfPriceEnabled: lot.halfPriceEnabled,
        available: Math.max(lot.capacity - lot.soldCount - lot.reservedCount, 0),
      })),
    );
  }
}
