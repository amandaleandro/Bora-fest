import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { TICKET_GATE_MESSAGE } from "../common/ticket-gate";
import { signTicketToken } from "@borafest/tickets";
import { randomBytes } from "crypto";
import QRCode from "qrcode";
import type { TransferTicketInput } from "@borafest/contracts";

@Injectable()
export class TicketsService {
  /**
   * Quem segura o `orderPublicToken` é o COMPRADOR do pedido. Um ingresso é
   * dele enquanto ninguém o transferiu para outra conta: `ownerUserId` nulo
   * (nunca transferido) ou apontando para o próprio comprador. Depois de
   * transferido para terceiro, o comprador não pode mais ver/usar o QR — senão
   * o token do pedido (que o comprador ainda conhece) daria acesso ao ingresso
   * que já é de outra pessoa (auditoria 2026-08-12).
   */
  private belongsToOrderBearer(
    ticket: { ownerUserId: string | null },
    order: { userId: string | null },
  ): boolean {
    return ticket.ownerUserId === null || ticket.ownerUserId === order.userId;
  }

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
        user: { select: { emailVerifiedAt: true } },
      },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");

    // Portão do 1º ingresso: conta não verificada não vê QR — nem por link
    // encaminhado. Verificou (código ou link mágico), abre.
    if (order.user && !order.user.emailVerifiedAt) {
      return {
        orderId: order.id,
        orderStatus: order.status,
        event: order.event,
        requiresVerification: true,
        contactEmail: order.contactEmail,
        tickets: [],
      };
    }

    return {
      orderId: order.id,
      orderStatus: order.status,
      event: order.event,
      requiresVerification: false,
      contactEmail: order.contactEmail,
      // ingresso transferido para outra conta some da visão por token do pedido
      tickets: order.tickets
        .filter((ticket) => this.belongsToOrderBearer(ticket, order))
        .map((ticket) => this.toPublicTicket(ticket)),
    };
  }

  /**
   * PNG do QR de um ingresso (conteúdo = `qr_token`), acessível por quem tem
   * o token público do pedido — é a imagem enviada na entrega por WhatsApp.
   */
  async renderTicketQrPng(orderPublicToken: string, ticketId: string): Promise<Buffer> {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        qrToken: true,
        ownerUserId: true,
        order: {
          select: {
            id: true,
            publicToken: true,
            userId: true,
            user: { select: { emailVerifiedAt: true } },
          },
        },
      },
    });
    if (!ticket || ticket.order.publicToken !== orderPublicToken) {
      throw new NotFoundException("Ingresso não encontrado neste pedido");
    }
    // ingresso já transferido para outra conta não é mais servido pelo token do
    // pedido — quem tem a posse acessa pela carteira logada (auditoria 2026-08-12)
    if (!this.belongsToOrderBearer(ticket, ticket.order)) {
      throw new NotFoundException("Ingresso não encontrado neste pedido");
    }
    // portão do 1º ingresso também na IMAGEM (auditoria 2026-08-10: a carteira
    // trancava, mas o PNG servia o mesmo QR para quem tivesse o link)
    if (ticket.order.user && !ticket.order.user.emailVerifiedAt) {
      throw new ForbiddenException(TICKET_GATE_MESSAGE);
    }
    return QRCode.toBuffer(ticket.qrToken, { type: "png", width: 512, margin: 2 });
  }

  /** Carteira do usuário autenticado. */
  async findByUser(userId: string) {
    const tickets = await prisma.ticket.findMany({
      where: {
        status: { in: ["ISSUED", "ACTIVE", "CHECKED_IN"] },
        OR: [{ ownerUserId: userId }, { ownerUserId: null, order: { userId } }],
      },
      orderBy: { issuedAt: "desc" },
      include: {
        ticketLot: { select: { name: true, ticketType: { select: { name: true } } } },
        event: { select: { title: true, slug: true, startsAt: true, endsAt: true } },
        order: { select: { publicToken: true, userId: true } },
      },
    });

    const now = Date.now();
    return tickets.map((ticket) => {
      // o `orderPublicToken` é o segredo do PEDIDO INTEIRO — só o comprador o
      // recebe. Um ingresso recebido por transferência aparece na carteira, mas
      // sem o token do pedido de origem (senão o presenteado enxergaria e
      // sequestraria os demais ingressos do comprador — auditoria 2026-08-12).
      const isBuyer = (ticket as any).order.userId === userId;
      return {
        ...this.toPublicTicket(ticket),
        event: (ticket as any).event,
        orderPublicToken: isBuyer ? (ticket as any).order.publicToken : null,
        transferable:
          (ticket.status === "ISSUED" || ticket.status === "ACTIVE") &&
          new Date((ticket as any).event.endsAt).getTime() > now,
      };
    });
  }

  /**
   * Transferência self-service (arquitetura §13, reforçada em 2026-08-12):
   * quem transfere precisa estar LOGADO e ser o dono ATUAL do ingresso —
   * `ownerUserId` apontando para ele, ou (ingresso nunca transferido) ser o
   * comprador do pedido. Antes a prova era só o `orderPublicToken` do pedido,
   * o que deixava o comprador reclamar de volta um ingresso já presenteado e
   * um token vazado transferir ingressos alheios. Atualiza o titular e
   * reassina o QR com nonce novo — o QR antigo para de bater no check-in.
   */
  async transferTicket(ticketId: string, userId: string, input: TransferTicketInput) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        order: { select: { publicToken: true, userId: true, contactEmail: true } },
        event: { select: { title: true, endsAt: true, signingKey: true } },
        ticketLot: {
          select: { name: true, requiresCpf: true, ticketType: { select: { name: true } } },
        },
      },
    });
    if (!ticket) throw new NotFoundException("Ingresso não encontrado");
    // dono atual: quem recebeu o ingresso, ou o comprador enquanto ninguém o
    // transferiu. Só ele transfere — não basta conhecer o token do pedido.
    const isOwner =
      ticket.ownerUserId === userId ||
      (ticket.ownerUserId === null && ticket.order.userId === userId);
    if (!isOwner) {
      throw new ForbiddenException("Você não é o dono atual deste ingresso");
    }
    if (ticket.status !== "ISSUED" && ticket.status !== "ACTIVE") {
      throw new BadRequestException("Este ingresso não pode ser transferido no estado atual");
    }
    if (new Date(ticket.event.endsAt).getTime() <= Date.now()) {
      throw new BadRequestException("O evento já terminou — ingresso não pode ser transferido");
    }
    if (!ticket.event.signingKey) {
      throw new BadRequestException("Evento sem chave de assinatura configurada");
    }

    // a posse só muda para uma conta que EXISTE (decisão 2026-08-06: destino
    // já validado) — e com CPF na conta quando o lote exige documento
    const toUser = await prisma.user.findUnique({
      where: { email: input.toEmail.toLowerCase().trim() },
    });
    if (!toUser) {
      throw new NotFoundException(
        "A pessoa precisa criar a conta BoraFest primeiro (com este e-mail)",
      );
    }
    if (ticket.ticketLot.requiresCpf && !toUser.cpf) {
      throw new BadRequestException(
        "Este lote exige CPF: a conta destino precisa completar o cadastro (Dados pessoais) antes de receber o ingresso",
      );
    }

    const fromName = ticket.attendeeName;
    const fromEmail = ticket.attendeeEmail ?? ticket.order.contactEmail;

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

    const toName = toUser.name ?? input.toEmail;
    const lotLabel = `${ticket.ticketLot.ticketType.name} — ${ticket.ticketLot.name}`;

    const [updated] = await prisma.$transaction([
      prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          ownerUserId: toUser.id,
          attendeeName: toName,
          attendeeEmail: toUser.email,
          attendeeCpf: ticket.ticketLot.requiresCpf ? toUser.cpf : ticket.attendeeCpf,
          qrToken,
        },
        include: { ticketLot: { select: { name: true, ticketType: { select: { name: true } } } } },
      }),
      prisma.auditLog.create({
        data: {
          action: "ticket.transfer",
          entityType: "ticket",
          entityId: ticket.id,
          metadata: { fromName, fromEmail, toUserId: toUser.id, toEmail: toUser.email },
        },
      }),
      // aviso ao novo dono pela fila persistente (worker entrega com retry)
      prisma.notification.create({
        data: {
          channel: "EMAIL",
          recipient: toUser.email!,
          template: "ticket_transferred",
          payload: {
            eventTitle: ticket.event.title,
            lotLabel,
            code: ticket.code,
            toName,
            fromEmail,
            walletUrl: `${process.env.WEB_BASE_URL ?? "https://borafest.com.br"}/perfil`,
          },
        },
      }),
    ]);

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
