import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@borafest/database";
import { createSessionToken } from "@borafest/auth";
import { TICKET_GATE_MESSAGE } from "../common/ticket-gate";
import { getWhatsAppSender } from "@borafest/notifications";
import type { OrderWhatsAppInput, RegisterPushTokenInput } from "@borafest/contracts";

const RESEND_LIMIT_PER_HOUR = 3;

/** Normaliza celular BR (DDD + 9 dígitos, com/sem +55) para E.164 sem "+": 55DDD9XXXXXXXX. */
function normalizeBrMobile(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) digits = digits.slice(2);
  if (!/^[1-9][0-9]9[0-9]{8}$/.test(digits)) return null;
  return `55${digits}`;
}

@Injectable()
export class NotificationsService {
  /**
   * Reenvio de ingressos pelo comprador (§17: "reenvio simples") — enfileira
   * nova notificação com os dados atuais do pedido. Limitado por pedido/hora
   * para não virar canal de spam.
   */
  async resendTickets(publicToken: string) {
    const order = await prisma.order.findUnique({
      where: { publicToken },
      include: {
        user: { select: { id: true, emailVerifiedAt: true, sessionVersion: true } },
        event: { select: { title: true, startsAt: true, timezone: true } },
        guestListEntries: { select: { id: true }, take: 1 },
        tickets: {
          where: { status: { in: ["ISSUED", "ACTIVE", "CHECKED_IN"] } },
          orderBy: [{ orderItemId: "asc" }, { seq: "asc" }],
          include: {
            ticketLot: { select: { name: true, ticketType: { select: { name: true } } } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");
    // Portão do 1º ingresso: o QR NUNCA sai por reenvio antes de verificar.
    // Mas quem pagou e não recebeu o aviso precisa de auto-atendimento (queixa
    // 2026-09-02): em vez de recusar, REENVIAMOS o link mágico (account_claim)
    // para o MESMO e-mail do pedido — nunca o QR. Clicar verifica e abre tudo.
    // (Institucionais como @ufu.br fazem greylisting; a 2ª tentativa costuma
    // passar — por isso o reenvio resolve boa parte dos casos.)
    if (order.user && !order.user.emailVerifiedAt) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await prisma.notification.count({
        where: { orderId: order.id, template: "account_claim", createdAt: { gt: oneHourAgo } },
      });
      if (recent >= RESEND_LIMIT_PER_HOUR) {
        throw new BadRequestException(
          "Limite de reenvios atingido — tente novamente em alguns minutos",
        );
      }
      const claimToken = await createSessionToken(
        {
          sub: order.user.id,
          purpose: "email-verify",
          sv: order.user.sessionVersion,
          orderToken: order.publicToken,
        },
        "7d",
      );
      const base = process.env.WEB_BASE_URL ?? "http://localhost:3000";
      const cortesia =
        order.totalCents === 0
          ? order.guestListEntries.length > 0
            ? ("CONVIDADO" as const)
            : order.soldByUserId
              ? ("CORTESIA" as const)
              : null
          : null;
      await prisma.notification.create({
        data: {
          channel: "EMAIL",
          recipient: order.contactEmail,
          template: "account_claim",
          payload: {
            contactName: order.contactName,
            eventTitle: order.event.title,
            claimUrl: `${base}/acesso?token=${encodeURIComponent(claimToken)}`,
            cortesia,
          },
          orderId: order.id,
        },
      });
      // sinaliza pra UI: "reenviamos o link de acesso" (não o QR)
      return { queued: true, channels: ["EMAIL"], mode: "account_claim" as const };
    }
    if (order.status !== "FULFILLED" || order.tickets.length === 0) {
      throw new BadRequestException("Pedido ainda não tem ingressos emitidos");
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await prisma.notification.count({
      where: {
        orderId: order.id,
        template: "ticket_delivery",
        createdAt: { gt: oneHourAgo },
      },
    });
    if (recent >= RESEND_LIMIT_PER_HOUR) {
      throw new BadRequestException(
        "Limite de reenvios atingido — tente novamente em alguns minutos",
      );
    }

    const webBaseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3000";
    const payload = {
      contactName: order.contactName ?? undefined,
      eventTitle: order.event.title,
      eventStartsAt: new Intl.DateTimeFormat("pt-BR", {
        timeZone: order.event.timezone,
        dateStyle: "short",
        timeStyle: "short",
      }).format(order.event.startsAt),
      orderUrl: `${webBaseUrl}/pedido/${order.publicToken}`,
      tickets: order.tickets.map((t) => ({
        code: t.code,
        typeName: t.ticketLot.ticketType.name,
        lotName: t.ticketLot.name,
      })),
    };

    await prisma.notification.create({
      data: {
        channel: "EMAIL",
        recipient: order.contactEmail,
        template: "ticket_delivery",
        payload,
        orderId: order.id,
      },
    });
    if (order.contactPhone) {
      await prisma.notification.create({
        data: {
          channel: "WHATSAPP",
          recipient: order.contactPhone,
          template: "ticket_delivery",
          payload,
          orderId: order.id,
        },
      });
    }

    const channels = order.contactPhone ? ["EMAIL", "WHATSAPP"] : ["EMAIL"];

    const pushTokens = await prisma.pushToken.findMany({ where: { orderId: order.id } });
    for (const pushToken of pushTokens) {
      await prisma.notification.create({
        data: {
          channel: "PUSH",
          recipient: pushToken.token,
          template: "ticket_delivery",
          payload,
          orderId: order.id,
        },
      });
    }
    if (pushTokens.length > 0) channels.push("PUSH");

    return { queued: true, channels };
  }

  /**
   * "Receber meus ingressos no WhatsApp" — envio imediato (sem fila): o
   * comprador acabou de pedir, então a janela de 24h da Meta está aberta e
   * dá pra responder com texto livre + imagem do QR. Em dev o provider
   * devlog só registra no log; a resposta é a mesma.
   */
  async sendTicketsToWhatsApp(publicToken: string, input?: OrderWhatsAppInput) {
    const order = await prisma.order.findUnique({
      where: { publicToken },
      include: {
        user: { select: { emailVerifiedAt: true } },
        event: { select: { title: true, startsAt: true, timezone: true } },
        tickets: {
          where: { status: { in: ["ISSUED", "ACTIVE", "CHECKED_IN"] } },
          orderBy: [{ orderItemId: "asc" }, { seq: "asc" }],
          include: {
            ticketLot: { select: { name: true, ticketType: { select: { name: true } } } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException("Pedido não encontrado");
    // portão do 1º ingresso: nada de QR por reenvio/WhatsApp antes de verificar
    if (order.user && !order.user.emailVerifiedAt) {
      throw new ForbiddenException(TICKET_GATE_MESSAGE);
    }
    if (!["PAID", "FULFILLED"].includes(order.status) || order.tickets.length === 0) {
      throw new ConflictException("Pedido ainda não tem ingressos para enviar");
    }

    // Enviar para outro número segue permitido (comprar para um amigo é caso
    // real) — o que fecha o relay em massa é o rate limit por pedido/IP na rota
    // (auditoria 2026-08-30, revertendo o bloqueio anterior que matava o caso
    // legítimo). O número do corpo vence, com o do pedido como padrão.
    const rawPhone = input?.phone ?? order.contactPhone;
    if (!rawPhone) {
      throw new BadRequestException("Informe um número de WhatsApp com DDD");
    }
    const phone = normalizeBrMobile(rawPhone);
    if (!phone) {
      throw new BadRequestException(
        "Número de WhatsApp inválido — use DDD + 9 dígitos (ex.: 11 91234-5678)",
      );
    }

    // não sobrescreve o contato do pedido: quem manda um telefone avulso não
    // deve sequestrar o canal oficial (auditoria 2026-08-10)
    if (input?.phone && !order.contactPhone) {
      await prisma.order.update({ where: { id: order.id }, data: { contactPhone: phone } });
    }

    const webBaseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3000";
    const apiPublicUrl = process.env.API_PUBLIC_URL ?? "http://localhost:3333";
    const orderUrl = `${webBaseUrl}/pedido/${order.publicToken}`;
    const eventDate = new Intl.DateTimeFormat("pt-BR", {
      timeZone: order.event.timezone,
      dateStyle: "short",
      timeStyle: "short",
    }).format(order.event.startsAt);

    const sender = getWhatsAppSender();
    for (const ticket of order.tickets) {
      const lines = [
        `🎟️ *${order.event.title}* — ${eventDate}`,
        `${ticket.ticketLot.ticketType.name} / ${ticket.ticketLot.name}`,
      ];
      if (ticket.attendeeName) lines.push(`Participante: ${ticket.attendeeName}`);
      lines.push(
        `Código: ${ticket.code}`,
        "",
        `Apresente o QR abaixo na entrada. Reabra seus ingressos quando quiser: ${orderUrl}`,
      );
      await sender.send({ to: phone, text: lines.join("\n") });
      await sender.send({
        to: phone,
        imageUrl: `${apiPublicUrl}/v1/orders/${order.publicToken}/tickets/${ticket.id}/qr.png`,
        caption: `QR do ingresso ${ticket.code}`,
      });
    }

    return { sent: true, tickets: order.tickets.length, phone };
  }

  /**
   * Registro de push (Expo) pra este pedido — sem exigir conta (arquitetura
   * §12): o app registra o token assim que cria o pedido, pra ser avisado
   * quando os ingressos ficarem prontos em vez de só fazer polling.
   */
  async registerPushToken(publicToken: string, input: RegisterPushTokenInput) {
    const order = await prisma.order.findUnique({ where: { publicToken } });
    if (!order) throw new NotFoundException("Pedido não encontrado");

    await prisma.pushToken.upsert({
      where: { token: input.token },
      update: { orderId: order.id, platform: input.platform },
      create: { orderId: order.id, token: input.token, platform: input.platform },
    });

    return { registered: true };
  }
}
