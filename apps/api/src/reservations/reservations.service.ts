import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { createReservationExpirationQueue } from "@borafest/queues";
import type { CreateReservationInput } from "@borafest/contracts";
import { InventoryService, InsufficientStockError } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { convitePeloCodigo, motivoDaReservaRecusada } from "../convites-email/convite-regras";

const RESERVATION_TTL_MINUTES = 10;

@Injectable()
export class ReservationsService {
  private readonly expirationQueue = createReservationExpirationQueue();

  constructor(
    private readonly inventory: InventoryService,
    private readonly waitingRoom: WaitingRoomService,
  ) {}

  async create(userId: string | undefined, input: CreateReservationInput) {
    const event = await prisma.event.findUnique({ where: { id: input.eventId } });
    if (!event || event.status !== "PUBLISHED") {
      throw new NotFoundException("Evento não encontrado ou não publicado");
    }

    if (event.waitingRoomEnabled) {
      await this.waitingRoom.assertAdmitted(event.id, input.waitingRoomTicketId);
    }

    const lots = await prisma.ticketLot.findMany({
      where: { id: { in: input.items.map((item) => item.ticketLotId) } },
      include: { ticketType: true },
    });

    // LOTE EXCLUSIVO DO PROMOTER (2026-10-10): antes só era escondido na TELA;
    // quem tivesse o id do lote reservava sem o link. Agora a reserva exige o
    // link de um promoter ativo desta casa (e deste evento, se tiver escopo).
    const precisaPromoter = lots.some((l) => l.promoterOnly);
    const promoterValido =
      precisaPromoter && input.promoterSlug
        ? await prisma.promoterLink.findFirst({
            where: {
              slug: input.promoterSlug,
              status: "ACTIVE",
              organizationId: event.organizationId,
              OR: [{ eventId: null }, { eventId: event.id }],
            },
            select: { id: true },
          })
        : null;

    // CONVITE POR E-MAIL (2026-10-12): lote EMAIL só com o código de um convite
    // ainda valendo DAQUELE lote — usado ou revogado não reserva
    const conviteEmail = lots.some((l) => l.inviteMode === "EMAIL")
      ? await convitePeloCodigo(input.inviteToken)
      : null;

    const agora = Date.now();
    for (const item of input.items) {
      const lot = lots.find((l) => l.id === item.ticketLotId);
      if (!lot || lot.ticketType.eventId !== input.eventId) {
        throw new BadRequestException(`Lote ${item.ticketLotId} não pertence a este evento`);
      }
      // só-balcão nunca entra pelo site (2026-08-31) — mesmo que alguém
      // descubra o id do lote, a reserva pública é recusada
      if (lot.pdvOnly) {
        throw new BadRequestException(`O lote ${lot.name} é vendido apenas no balcão do evento`);
      }
      if (lot.promoterOnly && !promoterValido) {
        throw new BadRequestException("Este ingresso é exclusivo de quem chegou pelo link de um promoter");
      }
      // restrito por link: só com o código atual do lote (trocar o link mata o antigo)
      if (lot.inviteMode === "LINK" && (!input.inviteToken || input.inviteToken !== lot.inviteToken)) {
        throw new BadRequestException("Este ingresso é só para convidados. Abra o link que você recebeu.");
      }
      if (lot.inviteMode === "EMAIL") {
        const recusa = motivoDaReservaRecusada(lot.id, conviteEmail);
        if (recusa) throw new BadRequestException(recusa);
      }
      // JANELA DO LOTE (2026-10-12): o site mostrava "lote termina em", mas a
      // reserva não conferia início nem fim — o 1º lote seguia vendendo depois
      // da data. Vem depois das travas de acesso para não revelar as datas de
      // um lote restrito a quem não tem o link.
      if (lot.startsAt && lot.startsAt.getTime() > agora) {
        throw new BadRequestException(
          `Este lote ainda não abriu (${lot.name}). Atualize a página para ver os ingressos à venda.`,
        );
      }
      if (lot.endsAt && lot.endsAt.getTime() <= agora) {
        throw new BadRequestException(
          `Este lote já encerrou (${lot.name}). Atualize a página para ver os ingressos à venda.`,
        );
      }
      // meia-entrada é opt-in do produtor — sem a flag, ninguém compra meia
      if (item.halfPrice && !lot.halfPriceEnabled) {
        throw new BadRequestException("Este lote não oferece meia-entrada");
      }
      if (item.quantity < 1) {
        throw new BadRequestException("Quantidade inválida");
      }
    }

    // TETO POR LOTE agregando itens repetidos (auditoria 2026-08-29): antes o
    // limite era por item, então mandar N itens do MESMO lote, cada um sob o
    // teto, somava muito acima e dava pra travar o estoque inteiro num request.
    const totalPorLote = new Map<string, number>();
    for (const item of input.items) {
      totalPorLote.set(item.ticketLotId, (totalPorLote.get(item.ticketLotId) ?? 0) + item.quantity);
    }
    // limite por CPF: o pedido confere o CPF; aqui já barra quantidade acima do limite
    for (const [lotId, total] of totalPorLote) {
      const lot = lots.find((l) => l.id === lotId);
      if (lot?.limitPerCpf && total > lot.limitPerCpf) {
        throw new BadRequestException(
          `Este ingresso é limitado a ${lot.limitPerCpf} por pessoa`,
        );
      }
    }
    for (const [lotId, total] of totalPorLote) {
      const lot = lots.find((l) => l.id === lotId)!;
      if (total > lot.maxPerOrder) {
        throw new BadRequestException(`Quantidade acima do limite por pedido para o lote ${lot.name}`);
      }
    }

    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);

