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

  await prisma.order.updateMany({
    where: { id: orderId, status: "PAID" },
    data: { status: "FULFILLED" },
  });

  log.info({ orderId }, "ingressos emitidos");
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
