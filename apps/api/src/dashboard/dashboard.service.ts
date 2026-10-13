import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { OrderStatus, prisma, type Prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import { OrgAccessService } from "../common/org-access.service";
import { getEventNetCents } from "../common/ledger";
import { ONDE_PEDIDO_COM_VALOR, vendaDeuCerto, vendaFalhou } from "../common/conta-como-venda";
import { PARTICIPANTES_POR_PAGINA, filtroDeParticipantes } from "./participantes-pagina";
import {
  CABECALHO_MEIA,
  linhaCsv,
  linhasDaMeia,
  quantidadeDeMeia,
  simOuNao,
  textoSeguroParaPlanilha,
} from "./relatorio-meia";

const PAID_ORDER_STATUSES = ["PAID", "FULFILLED"] as const;

@Injectable()
export class DashboardService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  /**
   * Painel do evento: vendedor (SALES_PERFORM) enxerga o painel, mas dados
   * sensíveis do evento inteiro (lista de pedidos, PII de participantes e
   * exportações) exigem FINANCE_VIEW — auditoria 2026-08-10 mostrou vendedor
   * de atlética baixando CSV com nome/e-mail/CPF de todo mundo.
   */
  private async assertEventAccess(eventId: string, actorUserId: string, sensitive = false) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    if (sensitive) {
      await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
      return event;
    }
    try {
      await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
    } catch {
      await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.SALES_PERFORM);
    }
    return event;
  }

  /** Sem lançar: dinheiro é só de quem tem finance:view. */
  private async podeVerDinheiro(organizationId: string, actorUserId: string): Promise<boolean> {
    try {
      await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
      return true;
    } catch {
      return false;
    }
  }

  async getDashboard(eventId: string, actorUserId: string) {
    const event = await this.assertEventAccess(eventId, actorUserId);
    const comDinheiro = await this.podeVerDinheiro(event.organizationId, actorUserId);
    // bannerUrl e local no payload — sem eles a prévia do banner "sumia" no
    // F5 do painel e não havia como exibir o local (feedback 2026-08-03)
    const venue = event.venueId
      ? await prisma.venue.findUnique({
          where: { id: event.venueId },
          select: { name: true, address: true, mapsUrl: true, city: true, state: true },
        })
      : null;

    const [ordersByStatus, ticketsByStatus, reviewStats, lots] = await Promise.all([
      prisma.order.groupBy({
        by: ["status"],
        where: { eventId },
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      prisma.ticket.groupBy({
        by: ["status"],
        where: { eventId },
        _count: { _all: true },
      }),
      prisma.eventReview.aggregate({
        where: { eventId },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      prisma.ticketLot.findMany({
        where: { ticketType: { eventId } },
        select: {
          id: true,
          name: true,
          priceCents: true,
          feeCents: true,
          feeMode: true,
          nominal: true,
          requiresCpf: true,
          capacity: true,
          soldCount: true,
          reservedCount: true,
          status: true,
          ticketType: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const revenueCents = ordersByStatus
      .filter((o) => (PAID_ORDER_STATUSES as readonly string[]).includes(o.status))
      .reduce((sum, o) => sum + (o._sum.totalCents ?? 0), 0);

    // O que sobra para a casa neste evento (2026-08-29): `revenueCents` é o
    // bruto que o comprador pagou — taxa da plataforma dentro e reembolso
    // parcial derrubando o pedido inteiro. `netCents` vem do ledger e é o
    // dinheiro do produtor. Só para quem enxerga financeiro.
    const netCents = comDinheiro ? await getEventNetCents(eventId) : null;

    return {
      event: {
        id: event.id,
        organizationId: event.organizationId,
        title: event.title,
        slug: event.slug,
        status: event.status,
        category: event.category,
        bannerUrl: event.bannerUrl,
        waitingRoomEnabled: event.waitingRoomEnabled,
        waitingRoomConcurrency: event.waitingRoomConcurrency,
        pixelSettings: event.pixelSettings,
        // nunca devolvemos o token; o painel só precisa saber se já existe
        metaCapiConfigured: Boolean(event.metaCapiToken),
        venue,
      },
      // bruto também só para quem vê financeiro (auditoria 2026-08-29):
      // vendedor vê contagem de ingressos, não faturamento
      revenueCents: comDinheiro ? revenueCents : null,
      netCents,
      orders: {
        total: ordersByStatus.reduce((sum, o) => sum + o._count._all, 0),
        byStatus: Object.fromEntries(ordersByStatus.map((o) => [o.status, o._count._all])),
      },
      tickets: {
        total: ticketsByStatus.reduce((sum, t) => sum + t._count._all, 0),
        byStatus: Object.fromEntries(ticketsByStatus.map((t) => [t.status, t._count._all])),
      },
      lots: lots.map((lot) => ({
        id: lot.id,
        name: lot.name,
        ticketTypeId: lot.ticketType.id,
        typeName: lot.ticketType.name,
        priceCents: lot.priceCents,
        feeCents: lot.feeCents,
        feeMode: lot.feeMode,
        nominal: lot.nominal,
        requiresCpf: lot.requiresCpf,
        capacity: lot.capacity,
        sold: lot.soldCount,
        reserved: lot.reservedCount,
        available: Math.max(lot.capacity - lot.soldCount - lot.reservedCount, 0),
        status: lot.status,
      })),
      reviews: {
        average: reviewStats._avg.rating ?? null,
        count: reviewStats._count._all,
      },
    };
  }

  async listOrders(
    eventId: string,
    actorUserId: string,
    options: { status?: string; page: number; pageSize: number },
  ) {
    await this.assertEventAccess(eventId, actorUserId, true);

    // status fora do enum ia cru pro Prisma e virava 500 (mesmo padrão do ?category=, bateria 2026-09-24)
    if (options.status && !(options.status in OrderStatus)) {
      throw new BadRequestException("Status de pedido inválido");
    }
    const where = {
      eventId,
      ...(options.status ? { status: options.status as OrderStatus } : {}),
    };

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
        select: {
          id: true,
          publicToken: true,
          contactName: true,
          contactEmail: true,
          status: true,
          totalCents: true,
          createdAt: true,
          paidAt: true,
          _count: { select: { tickets: true } },
        },
      }),
    ]);

    return { total, page: options.page, pageSize: options.pageSize, orders };
  }

  /** Ranking de vendas por vendedor/atlética — quem vendeu, quantos pedidos deram certo (pagos) e quantos falharam. */
  async listSalesBySeller(eventId: string, actorUserId: string) {
    const event = await this.assertEventAccess(eventId, actorUserId);
    // e-mail e faturamento de OUTROS vendedores são financeiro (auditoria
    // 2026-08-30): um vendedor via a lista inteira. Sem finance:view, o e-mail
    // sai mascarado.
    const comDinheiro = await this.podeVerDinheiro(event.organizationId, actorUserId);

    // LISTA NÃO É VENDA (2026-10-11): pedido de R$ 0 (convidado da lista, lote
    // grátis, cupom de 100%) fica fora do ranking, mesma regra do relatório de
    // promoter. Antes, quem cadastrou 30 convidados aparecia aqui com 30 vendas
    // e lá com zero, e cancelar convidado contava como venda que "falhou".
    const orders = await prisma.order.findMany({
      where: { eventId, soldByUserId: { not: null }, ...ONDE_PEDIDO_COM_VALOR },
      select: {
        status: true,
        totalCents: true,
        partnerCommissionCents: true,
        soldByUserId: true,
        soldByUser: { select: { id: true, name: true, email: true } },
        salesPartner: { select: { id: true, name: true } },
        _count: { select: { tickets: true } },
      },
    });

    const bySeller = new Map<
      string,
      {
        sellerId: string;
        sellerName: string | null;
        sellerEmail: string | null;
        partnerId: string | null;
        partnerName: string | null;
        ordersOk: number;
        ordersFailed: number;
        ticketsSold: number;
        revenueCents: number;
        commissionCents: number;
      }
    >();

    for (const order of orders) {
      const sellerId = order.soldByUserId as string;
      const key = sellerId;
      const entry = bySeller.get(key) ?? {
        sellerId,
        sellerName: order.soldByUser?.name ?? null,
        sellerEmail: comDinheiro ? (order.soldByUser?.email ?? null) : null,
        partnerId: order.salesPartner?.id ?? null,
        partnerName: order.salesPartner?.name ?? null,
        ordersOk: 0,
        ordersFailed: 0,
        ticketsSold: 0,
        revenueCents: 0,
        commissionCents: 0,
      };

      if (vendaDeuCerto(order)) {
        entry.ordersOk += 1;
        entry.ticketsSold += order._count.tickets;
        entry.revenueCents += order.totalCents;
        entry.commissionCents += order.partnerCommissionCents;
      } else if (vendaFalhou(order)) {
        entry.ordersFailed += 1;
      }

      bySeller.set(key, entry);
    }

    // faturamento e comissão de OUTROS vendedores são financeiro (auditoria
    // 2026-08-30): o fix anterior só mascarou o e-mail. Sem finance:view, os
    // valores saem zerados — o vendedor vê a contagem, não o dinheiro alheio.
    const ordenado = Array.from(bySeller.values()).sort((a, b) => b.revenueCents - a.revenueCents);
    return comDinheiro
      ? ordenado
      : ordenado.map((e) => ({ ...e, revenueCents: 0, commissionCents: 0 }));
  }

  /**
   * Ranking de vendas por atlética/parceiro para competição — soma de todos os vendedores
   * vinculados a cada SalesPartner, ordenado por nº de ingressos vendidos (critério da disputa).
   * Só ingresso pago conta ponto (2026-10-11): convidado da lista e grátis pelo link (?p=) ficam fora.
   */
  async listSalesByPartner(eventId: string, actorUserId: string) {
    const eventoP = await this.assertEventAccess(eventId, actorUserId);
    const comDinheiroP = await this.podeVerDinheiro(eventoP.organizationId, actorUserId);

    // LISTA NÃO É VENDA (2026-10-11): a competição contava convidado da lista
    // como ingresso vendido. A atlética subia no ranking enchendo a lista (o
    // vendedor dela cadastra sem cota) ou com lote grátis/cupom de 100% pelo
    // link dela. Mesma regra do relatório de promoter.
    const orders = await prisma.order.findMany({
      where: { eventId, salesPartnerId: { not: null }, ...ONDE_PEDIDO_COM_VALOR },
      select: {
        status: true,
        totalCents: true,
        partnerCommissionCents: true,
        salesPartnerId: true,
        salesPartner: { select: { id: true, name: true, slug: true } },
        _count: { select: { tickets: true } },
      },
    });

    const byPartner = new Map<
      string,
      {
        partnerId: string;
        partnerName: string | null;
        partnerSlug: string | null;
        ordersOk: number;
        ordersFailed: number;
        ticketsSold: number;
        revenueCents: number;
        commissionCents: number;
      }
    >();

    for (const order of orders) {
      const partnerId = order.salesPartnerId as string;
      const entry = byPartner.get(partnerId) ?? {
        partnerId,
        partnerName: order.salesPartner?.name ?? null,
        partnerSlug: order.salesPartner?.slug ?? null,
        ordersOk: 0,
        ordersFailed: 0,
        ticketsSold: 0,
        revenueCents: 0,
        commissionCents: 0,
      };

      if (vendaDeuCerto(order)) {
        entry.ordersOk += 1;
        entry.ticketsSold += order._count.tickets;
        entry.revenueCents += order.totalCents;
        entry.commissionCents += order.partnerCommissionCents;
      } else if (vendaFalhou(order)) {
        entry.ordersFailed += 1;
      }

      byPartner.set(partnerId, entry);
    }

    const ordenadoP = Array.from(byPartner.values()).sort((a, b) => b.ticketsSold - a.ticketsSold);
    return comDinheiroP
      ? ordenadoP
      : ordenadoP.map((e) => ({ ...e, revenueCents: 0, commissionCents: 0 }));
  }

  /** Mesma checagem de acesso do ranking, exposta pra stream SSE poder validar antes de abrir a conexão. */
  async assertRankingAccess(eventId: string, actorUserId: string): Promise<void> {
    await this.assertEventAccess(eventId, actorUserId);
  }

  /**
   * Lista de participantes POR PÁGINA (2026-10-12) — ver participantes-pagina.ts.
   * Antes devolvia todos os ingressos do evento numa resposta só.
   */
  async listParticipants(
    eventId: string,
    actorUserId: string,
    options: { page: number; pageSize: number; q: string | null } = {
      page: 1,
      pageSize: PARTICIPANTES_POR_PAGINA,
      q: null,
    },
  ) {
    await this.assertEventAccess(eventId, actorUserId, true);
    const where = filtroDeParticipantes(eventId, options.q);
    const [total, participants] = await Promise.all([
      prisma.ticket.count({ where }),
      this.fetchParticipants(where, {
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
    ]);
    return { total, page: options.page, pageSize: options.pageSize, participants };
  }

  async exportParticipantsCsv(eventId: string, actorUserId: string): Promise<string> {
    await this.assertEventAccess(eventId, actorUserId, true);
    // CSV segue com a lista INTEIRA, sem página (2026-10-12)
    const participants = await this.fetchParticipants({ eventId });

    // "meia" no FIM (2026-10-12): quem já monta planilha em cima das colunas
    // antigas não vê nada mudar de lugar
    const header = "codigo,nome,email,tipo,lote,status,checkin_em,meia";
    const rows = participants.map((p) =>
      linhaCsv([
        p.code,
        textoSeguroParaPlanilha(p.attendeeName ?? ""),
        textoSeguroParaPlanilha(p.attendeeEmail ?? ""),
        textoSeguroParaPlanilha(p.typeName),
        textoSeguroParaPlanilha(p.lotName),
        p.status,
        p.checkedInAt ? p.checkedInAt.toISOString() : "",
        simOuNao(p.halfPrice),
      ]),
    );

    return [header, ...rows].join("\n");
  }

  /** CSV de pedidos p/ prestação de contas do produtor (bruto, taxa e líquido por pedido). */
  async exportOrdersCsv(eventId: string, actorUserId: string): Promise<string> {
    await this.assertEventAccess(eventId, actorUserId, true);

    const orders = await prisma.order.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
      select: {
        publicToken: true,
        contactName: true,
        contactEmail: true,
        status: true,
        totalCents: true,
        discountCents: true,
        createdAt: true,
        paidAt: true,
        items: { select: { quantity: true, priceCents: true, feeCents: true, halfPrice: true } },
        payments: { select: { method: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    // "meia" no FIM (2026-10-12): quantos ingressos do pedido são meia-entrada
    const header =
      "pedido,data,comprador,email,itens,valor_bruto,taxa_servico,valor_liquido,desconto,status,meio_pagamento,meia";
    const rows = orders.map((o) => {
      const itemCount = o.items.reduce((sum, i) => sum + i.quantity, 0);
      // pedido de R$ 0 (lote grátis, cupom 100%) não teve taxa cobrada: taxa e líquido zerados
      const feeCents = o.totalCents === 0 ? 0 : o.items.reduce((sum, i) => sum + i.feeCents * i.quantity, 0);
      const grossCents = o.totalCents + o.discountCents; // bruto antes do desconto do cupom
      const netCents = o.totalCents === 0 ? 0 : grossCents - feeCents - o.discountCents;
      return linhaCsv([
        o.publicToken,
        o.createdAt.toISOString(),
        textoSeguroParaPlanilha(o.contactName ?? ""),
        textoSeguroParaPlanilha(o.contactEmail),
        itemCount,
        (grossCents / 100).toFixed(2),
        (feeCents / 100).toFixed(2),
        (netCents / 100).toFixed(2),
        (o.discountCents / 100).toFixed(2),
        o.status,
        o.payments[0]?.method ?? "",
        quantidadeDeMeia(o.items),
      ]);
    });

    return [header, ...rows].join("\n");
  }

  /**
   * CSV DE MEIA-ENTRADA (2026-10-12, Decreto 8.537/2015): um ingresso de meia
   * por linha — data da compra, tipo, lote, participante, código, canal (site
   * ou porta) e situação. Mesma permissão dos outros exports (finance:view):
   * tem nome de participante. Regras das linhas em relatorio-meia.ts.
   */
  async exportMeiaEntradaCsv(eventId: string, actorUserId: string): Promise<string> {
    await this.assertEventAccess(eventId, actorUserId, true);

    const itens = await prisma.orderItem.findMany({
      where: { halfPrice: true, order: { eventId } },
      // ordem da compra; o id desempata e deixa a saída estável entre exportações
      orderBy: [{ order: { createdAt: "asc" } }, { id: "asc" }],
      select: {
        quantity: true,
        ticketLot: { select: { name: true, ticketType: { select: { name: true } } } },
        order: {
          select: {
            publicToken: true,
            status: true,
            createdAt: true,
            paidAt: true,
            contactName: true,
            soldByUserId: true,
          },
        },
        tickets: { orderBy: { seq: "asc" }, select: { code: true, status: true, attendeeName: true } },
      },
    });

    return [CABECALHO_MEIA, ...linhasDaMeia(itens).map(linhaCsv)].join("\n");
  }

  private fetchParticipants(where: Prisma.TicketWhereInput, pagina?: { skip: number; take: number }) {
    return prisma.ticket
      .findMany({
        where,
        // (orderItemId, seq) é único: a ordem é estável entre uma página e outra
        orderBy: [{ orderItemId: "asc" }, { seq: "asc" }],
        ...(pagina ?? {}),
        select: {
          id: true,
          code: true,
          status: true,
          attendeeName: true,
          attendeeEmail: true,
          checkedInAt: true,
          ticketLot: { select: { name: true, ticketType: { select: { name: true } } } },
          order: { select: { contactName: true, contactEmail: true } },
          orderItem: { select: { halfPrice: true } },
        },
      })
      .then((tickets) =>
        tickets.map((t) => ({
          id: t.id,
          code: t.code,
          status: t.status,
          attendeeName: t.attendeeName ?? t.order.contactName,
          attendeeEmail: t.attendeeEmail ?? t.order.contactEmail,
          checkedInAt: t.checkedInAt,
          typeName: t.ticketLot.ticketType.name,
          lotName: t.ticketLot.name,
          /** meia-entrada (2026-10-12): vai para a coluna "meia" do CSV */
          halfPrice: t.orderItem.halfPrice,
        })),
      );
  }
}
