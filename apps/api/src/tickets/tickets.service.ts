import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";

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
