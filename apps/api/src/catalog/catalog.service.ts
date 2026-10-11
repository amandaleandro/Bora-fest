import { randomBytes } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { computePlatformFeeCents } from "@borafest/payments";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateTicketLotInput, CreateTicketTypeInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { abaixoDoMinimoOnline, emReais, minimoDaCobrancaCents } from "../common/minimo-cobranca";


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
        where: { status: "ACTIVE" as const, pdvOnly: false, promoterOnly: false, inviteMode: "NONE" as const },
        select: {
          priceCents: true,
          feeCents: true,
          feeMode: true,
          endsAt: true,
          // estoque (2026-10-11): o card só anuncia lote que ainda dá pra pegar
          capacity: true,
          soldCount: true,
          reservedCount: true,
        },
      },
    },
  },
} as const;

/**
 * Lote que ainda dá pra pegar (2026-10-11): nada no sistema passa o lote para
 * "esgotado" — ele segue ACTIVE com o estoque zerado. Mesma conta da reserva
 * (InventoryService) e do "Esgotado" do seletor: o reservado também ocupa vaga.
 */
function loteComEstoque(lot: { capacity: number; soldCount: number; reservedCount: number }): boolean {
  return lot.capacity - lot.soldCount - lot.reservedCount > 0;
}

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
    lots: Array<{
      priceCents: number;
      feeCents: number;
      feeMode: string;
      endsAt: Date | null;
      capacity: number;
      soldCount: number;
      reservedCount: number;
    }>;
  }>;
};

