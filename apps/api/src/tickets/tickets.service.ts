import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { signTicketToken } from "@borafest/tickets";
import { randomBytes } from "crypto";
import type { TransferTicketInput } from "@borafest/contracts";

@Injectable()
export class TicketsService {
  /** Ingressos de um pedido, acessíveis pelo token público (compra sem conta). */
  async findByOrderPublicToken(publicToken: string) {
    const order = await prisma.order.findUnique({
      where: { publicToken },
      include: {
        tickets: {
          orderBy: [{ orderItemId: "asc" }, { seq: "asc" }],
          include: {
            ticketLot: { select: { name: true, ticketType: { select: { name: true } } } },
          },
        },
        event: { select: { title: true, slug: true, startsAt: true, endsAt: true } },
      },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");

    return {
      orderId: order.id,
      orderStatus: order.status,
      event: order.event,
      tickets: order.tickets.map((ticket) => this.toPublicTicket(ticket)),
    };
  }

  /** Carteira do usuário autenticado. */
  async findByUser(userId: string) {
    const tickets = await prisma.ticket.findMany({
      where: { order: { userId }, status: { in: ["ISSUED", "ACTIVE", "CHECKED_IN"] } },
      orderBy: { issuedAt: "desc" },
      include: {
        ticketLot: { select: { name: true, ticketType: { select: { name: true } } } },
        event: { select: { title: true, slug: true, startsAt: true, endsAt: true } },
      },
    });

    return tickets.map((ticket) => ({
      ...this.toPublicTicket(ticket),
      event: (ticket as any).event,
    }));
  }

  /**
   * Transferência self-service (arquitetura §13): quem pede prova que é dono
   * do pedido informando o `orderPublicToken` (mesmo segredo de ver/reenviar
   * ingressos). Atualiza o titular e reassina o QR com nonce novo — o QR
   * antigo (impresso/print salvo) para de bater com a assinatura verificada
   * no check-in.
   */
  async transferTicket(ticketId: string, input: TransferTicketInput) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        order: { select: { publicToken: true } },
        event: { select: { signingKey: true } },
        ticketLot: { select: { name: true, ticketType: { select: { name: true } } } },
      },
    });
    if (!ticket) throw new NotFoundException("Ingresso não encontrado");
    if (ticket.order.publicToken !== input.orderPublicToken) {
      throw new ForbiddenException("Token do pedido não confere com este ingresso");
    }
    if (ticket.status !== "ISSUED" && ticket.status !== "ACTIVE") {
      throw new BadRequestException("Este ingresso não pode ser transferido no estado atual");
    }
    if (!ticket.event.signingKey) {
      throw new BadRequestException("Evento sem chave de assinatura configurada");
    }

    const fromName = ticket.attendeeName;
    const fromEmail = ticket.attendeeEmail;

    const qrToken = signTicketToken(
      {
        v: 1,
        eid: ticket.eventId,
        tid: ticket.id,
        lid: ticket.ticketLotId,
        n: randomBytes(8).toString("base64url"),
        iat: Math.floor(Date.now() / 1000),
      },
      ticket.event.signingKey.privateKeyPem,
    );

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { attendeeName: input.toName, attendeeEmail: input.toEmail, qrToken },
      include: { ticketLot: { select: { name: true, ticketType: { select: { name: true } } } } },
    });

    await prisma.auditLog.create({
      data: {
        action: "ticket.transfer",
        entityType: "ticket",
        entityId: ticket.id,
        metadata: { fromName, fromEmail, toName: input.toName, toEmail: input.toEmail },
      },
    });

    return this.toPublicTicket(updated);
  }

  private toPublicTicket(ticket: {
    id: string;
    code: string;
    qrToken: string;
    status: string;
    seq: number;
    attendeeName: string | null;
    issuedAt: Date;
    ticketLot: { name: string; ticketType: { name: string } };
  }) {
    return {
      id: ticket.id,
      code: ticket.code,
      qrToken: ticket.qrToken,
      status: ticket.status,
      seq: ticket.seq,
      attendeeName: ticket.attendeeName,
      issuedAt: ticket.issuedAt,
      lotName: ticket.ticketLot.name,
      typeName: ticket.ticketLot.ticketType.name,
    };
  }
}
