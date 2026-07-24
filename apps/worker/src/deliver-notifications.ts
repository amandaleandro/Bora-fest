import { prisma } from "@borafest/database";
import {
  getEmailSender,
  getPushSender,
  getWhatsAppSender,
  renderTicketDeliveryEmail,
  renderTicketDeliveryPush,
  renderOtpEmail,
  renderOtpWhatsApp,
  type OtpCodePayload,
  renderPasswordResetEmail,
  type PasswordResetPayload,
  renderTicketDeliveryWhatsApp,
  type TicketDeliveryPayload,
} from "@borafest/notifications";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "notification-delivery" });

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

/**
 * Processa a fila persistente `notifications`: reivindica linhas PENDING com
 * guarda de status, renderiza o template e envia pelo adapter. Falha reagenda
 * com backoff; após MAX_ATTEMPTS marca FAILED (visível para o backoffice).
 */
export async function deliverPendingNotifications(): Promise<number> {
  const pending = await prisma.notification.findMany({
    where: { status: "PENDING", availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  let delivered = 0;
  for (const notification of pending) {
    const claimed = await prisma.notification.updateMany({
      where: { id: notification.id, status: "PENDING" },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;

    try {
      await send(
        notification.channel,
        notification.recipient,
        notification.template,
        notification.payload as unknown,
      );
      await prisma.notification.update({
        where: { id: notification.id },
        data: { status: "SENT", sentAt: new Date(), error: null },
      });
      delivered++;
    } catch (error) {
      const attempts = notification.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: failed ? "FAILED" : "PENDING",
          error: (error as Error).message,
          availableAt: new Date(Date.now() + Math.min(attempts * 60_000, 15 * 60_000)),
        },
      });
      log.error(
        { notificationId: notification.id, attempts, error: (error as Error).message },
        failed ? "notificação falhou definitivamente" : "notificação falhou; retry agendado",
      );
    }
  }

  return delivered;
}

async function send(
  channel: string,
  recipient: string,
  template: string,
  payload: unknown,
): Promise<void> {
  if (template === "otp_code") {
    const otp = payload as OtpCodePayload;
    if (channel === "EMAIL") {
      await getEmailSender().send(renderOtpEmail(recipient, otp));
      return;
    }
    if (channel === "WHATSAPP") {
      const message = renderOtpWhatsApp(otp);
      await getWhatsAppSender().send({ to: recipient, ...message });
      return;
    }
    throw new Error(`Canal não suportado para otp_code: ${channel}`);
  }

  if (template === "password_reset") {
    if (channel === "EMAIL") {
      await getEmailSender().send(renderPasswordResetEmail(recipient, payload as PasswordResetPayload));
      return;
    }
    throw new Error(`Canal não suportado para password_reset: ${channel}`);
  }

  if (template !== "ticket_delivery") {
    throw new Error(`Template de notificação desconhecido: ${template}`);
  }
  const data = payload as TicketDeliveryPayload;

  if (channel === "EMAIL") {
    await getEmailSender().send(renderTicketDeliveryEmail(recipient, data));
    return;
  }
  if (channel === "WHATSAPP") {
    const message = renderTicketDeliveryWhatsApp(data);
    await getWhatsAppSender().send({ to: recipient, ...message });
    return;
  }
  if (channel === "PUSH") {
    await getPushSender().send(renderTicketDeliveryPush(recipient, data));
    return;
  }
  throw new Error(`Canal de notificação desconhecido: ${channel}`);
}
