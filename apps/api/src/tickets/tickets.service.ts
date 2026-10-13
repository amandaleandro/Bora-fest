import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, prisma } from "@borafest/database";
import { isValidCpf } from "@borafest/auth";
import { TICKET_GATE_MESSAGE } from "../common/ticket-gate";
import { origemGratis } from "../common/origem-gratis";
import { abrirChavePrivada, conferirChaveMestra, generateTicketCode, signTicketToken } from "@borafest/tickets";
import { randomBytes } from "crypto";
import QRCode from "qrcode";
import type { TransferTicketInput } from "@borafest/contracts";

@Injectable()
export class TicketsService implements OnModuleInit {
  private readonly logger = new Logger(TicketsService.name);

  /**
   * CHAVE DO QR CIFRADA EM REPOUSO (2026-10-12): no boot da API, avisa se a
   * chave de cada evento fica em texto puro (sem TICKET_KEY_ENCRYPTION_KEY) e
   * para o boot se a variável estiver mal formada. O worker faz o mesmo.
   */
  onModuleInit() {
    const { aviso } = conferirChaveMestra();
    if (aviso) this.logger.warn(aviso);
  }

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
        guestListEntries: { select: { id: true }, take: 1 },
        salesPartner: { select: { name: true } },
        // nome de quem convidou, quando a cortesia veio da cota de um promoter
        promoterLink: { select: { promoterUser: { select: { name: true } } } },
      },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");
    const cortesia = origemGratis(order);

    // Portão do 1º ingresso: conta não verificada não vê QR — nem por link
    // encaminhado. Verificou (código ou link mágico), abre.
    if (order.user && !order.user.emailVerifiedAt) {
      return {
        orderId: order.id,
        orderStatus: order.status,
        event: order.event,
        requiresVerification: true,
        contactEmail: order.contactEmail,
        // o link de acesso só vai para o e-mail de contato quando a conta nasceu
        // deste pedido; senão foi para o e-mail DA CONTA (2026-10-12) — a tela não
        // pode afirmar "enviamos para <contato>" nem oferecer código para ele
        linkNoContato: Boolean(order.accountCreatedByOrder),
        cortesia,
        tickets: [],
      };
    }

    return {
      orderId: order.id,
      orderStatus: order.status,
      event: order.event,
      requiresVerification: false,
      contactEmail: order.contactEmail,
      cortesia,
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
        order: { select: { publicToken: true, userId: true, totalCents: true } },
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
          // cortesia/convidado (pedido R$0) é intransferível — a flag tem que
          // bater com a recusa do transferTicket (achado 2026-09-01: o perfil
          // oferecia o botão e a API negava)
          (ticket as any).order.totalCents > 0 &&
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
   * reassina o QR com nonce novo — o QR antigo deixa de valer na porta, online
   * e offline (2026-10-12: antes a porta só conferia a assinatura e o QR
   * antigo seguia entrando; a regra mora em checkins/qr-atual.ts).
   */
  async transferTicket(ticketId: string, userId: string, input: TransferTicketInput) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        order: { select: { publicToken: true, userId: true, contactEmail: true, totalCents: true } },
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
    // cortesia/convidado é INTRANSFERÍVEL (decisão 2026-08-31): transferível,
    // ingresso grátis vira moeda — o golpe clássico é emitir cortesia em nome
    // fantasma e vender por fora usando a transferência pra "lavar" o nome.
    if (ticket.order.totalCents === 0) {
      throw new BadRequestException(
        "Ingresso de cortesia/convidado é intransferível — vale só para o nome em que foi emitido",
      );
    }
    if (new Date(ticket.event.endsAt).getTime() <= Date.now()) {
      throw new BadRequestException("O evento já terminou — ingresso não pode ser transferido");
    }
    if (!ticket.event.signingKey) {
      throw new BadRequestException("Evento sem chave de assinatura configurada");
    }
    // chave gravada cifrada ou em texto puro antigo (2026-10-12). Abre antes de
    // mexer em qualquer coisa: se não abrir (variável ausente/diferente neste
    // serviço), a transferência para aqui sem trocar dono nem QR.
    let chavePrivadaPem: string;
    try {
      chavePrivadaPem = abrirChavePrivada(ticket.event.signingKey.privateKeyPem);
    } catch (error) {
      this.logger.error(
        `chave do QR do evento ${ticket.eventId} não abriu: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(
        "Não conseguimos transferir o ingresso agora por um problema no nosso servidor. Tente de novo mais tarde ou fale com o suporte.",
      );
    }

    // a posse só muda para uma conta que EXISTE. Caminho NOVO (2026-08-15):
    // transferência POR CPF — acha a conta verificada pelo documento e o
    // ingresso passa para o NOME+CPF de quem recebe. E-mail fica como legado.
    let toUser;
    if (input.toCpf) {
      const cpfDigits = input.toCpf.replace(/\D/g, "");
      if (cpfDigits.length !== 11) throw new BadRequestException("CPF inválido — são 11 dígitos");
      if (!isValidCpf(cpfDigits)) {
        throw new BadRequestException("CPF inválido — confira os números digitados");
      }
      toUser = await prisma.user.findUnique({ where: { cpf: cpfDigits } });
      // achado 2026-09-01: conta NÃO verificada com CPF (criada por checkout de
      // terceiro) podia interceptar transferências — destino por CPF só vale
      // com posse do e-mail comprovada
      if (toUser && !toUser.emailVerifiedAt) {
        throw new BadRequestException(
          "A conta com este CPF ainda não confirmou o e-mail — peça a confirmação ou transfira por e-mail",
        );
      }
      if (!toUser) {
        throw new NotFoundException(
          "Nenhuma conta verificada com este CPF — a pessoa precisa criar a conta BoraFest e informar o CPF em Dados pessoais",
        );
      }
    } else {
      toUser = await prisma.user.findUnique({
        where: { email: input.toEmail!.toLowerCase().trim() },
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
    }
    if (toUser.id === userId) {
      throw new BadRequestException("O ingresso já é seu — transferência para a própria conta não faz nada");
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
      chavePrivadaPem,
    );

    const toName = toUser.name ?? toUser.email ?? "Novo titular";
    const lotLabel = `${ticket.ticketLot.ticketType.name} — ${ticket.ticketLot.name}`;

    // UMA TRANSFERÊNCIA POR VEZ (2026-10-12). O QR e o dono conferidos acima
    // são a guarda do update. Antes o update era incondicional: clique duplo,
    // ou duas abas passando o mesmo ingresso para pessoas diferentes, gravavam
    // as duas — ganhava a última, as duas pessoas recebiam o e-mail de
    // "ingresso transferido" e o QR devolvido a uma delas já nascia antigo
    // (recusado na porta, ver checkins/qr-atual.ts). Agora só a primeira grava.
    // A mesma guarda segura o ingresso que entrou na portaria nesse meio-tempo.
    //
    // CÓDIGO CURTO NOVO (revisão 2026-10-13): o QR antigo já morria na
    // transferência, mas o código digitável continuava o mesmo — quem passou o
    // ingresso adiante entrava digitando o código na portaria, antes do novo
    // dono. O código é único: na colisão (rara), tenta de novo com outro.
    const transferir = (code: string) => prisma.$transaction(async (tx) => {
      const gravou = await tx.ticket.updateMany({
        where: {
          id: ticket.id,
          qrToken: ticket.qrToken,
          ownerUserId: ticket.ownerUserId,
          status: { in: ["ISSUED", "ACTIVE"] },
        },
        data: {
          ownerUserId: toUser.id,
          // re-nomina SEMPRE (decisão 2026-08-15): o ingresso passa a ser do
          // nome+CPF de quem recebe — na portaria, o documento confere
          attendeeName: toName,
          attendeeEmail: toUser.email,
          attendeeCpf: toUser.cpf ?? null,
          qrToken,
          code,
        },
      });
      if (gravou.count === 0) {
        throw new ConflictException(
          "Este ingresso mudou enquanto você transferia (outra transferência ou entrada na portaria). Atualize a página para ver como ele está agora.",
        );
      }
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "ticket.transfer",
          entityType: "ticket",
          entityId: ticket.id,
          metadata: { fromName, fromEmail, toUserId: toUser.id, toEmail: toUser.email },
        },
      });
      // aviso ao novo dono pela fila persistente (worker entrega com retry)
      await tx.notification.create({
        data: {
          channel: "EMAIL",
          recipient: toUser.email!,
          template: "ticket_transferred",
          payload: {
            eventTitle: ticket.event.title,
            lotLabel,
            code,
            toName,
            fromEmail,
            walletUrl: `${process.env.WEB_BASE_URL ?? "https://borafest.com.br"}/perfil`,
          },
        },
      });
      return tx.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        include: { ticketLot: { select: { name: true, ticketType: { select: { name: true } } } } },
      });
    });

    let updated: Awaited<ReturnType<typeof transferir>> | undefined;
    for (let tentativa = 0; !updated; tentativa++) {
      try {
        updated = await transferir(generateTicketCode());
      } catch (err) {
        const colisaoDoCodigo =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && tentativa < 2;
        if (!colisaoDoCodigo) throw err;
      }
    }

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
