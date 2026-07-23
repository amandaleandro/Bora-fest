import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@borafest/database";

const RESEND_LIMIT_PER_HOUR = 3;

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

    return { queued: true, channels: order.contactPhone ? ["EMAIL", "WHATSAPP"] : ["EMAIL"] };
  }
}