    const reservation = await prisma.$transaction(async (tx) => {
      for (const item of input.items) {
        await this.inventory.tryReserve(item.ticketLotId, item.quantity, tx);
      }

      return tx.reservation.create({
        data: {
          eventId: input.eventId,
          userId,
          expiresAt,
          items: {
            create: input.items.map((item) => {
              const lot = lots.find((l) => l.id === item.ticketLotId)!;
              return {
                ticketLotId: item.ticketLotId,
                quantity: item.quantity,
                // meia-entrada (Lei 12.933/2013): metade do preço, taxa cheia;
                // documento é conferido na portaria
                priceCents: item.halfPrice ? Math.round(lot.priceCents / 2) : lot.priceCents,
                feeCents: lot.feeCents,
                halfPrice: item.halfPrice ?? false,
              };
            }),
          },
        },
        include: { items: true },
      });
    }).catch((error) => {
      if (error instanceof InsufficientStockError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    });

    await this.expirationQueue.add(
      "expire",
      { reservationId: reservation.id },
      { delay: RESERVATION_TTL_MINUTES * 60 * 1000, jobId: reservation.id },
    );

    return reservation;
  }

  /**
   * Leitura da reserva para o checkout. Desde 2026-10-12 cada item traz o que o
   * checkout precisa do lote — nome, tipo, nominal, exige CPF, quem paga a taxa
   * e o modo de convite. Antes isso vinha só da página pública do evento, que
   * esconde lote encerrado: se o lote fechava DURANTE a reserva, o checkout
   * perdia o nome ("Ingresso"), deixava de pedir os participantes e somava a
   * taxa que o produtor absorve. A reserva guarda o lote que a pessoa pegou,
   * então ela é a fonte; os valores são os ATUAIS do lote — os mesmos que o
   * pedido confere ao ser criado (orders.service createFromReservation).
   * `eventSlug` deixa o checkout reabrir o catálogo (itens adicionais, cupom)
   * mesmo de evento privado, que não está na vitrine.
   */
  async findById(reservationId: string) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        event: { select: { slug: true } },
        items: {
          include: {
            ticketLot: {
              select: {
                name: true,
                nominal: true,
                requiresCpf: true,
                feeMode: true,
                inviteMode: true,
                ticketType: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!reservation) throw new NotFoundException("Reserva não encontrada");
    const { event, items, ...resto } = reservation;
    return {
      ...resto,
      eventSlug: event.slug,
      items: items.map(({ ticketLot, ...item }) => ({
        ...item,
        lotName: ticketLot.name,
        ticketTypeName: ticketLot.ticketType.name,
        nominal: ticketLot.nominal,
        requiresCpf: ticketLot.requiresCpf,
        feeMode: ticketLot.feeMode,
        inviteMode: ticketLot.inviteMode,
      })),
    };
  }
}
