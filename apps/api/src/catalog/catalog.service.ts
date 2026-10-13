import { randomBytes } from "node:crypto";
import { BadRequestException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { abrirLotesSeguintes, prisma, Prisma } from "@borafest/database";
import { computePlatformFeeCents } from "@borafest/payments";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateTicketLotInput, CreateTicketTypeInput, UpdateTicketLotInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";
import { minimoDaCobrancaCents } from "../common/minimo-cobranca";
import { alteracoesDoLote, conferirRegrasDoLote, meiaDoLote } from "./regras-do-lote";
import { loteLiberadoPeloConvite } from "../convites-email/convite-regras";


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
          // janela (2026-10-12): lote que ainda não abriu não entra no preço do card
          startsAt: true,
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

/**
 * Lote dentro da janela de vendas (2026-10-12): mesma regra da reserva — não
 * abriu (início no futuro) ou já encerrou (fim no passado) não é oferecido.
 */
function loteNaJanela(lot: { startsAt: Date | null; endsAt: Date | null }, agora: number): boolean {
  return (
    (lot.startsAt === null || lot.startsAt.getTime() <= agora) &&
    (lot.endsAt === null || lot.endsAt.getTime() > agora)
  );
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
      startsAt: Date | null;
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
  // FORA DA JANELA FORA DO CARD (2026-10-12): lote que ainda não abriu ou já
  // encerrou não vende, então não entra no preço nem no "termina em"
  const now = Date.now();
  const ativos = event.ticketTypes.flatMap((type) => type.lots);
  const lots = ativos
    .filter((lot) => loteNaJanela(lot, now))
    .filter(loteComEstoque);
  const totals = lots.map(
    (lot) => lot.priceCents + (lot.feeMode !== "PRODUCER" ? lot.feeCents : 0),
  );
  // ESGOTADO DITO NO CARD (2026-10-12): sem preço o "Em alta" seguia com
  // "Garanta seu lugar" para evento todo vendido. Esgotado = tem lote ACTIVE
  // público e NENHUM tem estoque (lote fora da janela com vaga não é esgotado).
  const soldOut = ativos.length > 0 && !ativos.some(loteComEstoque);
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
    soldOut,
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

  /**
   * Lotes do evento para o painel do produtor (2026-10-12): tudo o que a tela
   * de lotes precisa para editar, mostrar o link de convite e a virada. Só
   * quem pode criar lote vê — o código do convite é a chave do lote. Inclui o
   * mínimo do pagamento online para o painel dizer o valor certo.
   */
  async listEventLots(eventId: string, actorUserId: string) {
    await this.assertEventAccess(eventId, actorUserId);
    const [lotes, entradas] = await Promise.all([
      prisma.ticketLot.findMany({
        where: { ticketType: { eventId } },
        include: { ticketType: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.ticket.groupBy({
        by: ["ticketLotId"],
        where: { eventId, status: "CHECKED_IN" },
        _count: { _all: true },
      }),
    ]);
    const entraram = new Map(entradas.map((e) => [e.ticketLotId, e._count._all]));
    return {
      minimoCobrancaCents: minimoDaCobrancaCents(),
      lots: lotes.map((lote) => ({
        id: lote.id,
        ticketTypeId: lote.ticketType.id,
        typeName: lote.ticketType.name,
        name: lote.name,
        priceCents: lote.priceCents,
        feeCents: lote.feeCents,
        feeMode: lote.feeMode,
        nominal: lote.nominal,
        requiresCpf: lote.requiresCpf,
        halfPriceEnabled: lote.halfPriceEnabled,
        pdvOnly: lote.pdvOnly,
        promoterOnly: lote.promoterOnly,
        inviteMode: lote.inviteMode,
        inviteToken: lote.inviteToken,
        limitPerCpf: lote.limitPerCpf,
        capacity: lote.capacity,
        maxPerOrder: lote.maxPerOrder,
        soldCount: lote.soldCount,
        reservedCount: lote.reservedCount,
        checkedInCount: entraram.get(lote.id) ?? 0,
        status: lote.status,
        startsAt: lote.startsAt,
        endsAt: lote.endsAt,
        activateAfterLotId: lote.activateAfterLotId,
        createdAt: lote.createdAt,
      })),
    };
  }

  async createLot(ticketTypeId: string, actorUserId: string, input: CreateTicketLotInput) {
    const ticketType = await prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
      include: { event: { include: { organization: true } } },
    });
    if (!ticketType) throw new NotFoundException("Tipo de ingresso não encontrado");
    await this.orgAccess.assertPermission(ticketType.event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    const feeCents = taxaDoLote(input.priceCents, ticketType.event.organization);
    const inviteMode = input.inviteMode ?? "NONE";
    const feeMode = input.feeMode ?? "BUYER";
    const halfPriceEnabled = meiaDoLote(input.priceCents, input.halfPriceEnabled ?? false);
    const startsAt = input.startsAt ? new Date(input.startsAt) : null;
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;

    // as MESMAS regras da edição (2026-10-12): restrição única, balcão com
    // preço, mínimo do banco (inteira e meia) e fim depois do início
    conferirRegrasDoLote({
      priceCents: input.priceCents,
      feeCents,
      feeMode,
      halfPriceEnabled,
      pdvOnly: input.pdvOnly ?? false,
      promoterOnly: input.promoterOnly ?? false,
      inviteMode,
      startsAt,
      endsAt,
    });

    const anteriorId = input.activateAfterLotId ?? null;
    if (anteriorId && input.activateNow) {
      throw new BadRequestException(
        'Escolha um só: abrir o lote agora ou "Abrir quando o lote anterior esgotar".',
      );
    }

    // rastro (2026-10-12): o lote e o registro de quem o criou entram juntos
    return prisma.$transaction(async (tx) => {
      // VIRADA: o anterior é conferido (e travado) na mesma transação — uma
      // venda que o esgote agora espera e, ao esgotar, já vê este lote na fila
      if (anteriorId) await conferirLoteAnterior(tx, { ticketTypeId, anteriorId });

      const lote = await tx.ticketLot.create({
        data: {
          ticketTypeId,
          name: input.name,
          priceCents: input.priceCents,
          feeCents,
          capacity: input.capacity,
          maxPerOrder: input.maxPerOrder,
          feeMode,
          nominal: input.nominal ?? false,
          halfPriceEnabled,
          pdvOnly: input.pdvOnly ?? false,
          promoterOnly: input.promoterOnly ?? false,
          inviteMode,
          inviteToken: inviteMode === "LINK" ? novoCodigoDeConvite() : undefined,
          limitPerCpf: input.limitPerCpf,
          requiresCpf: input.requiresCpf ?? false,
          startsAt: startsAt ?? undefined,
          endsAt: endsAt ?? undefined,
          // com virada nasce guardado; "abrir agora" já nasce à venda (uma
          // chamada só: sem lote repetido quando a 2ª chamada falhava)
          status: !anteriorId && input.activateNow ? "ACTIVE" : "DRAFT",
          activateAfterLotId: anteriorId,
        },
      });
      // o código do convite NÃO vai para o histórico: é a chave do lote
      await tx.auditLog.create(
        rastroDoLote(actorUserId, ticketType.event.organizationId, "lot.create", lote.id, {
          eventId: ticketType.eventId,
          ticketTypeId,
          name: lote.name,
          priceCents: lote.priceCents,
          feeCents: lote.feeCents,
          feeMode: lote.feeMode,
          capacity: lote.capacity,
          maxPerOrder: lote.maxPerOrder,
          halfPriceEnabled: lote.halfPriceEnabled,
          pdvOnly: lote.pdvOnly,
          promoterOnly: lote.promoterOnly,
          inviteMode: lote.inviteMode,
          limitPerCpf: lote.limitPerCpf,
          status: lote.status,
          startsAt: lote.startsAt?.toISOString() ?? null,
          endsAt: lote.endsAt?.toISOString() ?? null,
          activateAfterLotId: lote.activateAfterLotId,
        }),
      );
      return lote;
    });
  }

  /**
   * EDITAR LOTE (2026-10-12): nome, preço (só sem venda nem reserva),
   * quantidade (nunca abaixo do que já saiu), máximo por pedido, limite por
   * CPF, datas, "quem pode pegar", meia e virada. Tudo numa transação com a
   * linha do lote travada: a conta de vendidos/reservados é a do momento em
   * que salva, não a de quando a tela abriu (uma reserva no meio espera).
   */
  async updateLot(lotId: string, actorUserId: string, input: UpdateTicketLotInput) {
    const inicial = await prisma.ticketLot.findUnique({
      where: { id: lotId },
      include: { ticketType: { include: { event: { include: { organization: true } } } } },
    });
    if (!inicial) throw new NotFoundException("Lote não encontrado");
    const organizationId = inicial.ticketType.event.organizationId;
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    const novoAnterior =
      input.activateAfterLotId !== undefined && input.activateAfterLotId !== inicial.activateAfterLotId
        ? input.activateAfterLotId
        : undefined;

    return prisma.$transaction(async (tx) => {
      // ordem das travas igual à da venda — o anterior antes do seguinte —
      // para nunca uma esperar a outra em círculo
      if (novoAnterior) {
        await conferirLoteAnterior(tx, { ticketTypeId: inicial.ticketTypeId, anteriorId: novoAnterior, loteId: lotId });
      }
      await travarLote(tx, lotId);
      const lote = await tx.ticketLot.findUnique({ where: { id: lotId } });
      if (!lote) throw new NotFoundException("Lote não encontrado");
      if (lote.status === "CLOSED") {
        throw new BadRequestException("Lote encerrado não se edita — crie um novo lote se precisar.");
      }
      if (novoAnterior !== undefined && lote.activateAfterLotId !== inicial.activateAfterLotId) {
        throw new BadRequestException("O lote mudou enquanto você editava — atualize a página e tente de novo.");
      }

      const saiu = lote.soldCount + lote.reservedCount;
      const priceCents = input.priceCents ?? lote.priceCents;
      const mudouPreco = priceCents !== lote.priceCents;
      if (mudouPreco && saiu > 0) {
        throw new BadRequestException(
          "O preço não muda depois que alguém comprou ou reservou este lote: quem já pegou pagou o valor de agora. Para outro preço, crie um novo lote.",
        );
      }
      const capacity = input.capacity ?? lote.capacity;
      if (capacity !== lote.capacity && capacity < saiu) {
        throw new BadRequestException(
          `Já saíram ${saiu} ${saiu === 1 ? "ingresso" : "ingressos"} deste lote (vendidos e reservados) — a quantidade não pode ficar abaixo disso.`,
        );
      }

      // taxa só se recalcula quando o preço muda: com o preço igual, o
      // comprador de amanhã paga o mesmo que o de ontem
      const feeCents = mudouPreco ? taxaDoLote(priceCents, inicial.ticketType.event.organization) : lote.feeCents;
      const inviteMode = input.inviteMode ?? lote.inviteMode;
      const pdvOnly = input.pdvOnly ?? lote.pdvOnly;
      const promoterOnly = input.promoterOnly ?? lote.promoterOnly;
      const halfPriceEnabled = meiaDoLote(priceCents, input.halfPriceEnabled ?? lote.halfPriceEnabled);
      const startsAt =
        input.startsAt === undefined ? lote.startsAt : input.startsAt === null ? null : new Date(input.startsAt);
      const endsAt = input.endsAt === undefined ? lote.endsAt : input.endsAt === null ? null : new Date(input.endsAt);

      conferirRegrasDoLote({
        priceCents,
        feeCents,
        feeMode: lote.feeMode,
        halfPriceEnabled,
        pdvOnly,
        promoterOnly,
        inviteMode,
        startsAt,
        endsAt,
      });

      let activateAfterLotId = lote.activateAfterLotId;
      if (input.activateAfterLotId !== undefined && input.activateAfterLotId !== lote.activateAfterLotId) {
        if (input.activateAfterLotId !== null && lote.status !== "DRAFT") {
          throw new BadRequestException(
            "Este lote já está à venda — a virada automática só vale para lote que ainda não abriu.",
          );
        }
        activateAfterLotId = input.activateAfterLotId;
      }

      // LINK: ao virar link nasce um código novo (como no createLot); ao
      // deixar de ser link o código morre — voltar a ser link depois não
      // ressuscita um link antigo que pode ter vazado
      const inviteToken =
        inviteMode === "LINK"
          ? lote.inviteMode === "LINK" && lote.inviteToken
            ? lote.inviteToken
            : novoCodigoDeConvite()
          : null;

      const depois = {
        name: input.name ?? lote.name,
        priceCents,
        feeCents,
        capacity,
        maxPerOrder: input.maxPerOrder ?? lote.maxPerOrder,
        limitPerCpf: input.limitPerCpf === undefined ? lote.limitPerCpf : input.limitPerCpf,
        startsAt,
        endsAt,
        inviteMode,
        promoterOnly,
        pdvOnly,
        halfPriceEnabled,
        activateAfterLotId,
        inviteToken,
      };
      const mudou = alteracoesDoLote(lote, depois);
      // salvar sem mudar nada não grava nem suja o histórico
      if (mudou.campos.length === 0) return { ...lote, openedLots: [] as Array<{ id: string; name: string }> };

      const salvo = await tx.ticketLot.update({ where: { id: lotId }, data: depois });
      await tx.auditLog.create(
        rastroDoLote(actorUserId, organizationId, "lot.update", lotId, {
          eventId: inicial.ticketType.eventId,
          name: salvo.name,
          campos: mudou.campos,
          antes: mudou.antes,
          depois: mudou.depois,
        }),
      );

      // baixar a quantidade até o que já foi vendido ESGOTA o lote: a vez
      // passa para os lotes que esperavam por ele, na mesma transação
      const abertos =
        capacity !== lote.capacity && salvo.soldCount >= salvo.capacity
          ? await abrirLotesSeguintes(tx, lotId, "esgotado")
          : [];
      return { ...salvo, openedLots: abertos.map((l) => ({ id: l.id, name: l.name })) };
    });
  }

  /** Troca o código do link de convidado: o link antigo para de abrir o lote na hora. */
  async rotateInviteLink(lotId: string, actorUserId: string) {
    const lot = await prisma.ticketLot.findUnique({
      where: { id: lotId },
      include: { ticketType: { select: { eventId: true, event: { select: { organizationId: true } } } } },
    });
    if (!lot) throw new NotFoundException("Lote não encontrado");
    const organizationId = lot.ticketType.event.organizationId;
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);
    if (lot.inviteMode !== "LINK") {
      throw new BadRequestException("Este lote não é restrito por link");
    }
    // rastro (2026-10-12): "quem trocou o link?" — o código em si nunca vai junto
    return prisma.$transaction(async (tx) => {
      const atualizado = await tx.ticketLot.update({
        where: { id: lotId },
        data: { inviteToken: novoCodigoDeConvite() },
        select: { id: true, inviteToken: true },
      });
      await tx.auditLog.create(
        rastroDoLote(actorUserId, organizationId, "lot.invite_rotate", lotId, {
          eventId: lot.ticketType.eventId,
          name: lot.name,
        }),
      );
      return atualizado;
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

    // rastro (2026-10-12): quem colocou o lote à venda, e de que estado
    return prisma.$transaction(async (tx) => {
      // só ativa se AINDA estiver guardado: dois cliques (ou a virada
      // automática no mesmo instante) não gravam dois registros
      const { count } = await tx.ticketLot.updateMany({
        where: { id: lotId, status: { in: ["DRAFT", "SCHEDULED"] } },
        data: { status: "ACTIVE" },
      });
      const ativado = await tx.ticketLot.findUniqueOrThrow({ where: { id: lotId } });
      if (count === 0) {
        if (ativado.status === "ACTIVE") return ativado;
        throw new BadRequestException("Lote não pode ser ativado a partir do estado atual");
      }
      await tx.auditLog.create(
        rastroDoLote(actorUserId, lot.ticketType.event.organizationId, "lot.activate", lotId, {
          eventId: lot.ticketType.eventId,
          name: lot.name,
          de: lot.status,
          para: "ACTIVE",
        }),
      );
      return ativado;
    });
  }

  /**
   * Encerra as vendas do lote (some do site). Definitivo — crie outro lote se
   * precisar. VIRADA (2026-10-12): os lotes que esperavam por este abrem na
   * mesma transação — salvo quando este próprio ainda esperava a vez dele:
   * aí quem estava atrás passa a esperar o anterior deste (pular o 2º lote
   * não abre o 3º com o 1º ainda vendendo).
   */
  async closeLot(lotId: string, actorUserId: string) {
    const lot = await prisma.ticketLot.findUnique({
      where: { id: lotId },
      include: { ticketType: { include: { event: true } } },
    });
    if (!lot) throw new NotFoundException("Lote não encontrado");
    const organizationId = lot.ticketType.event.organizationId;
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);
    if (lot.status === "CLOSED") throw new BadRequestException("Lote já está encerrado");
    // rastro (2026-10-12): "quem fechou o lote?" — e com quanto vendido
    return prisma.$transaction(async (tx) => {
      // ordem das travas igual à da venda: o anterior antes do seguinte
      if (lot.activateAfterLotId) await travarLote(tx, lot.activateAfterLotId);
      await travarLote(tx, lotId);
      const atual = await tx.ticketLot.findUnique({ where: { id: lotId } });
      if (!atual) throw new NotFoundException("Lote não encontrado");
      // dois cliques: o segundo encontra o lote já encerrado e não mexe em nada
      if (atual.status === "CLOSED") throw new BadRequestException("Lote já está encerrado");

      const encerrado = await tx.ticketLot.update({ where: { id: lotId }, data: { status: "CLOSED" } });

      const anterior =
        atual.status === "DRAFT" && atual.activateAfterLotId
          ? await tx.ticketLot.findUnique({ where: { id: atual.activateAfterLotId } })
          : null;
      const anteriorAindaVende =
        anterior !== null &&
        anterior.status !== "CLOSED" &&
        anterior.status !== "SOLD_OUT" &&
        anterior.soldCount < anterior.capacity;

      let abertos: Array<{ id: string; name: string }> = [];
      let passamAEsperar: Array<{ id: string; name: string }> = [];
      if (anterior && anteriorAindaVende) {
        passamAEsperar = await tx.ticketLot.findMany({
          where: { activateAfterLotId: lotId, status: "DRAFT" },
          select: { id: true, name: true },
        });
        if (passamAEsperar.length > 0) {
          await tx.ticketLot.updateMany({
            where: { id: { in: passamAEsperar.map((l) => l.id) }, status: "DRAFT" },
            data: { activateAfterLotId: anterior.id },
          });
          await tx.auditLog.createMany({
            data: passamAEsperar.map((l) =>
              rastroDoLote(actorUserId, organizationId, "lot.update", l.id, {
                eventId: lot.ticketType.eventId,
                name: l.name,
                campos: ["activateAfterLotId"],
                antes: { activateAfterLotId: lotId },
                depois: { activateAfterLotId: anterior.id },
                motivo: "lote anterior encerrado antes de abrir",
              }).data,
            ),
          });
        }
      } else {
        abertos = (await abrirLotesSeguintes(tx, lotId, "encerrado")).map((l) => ({ id: l.id, name: l.name }));
      }

      await tx.auditLog.create(
        rastroDoLote(actorUserId, organizationId, "lot.close", lotId, {
          eventId: lot.ticketType.eventId,
          name: atual.name,
          de: atual.status,
          para: "CLOSED",
          soldCount: atual.soldCount,
          capacity: atual.capacity,
          ...(abertos.length > 0 ? { abriram: abertos.map((l) => l.id) } : {}),
          ...(passamAEsperar.length > 0 && anterior
            ? { passamAEsperar: passamAEsperar.map((l) => l.id), novoAnterior: anterior.id }
            : {}),
        }),
      );
      return {
        ...encerrado,
        openedLots: abertos,
        requeuedLots: passamAEsperar,
        requeuedAfter: passamAEsperar.length > 0 && anterior ? { id: anterior.id, name: anterior.name } : null,
      };
    });
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
      // rastro (2026-10-12): o lote some do banco, então o registro guarda o
      // que ele era — apagar e registrar entram juntos (se um falha, nada muda)
      await prisma.$transaction(async (tx) => {
        // VIRADA (2026-10-12): lote com outro esperando por ele não se apaga —
        // o de trás ficaria guardado para sempre sem ninguém saber. A trava
        // garante que ninguém entra na fila dele enquanto apagamos.
        await travarLote(tx, lotId);
        const esperando = await tx.ticketLot.findFirst({
          where: { activateAfterLotId: lotId, status: "DRAFT" },
          select: { name: true },
        });
        if (esperando) {
          throw new BadRequestException(
            `O lote "${esperando.name}" está esperando este esgotar para abrir. Antes de apagar, edite o "${esperando.name}" e desligue "Abrir quando o lote anterior esgotar" — ou encerre este lote em vez de apagar.`,
          );
        }
        await tx.ticketLot.delete({ where: { id: lotId } });
        await tx.auditLog.create(
          rastroDoLote(actorUserId, lot.ticketType.event.organizationId, "lot.delete", lotId, {
            eventId: lot.ticketType.eventId,
            ticketTypeId: lot.ticketTypeId,
            name: lot.name,
            status: lot.status,
            priceCents: lot.priceCents,
            capacity: lot.capacity,
          }),
        );
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
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
    const agora = new Date();
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
              // só-balcão fica invisível pro público (cortesia via promoter).
              // JANELA DO LOTE (2026-10-12): lote que ainda não abriu ou já
              // encerrou também não aparece — a reserva recusa os dois
              where: {
                status: "ACTIVE",
                pdvOnly: false,
                AND: [
                  { OR: [{ startsAt: null }, { startsAt: { lte: agora } }] },
                  { OR: [{ endsAt: null }, { endsAt: { gt: agora } }] },
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
    // CONVITE POR E-MAIL (2026-10-12): o lote EMAIL some do mesmo jeito e só
    // aparece com o código de um convite ainda valendo DAQUELE lote (usado ou
    // revogado não abre). Mesma regra da reserva (convites-email/convite-regras.ts).
    const loteDoConviteEmail =
      inviteToken && event.ticketTypes.some((tt) => tt.lots.some((l) => l.inviteMode === "EMAIL"))
        ? await loteLiberadoPeloConvite(inviteToken)
        : null;
    event.ticketTypes = event.ticketTypes.map((tt) => ({
      ...tt,
      lots: tt.lots
        .filter(
          (l) =>
            l.inviteMode === "NONE" ||
            (l.inviteMode === "LINK" && Boolean(inviteToken) && l.inviteToken === inviteToken) ||
            (l.inviteMode === "EMAIL" && loteDoConviteEmail !== null && l.id === loteDoConviteEmail),
        )
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

/**
 * Taxa de serviço é da PLATAFORMA, nunca digitada pelo produtor (decisão
 * 2026-08-01): mostrado = cobrado = contabilizado. Ingresso grátis não paga piso.
 */
function taxaDoLote(priceCents: number, organization: Parameters<typeof computePlatformFeeCents>[2]): number {
  return priceCents === 0 ? 0 : computePlatformFeeCents("PIX", priceCents, organization);
}

/**
 * Trava a linha do lote até o fim da transação (2026-10-12). A venda que
 * confirma estoque faz UPDATE na mesma linha, então quem edita, encerra ou
 * entra na fila da virada enxerga os números do momento — e uma venda no meio
 * espera em vez de se perder.
 */
async function travarLote(tx: Prisma.TransactionClient, lotId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM ticket_lots WHERE id = ${lotId}::uuid FOR UPDATE`);
}

/**
 * VIRADA AUTOMÁTICA (2026-10-12): confere o lote que este vai esperar. Tem de
 * ser do mesmo ingresso, ainda vender (encerrado ou esgotado nunca mais
 * dispararia a virada — este lote ficaria guardado para sempre) e não pode
 * formar um círculo (A espera B que espera A: nenhum abre). A linha do
 * anterior fica travada: uma venda que o esgote agora espera esta transação e,
 * ao esgotar, já enxerga este lote na fila.
 */
async function conferirLoteAnterior(
  tx: Prisma.TransactionClient,
  opcoes: { ticketTypeId: string; anteriorId: string; loteId?: string },
) {
  await travarLote(tx, opcoes.anteriorId);
  const anterior = await tx.ticketLot.findUnique({
    where: { id: opcoes.anteriorId },
    select: {
      id: true,
      name: true,
      ticketTypeId: true,
      status: true,
      soldCount: true,
      capacity: true,
      activateAfterLotId: true,
      endsAt: true,
    },
  });
  if (!anterior) {
    throw new BadRequestException("O lote anterior não existe mais — atualize a página e escolha de novo.");
  }
  if (anterior.ticketTypeId !== opcoes.ticketTypeId) {
    throw new BadRequestException("O lote anterior precisa ser do mesmo ingresso.");
  }
  if (opcoes.loteId && anterior.id === opcoes.loteId) {
    throw new BadRequestException("Um lote não pode esperar por ele mesmo.");
  }
  const desligue = 'Desligue "Abrir quando o lote anterior esgotar" para ele abrir agora.';
  if (anterior.status === "CLOSED") {
    throw new BadRequestException(`O lote "${anterior.name}" já foi encerrado, então este lote nunca abriria. ${desligue}`);
  }
  if (anterior.status === "SOLD_OUT" || anterior.soldCount >= anterior.capacity) {
    throw new BadRequestException(`O lote "${anterior.name}" já esgotou, então este lote nunca abriria. ${desligue}`);
  }
  // anterior que já passou do "Para de vender": a vez dele já acabou (revisão
  // 2026-10-13 — o worker abre o seguinte quando a data passa DEPOIS)
  if (anterior.endsAt && anterior.endsAt.getTime() <= Date.now()) {
    throw new BadRequestException(`O lote "${anterior.name}" já parou de vender pela data. ${desligue}`);
  }
  if (opcoes.loteId && anterior.status === "DRAFT") {
    // sobe a fila de lotes AINDA GUARDADOS a partir do anterior: se chegar
    // neste lote, é círculo. Lote já aberto quebra a fila — ele vai esgotar
    // ou ser encerrado e a vez anda (apontador antigo dele não conta)
    let elo = anterior.activateAfterLotId;
    for (let passos = 0; elo && passos < 100; passos++) {
      if (elo === opcoes.loteId) {
        throw new BadRequestException(
          "Os lotes ficariam esperando um ao outro e nenhum abriria. Escolha outro lote anterior.",
        );
      }
      const proximo = await tx.ticketLot.findUnique({
        where: { id: elo },
        select: { status: true, activateAfterLotId: true },
      });
      if (!proximo || proximo.status !== "DRAFT") break;
      elo = proximo.activateAfterLotId;
    }
  }
  return anterior;
}

type AcaoDoLote = "lot.create" | "lot.update" | "lot.activate" | "lot.close" | "lot.delete" | "lot.invite_rotate";

/**
 * Registro de auditoria de uma ação do produtor sobre o lote (2026-10-12) —
 * mesmo formato dos outros registros (ator, organização, ação, entidade).
 */
function rastroDoLote(
  actorUserId: string,
  organizationId: string,
  action: AcaoDoLote,
  lotId: string,
  metadata: Prisma.InputJsonObject,
) {
  return {
    data: { actorUserId, organizationId, action, entityType: "ticket_lot", entityId: lotId, metadata },
  };
}
