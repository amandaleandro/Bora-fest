import { prisma } from "@borafest/database";
import {
  renderAccountClaimEmail,
  getEmailSender,
  getPushSender,
  getWhatsAppSender,
  renderTicketDeliveryEmail,
  renderTicketDeliveryPush,
  renderOtpEmail,
  renderTicketTransferredEmail,
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

  if (template === "account_claim") {
    if (channel === "EMAIL") {
      await getEmailSender().send(
        renderAccountClaimEmail(recipient, payload as import("@borafest/notifications").AccountClaimPayload),
      );
      return;
    }
    throw new Error(`Canal não suportado para account_claim: ${channel}`);
  }

  if (template === "ticket_transferred") {
    if (channel === "EMAIL") {
      await getEmailSender().send(renderTicketTransferredEmail(recipient, payload as any));
      return;
    }
    throw new Error(`Canal não suportado para ticket_transferred: ${channel}`);
  }

  if (template === "promoter_invited") {
    if (channel === "EMAIL") {
      const p = payload as { orgName: string; eventTitle?: string | null; panelUrl: string };
      const escopo = p.eventTitle ? ` para o evento ${p.eventTitle}` : "";
      await getEmailSender().send({
        to: recipient,
        subject: `${p.orgName} te convidou para ser promoter 🎟️`,
        text: [
          `${p.orgName} te convidou para ser promoter${escopo} na BoraFest.`,
          "",
          "Aceite o convite no painel (entre com este mesmo e-mail):",
          p.panelUrl,
          "",
          "Ao aceitar, você ganha seu link de divulgação — cada venda pelo seu link é contabilizada (e comissionada, se combinado).",
          "",
          "Equipe BoraFest",
        ].join("\n"),
        html: `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
  <p><b>${p.orgName}</b> te convidou para ser <b>promoter</b>${escopo} na BoraFest.</p>
  <p><a href="${p.panelUrl}" style="display:inline-block;background:#D9128F;color:#fff;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">Aceitar convite no painel</a></p>
  <p style="color:#666;font-size:13px">Entre com este mesmo e-mail. Ao aceitar, você ganha seu link de divulgação — cada venda pelo seu link é contabilizada (e comissionada, se combinado).</p>
  <p>Equipe BoraFest</p>
</div>`.trim(),
      });
      return;
    }
    throw new Error(`Canal não suportado para promoter_invited: ${channel}`);
  }

  if (template === "cpf_defined") {
    if (channel === "EMAIL") {
      const p = payload as { cpfMasked: string; name?: string | null };
      const ola = p.name ? `Olá, ${p.name}!` : "Olá!";
      await getEmailSender().send({
        to: recipient,
        subject: "Seu CPF foi definido na conta BoraFest",
        text: [
          ola,
          "",
          `O CPF ${p.cpfMasked} acabou de ser definido como identidade da sua conta BoraFest — é ele que vale em ingressos nominais e transferências.`,
          "",
          "Se NÃO foi você, fale com o suporte imediatamente respondendo este e-mail.",
          "",
          "Equipe BoraFest",
        ].join("\n"),
        html: `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
  <p>${ola}</p>
  <p>O CPF <b>${p.cpfMasked}</b> acabou de ser definido como identidade da sua conta BoraFest — é ele que vale em ingressos nominais e transferências.</p>
  <p style="color:#b45309;font-weight:600">Se NÃO foi você, fale com o suporte imediatamente respondendo este e-mail.</p>
  <p>Equipe BoraFest</p>
</div>`.trim(),
      });
      return;
    }
    throw new Error(`Canal não suportado para cpf_defined: ${channel}`);
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