/** preço honesto (o que o comprador paga) + urgência real (fim do lote ativo). */
function toShowcaseCard(event: ShowcaseRow) {
  // ESGOTADO FORA DO CARD (2026-10-11): o card seguia dizendo "Grátis" (ou "a
  // partir de R$ 20") depois que aquele lote acabava. Só lote com estoque entra
  // no preço e no "lote atual termina em". Tudo esgotado = sem preço (null),
  // que o site já mostra como card sem preço.
  const lots = event.ticketTypes.flatMap((type) => type.lots).filter(loteComEstoque);
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

    // DISPONIBILIDADE (2026-10-10): um lote tem UM jeito de ser restrito —
    // só balcão, exclusivo do promoter ou link de convidado. Dois ao mesmo
    // tempo não têm leitura possível pra quem compra.
    const inviteMode = input.inviteMode ?? "NONE";
    const restricoes = [input.pdvOnly, input.promoterOnly, inviteMode !== "NONE"].filter(Boolean).length;
    if (restricoes > 1) {
      throw new BadRequestException("Escolha só uma forma de disponibilidade para o lote");
    }

    // MÍNIMO DO PAGAMENTO ONLINE (2026-10-11): o painel aceitava lote de R$ 3 e
    // ninguém conseguia comprar — o pedido travava no "Gerar Pix". Barra na
    // origem o que o comprador paga por 1 ingresso (preço + taxa se ele paga a
    // taxa; só o preço se o produtor absorve) e, com meia, a meia também. Lote
    // só de balcão fica de fora: na porta tem dinheiro, sem banco no meio.
    if (input.priceCents > 0 && !input.pdvOnly) {
      const minimo = minimoDaCobrancaCents();
      const taxaDoComprador = (input.feeMode ?? "BUYER") === "PRODUCER" ? 0 : feeCents;
      const inteira = input.priceCents + taxaDoComprador;
      if (abaixoDoMinimoOnline(inteira)) {
        throw new BadRequestException(
          `Ingresso pago precisa sair por pelo menos ${emReais(minimo)} para o comprador (mínimo que o banco aceita) — este sairia por ${emReais(inteira)}. Para dar de graça, use R$ 0.`,
        );
      }
      // meia = metade do preço com a taxa cheia, a mesma conta da reserva
      const meia = Math.round(input.priceCents / 2) + taxaDoComprador;
      if (input.halfPriceEnabled && abaixoDoMinimoOnline(meia)) {
        throw new BadRequestException(
          `A meia-entrada sairia por ${emReais(meia)} para o comprador, abaixo do mínimo de ${emReais(minimo)} que o banco aceita. Aumente o preço do lote ou desmarque a meia-entrada.`,
        );
      }
    }

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
        // lote grátis não tem meia (2026-10-11): metade de zero só faria a porta pedir documento à toa
        halfPriceEnabled: input.priceCents > 0 ? (input.halfPriceEnabled ?? false) : false,
        pdvOnly: input.pdvOnly ?? false,
        promoterOnly: input.promoterOnly ?? false,
        inviteMode,
        inviteToken: inviteMode === "LINK" ? novoCodigoDeConvite() : undefined,
        limitPerCpf: input.limitPerCpf,
        requiresCpf: input.requiresCpf ?? false,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
      },
    });
  }

  /** Troca o código do link de convidado: o link antigo para de abrir o lote na hora. */
  async rotateInviteLink(lotId: string, actorUserId: string) {
    const lot = await prisma.ticketLot.findUnique({
      where: { id: lotId },
      include: { ticketType: { select: { event: { select: { organizationId: true } } } } },
    });
    if (!lot) throw new NotFoundException("Lote não encontrado");
    await this.orgAccess.assertPermission(lot.ticketType.event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);
    if (lot.inviteMode !== "LINK") {
      throw new BadRequestException("Este lote não é restrito por link");
    }
    const atualizado = await prisma.ticketLot.update({
      where: { id: lotId },
      data: { inviteToken: novoCodigoDeConvite() },
      select: { id: true, inviteToken: true },
    });
    return atualizado;
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
      where: { status: "PUBLISHED", isPrivate: false, endsAt: { gt: new Date() }, venueId: { not: null } },
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
    const chave = `evlist:${options.page}:${options.pageSize}:${options.city ?? ""}:${options.category ?? ""}`;
    return this.lembrado(chave, 5_000, () => this.listPublicEventsFresco(options));
  }

  private async listPublicEventsFresco(options: { page: number; pageSize: number; city?: string; category?: string }) {
    const where = {
      status: "PUBLISHED" as const,
      isPrivate: false,
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
    return this.lembrado(`home:sections:${city ?? "all"}`, 60_000, () => this.getHomeSectionsFresco(city));
  }

  private async getHomeSectionsFresco(city?: string) {
    const where = {
      status: "PUBLISHED" as const,
      isPrivate: false,
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

  async getPublicEvent(slug: string, promoterSlug?: string, inviteToken?: string) {
    // cache por (evento + promoter + convite): quem chega por um link vê uma
    // lista de lotes diferente, então não pode dividir cache com o público —
    // senão o lote exclusivo vazaria para quem não tem o link
    return this.lembrado(`ev:${slug}:${promoterSlug ?? "-"}:${inviteToken ?? "-"}`, 5_000, () =>
      this.getPublicEventFresco(slug, promoterSlug, inviteToken),
    );
  }

  private async getPublicEventFresco(slug: string, promoterSlug?: string, inviteToken?: string) {
    const event = await prisma.event.findFirst({
      // pausado continua acessível pelo link (o site mostra "Vendas pausadas");
      // listas e home seguem só PUBLISHED. Reservar continua exigindo PUBLISHED.
      where: { slug, status: { in: ["PUBLISHED", "SALES_PAUSED"] } },
      include: {
        venue: true,
        organization: { select: { id: true, name: true, displayName: true, slug: true } },
        ticketTypes: {
          orderBy: { position: "asc" },
          include: {
            lots: {
              // só-balcão fica invisível pro público (cortesia via promoter)
              where: { status: "ACTIVE", pdvOnly: false },
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
    const promoterValido = promoterSlug
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
    if (!promoterValido) {
      event.ticketTypes = event.ticketTypes.map((tt) => ({
        ...tt,
        lots: tt.lots.filter((l) => !l.promoterOnly),
      }));
    }
    // LOTE RESTRITO POR LINK (2026-10-10): só aparece com o código daquele lote.
    // O código NUNCA sai na resposta pública — senão qualquer visitante o leria.
    event.ticketTypes = event.ticketTypes.map((tt) => ({
      ...tt,
      lots: tt.lots
        .filter((l) => l.inviteMode === "NONE" || (Boolean(inviteToken) && l.inviteToken === inviteToken))
        .map((l) => ({ ...l, inviteToken: null })),
    }));
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

  async getPublicAvailability(slug: string, promoterSlug?: string, inviteToken?: string) {
    // SEM micro-cache aqui (achado 2026-09-01): esta rota é o estoque em tempo
    // real do seletor de ingressos — 5s velho perto do esgotamento mostraria
    // vaga que não existe. O ganho anti-N+1 continua (conta dos lotes abaixo).
    const event = await this.getPublicEventFresco(slug, promoterSlug, inviteToken);

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

/** Código do link de convidado: 128 bits aleatórios, seguro para URL. */
function novoCodigoDeConvite(): string {
  return randomBytes(16).toString("base64url");
}
