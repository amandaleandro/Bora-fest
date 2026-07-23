import { prisma, Prisma } from "@borafest/database";
import { generateEventKeyPair, generateTicketCode, signTicketToken } from "@borafest/tickets";
import { withContext } from "@borafest/observability";
import { randomBytes } from "crypto";

const log = withContext({ module: "ticket-issuance" });

/**
 * Emissão exatamente-uma-vez (arquitetura §10/§11):
 * - guarda de status: só emite se o pedido está PAID; FULFILLED = já emitido;
 * - unique(order_item_id, seq) no banco impede duplicata mesmo em corrida;
 * - QR assinado com Ed25519 pela chave do evento (§12).
 */
export async function issueTicketsForOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, event: { include: { signingKey: true } } },
  });

  if (!order) {
    log.warn({ orderId }, "pedido não encontrado para emissão");
    return;
  }
  if (order.status === "FULFILLED") return; // já emitido — reprocessamento é no-op
  if (order.status !== "PAID") {
    log.warn({ orderId, status: order.status }, "pedido não está PAID; emissão ignorada");
    return;
  }

  const signingKey = await ensureSigningKey(order.eventId, order.event.signingKey);

  for (const item of order.items) {
    for (let seq = 1; seq <= item.quantity; seq++) {
      const ticketId = randomUuid();
      const qrToken = signTicketToken(
        {
          v: 1,
          eid: order.eventId,
          tid: ticketId,
          lid: item.ticketLotId,
          n: randomBytes(8).toString("base64url"),
          iat: Math.floor(Date.now() / 1000),
        },
        signingKey.privateKeyPem,
      );

      try {
        await prisma.ticket.create({
          data: {
            id: ticketId,
            orderId: order.id,
            orderItemId: item.id,
            eventId: order.eventId,
            ticketLotId: item.ticketLotId,
            seq,
            code: generateTicketCode(),
            qrToken,
            status: "ACTIVE",
            attendeeEmail: order.contactEmail,
            attendeeName: order.contactName,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          // (orderItemId, seq) já emitido por execução anterior — idempotente
          continue;
        }
        throw error;
      }
    }
  }

  // FULFILLED + notificações na MESMA transação: reprocessar o outbox nunca
  // duplica e-mail/WhatsApp (a guarda de status decide exatamente uma vez)
  const tickets = await prisma.ticket.findMany({
    where: { orderId },
    orderBy: [{ orderItemId: "asc" }, { seq: "asc" }],
    include: { ticketLot: { select: { name: true, ticketType: { select: { name: true } } } } },
  });

  await prisma.$transaction(async (tx) => {
    const fulfilled = await tx.order.updateMany({
      where: { id: orderId, status: "PAID" },
      data: { status: "FULFILLED" },
    });
    if (fulfilled.count === 0) return;

    const payload = buildDeliveryPayload(order, tickets);
    await tx.notification.create({
      data: {
        channel: "EMAIL",
        recipient: order.contactEmail,
        template: "ticket_delivery",
        payload,
        orderId,
      },
    });
    if (order.contactPhone) {
      await tx.notification.create({
        data: {
          channel: "WHATSAPP",
          recipient: order.contactPhone,
          template: "ticket_delivery",
          payload,
          orderId,
        },
      });
    }

    const pushTokens = await tx.pushToken.findMany({ where: { orderId } });
    for (const pushToken of pushTokens) {
      await tx.notification.create({
        data: {
          channel: "PUSH",
          recipient: pushToken.token,
          template: "ticket_delivery",
          payload,
          orderId,
        },
      });
    }
  });

  log.info({ orderId, tickets: tickets.length }, "ingressos emitidos e entrega enfileirada");
}

export function buildDeliveryPayload(
  order: {
    publicToken: string;
    contactName: string | null;
    event: { title: string; startsAt: Date; timezone: string };
  },
  tickets: Array<{
    code: string;
    ticketLot: { name: string; ticketType: { name: string } };
  }>,
) {
  const webBaseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3000";
  return {
    contactName: order.contactName ?? undefined,
    eventTitle: order.event.title,
    eventStartsAt: new Intl.DateTimeFormat("pt-BR", {
      timeZone: order.event.timezone,
      dateStyle: "short",
      timeStyle: "short",
    }).format(order.event.startsAt),
    // link profundo: abre a carteira do pedido sem conta nem aplicativo
    orderUrl: `${webBaseUrl}/pedido/${order.publicToken}`,
    tickets: tickets.map((t) => ({
      code: t.code,
      typeName: t.ticketLot.ticketType.name,
      lotName: t.ticketLot.name,
    })),
  };
}

async function ensureSigningKey(
  eventId: string,
  existing: { publicKeyPem: string; privateKeyPem: string } | null,
) {
  if (existing) return existing;

  const pair = generateEventKeyPair();
  try {
    return await prisma.eventSigningKey.create({
      data: { eventId, publicKeyPem: pair.publicKeyPem, privateKeyPem: pair.privateKeyPem },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // outra execução criou primeiro — usa a existente
      return prisma.eventSigningKey.findUniqueOrThrow({ where: { eventId } });
    }
    throw error;
  }
}

function randomUuid(): string {
  // uuid v4 via crypto — evita dependência extra
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
