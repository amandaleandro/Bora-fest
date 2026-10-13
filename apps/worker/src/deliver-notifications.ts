import { ENVIO_CANCELADO, ehEmailAnonimo, prisma } from "@borafest/database";
import {
  renderAccountClaimEmail,
  renderCrmReactivationEmail,
  type CrmReactivationPayload,
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
  renderFreeTicketCanceledEmail,
  type FreeTicketCanceledPayload,
  renderFreeEventCanceledEmail,
  type FreeEventCanceledPayload,
  renderRefundRequestRejectedEmail,
  type RefundRequestRejectedPayload,
  renderLotEmailInviteEmail,
  type LotEmailInvitePayload,
  type EmailMessage,
  type EmailSendResult,
} from "@borafest/notifications";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "notification-delivery" });

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

/**
 * Templates de CAMPANHA: o "Não quero mais receber" da Casa vale para eles.
 * Os mesmos de TEMPLATES_DE_CAMPANHA da API (descadastro/supressao.ts) — o
 * teste descadastro-e-conta-apagada compara os dois.
 */
export const TEMPLATES_DE_CAMPANHA = new Set(["crm_reactivation"]);

/** Mesmo texto que a API grava quando tira da fila na hora do descadastro (ERRO_DESCADASTRADO). */
export const MOTIVO_SAIU_DAS_CAMPANHAS = "Não enviado: a pessoa pediu para não receber campanhas desta Casa";

/** Campanha sem a Casa no corpo: não dá para conferir o descadastro, então não sai. */
export const MOTIVO_CAMPANHA_SEM_CASA =
  "Não enviado: campanha sem a Casa de origem — não dá para conferir quem saiu das campanhas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Casa da campanha, lida do corpo da notificação (organizationId); null se não houver uma válida. */
export function casaDaCampanha(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const organizationId = (payload as Record<string, unknown>).organizationId;
  return typeof organizationId === "string" && UUID.test(organizationId) ? organizationId : null;
}

/**
 * Por que esta mensagem NÃO pode sair (null = pode sair). Conferido LOGO
 * ANTES do envio (LGPD, 2026-10-12):
 *  - destinatário de conta excluída (@anon.borafest.invalid): o domínio
 *    `.invalid` não recebe nada — tentar 5 vezes só gerava bounce;
 *  - campanha de uma Casa para quem saiu das campanhas DELA
 *    (marketing_opt_outs, Casa + e-mail normalizado). A API já pula essa
 *    pessoa ao enfileirar e tira da fila quando ela sai; aqui fecha a janela
 *    entre os dois (campanha enfileirada no mesmo instante do descadastro).
 * Erro na consulta sobe (vira nova tentativa) — nunca vira "pode enviar".
 */
export async function motivoParaNaoEnviar(notificacao: {
  recipient: string;
  template: string;
  payload: unknown;
}): Promise<string | null> {
  if (ehEmailAnonimo(notificacao.recipient)) return ENVIO_CANCELADO;
  if (TEMPLATES_DE_CAMPANHA.has(notificacao.template)) {
    const organizationId = casaDaCampanha(notificacao.payload);
    if (!organizationId) return MOTIVO_CAMPANHA_SEM_CASA;
    // mesma chave do CRM e do descadastro: LOWER(TRIM(email))
    const emailKey = notificacao.recipient.trim().toLowerCase();
    const saiu = await prisma.marketingOptOut.findUnique({
      where: { organizationId_emailKey: { organizationId, emailKey } },
      select: { id: true },
    });
    if (saiu) return MOTIVO_SAIU_DAS_CAMPANHAS;
  }
  return null;
}

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
      // conta excluída / saiu das campanhas: não sai e não volta para a fila
      // (FAILED com o motivo, na 1ª vez — sem as 5 tentativas)
      const motivo = await motivoParaNaoEnviar(notification);
      if (motivo) {
        await prisma.notification.updateMany({
          where: { id: notification.id, status: "PENDING" },
          data: { status: "FAILED", error: motivo },
        });
        // sem o e-mail no log: só a linha, o modelo e o motivo
        log.info({ notificationId: notification.id, template: notification.template, motivo }, "notificação não enviada");
        continue;
      }

      const providerMessageId = await send(
        notification.channel,
        notification.recipient,
        notification.template,
        notification.payload as unknown,
        notification.id,
      );
      // ENTREGA REAL (2026-10-12): o id do Resend fica na linha para o webhook
      // gravar entregue/devolvido/reclamação; canal sem id não mexe no campo
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          error: null,
          ...(providerMessageId ? { providerMessageId } : {}),
        },
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

/** id que o provedor de e-mail devolveu (Resend); null quando não há (2026-10-12) */
export function idDoProvedor(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const id = (result as EmailSendResult).providerMessageId;
  return typeof id === "string" && id ? id : null;
}

/** Envia e devolve o id do provedor (só e-mail tem; WhatsApp/push devolvem null). */
async function send(
  channel: string,
  recipient: string,
  template: string,
  payload: unknown,
  notificationId: string,
): Promise<string | null> {
  // todo e-mail sai marcado com o id da notificação (2026-10-12): o webhook do
  // Resend acha a linha por ele se o evento chegar antes de o id ser gravado
  const email = async (message: EmailMessage): Promise<string | null> =>
    idDoProvedor(await getEmailSender().send({ ...message, tags: { notification_id: notificationId } }));

  if (template === "otp_code") {
    const otp = payload as OtpCodePayload;
    if (channel === "EMAIL") {
      return email(renderOtpEmail(recipient, otp));
    }
    if (channel === "WHATSAPP") {
      const message = renderOtpWhatsApp(otp);
      await getWhatsAppSender().send({ to: recipient, ...message });
      return null;
    }
    throw new Error(`Canal não suportado para otp_code: ${channel}`);
  }

  if (template === "password_reset") {
    if (channel === "EMAIL") {
      return email(renderPasswordResetEmail(recipient, payload as PasswordResetPayload));
    }
    throw new Error(`Canal não suportado para password_reset: ${channel}`);
  }

  if (template === "account_claim") {
    if (channel === "EMAIL") {
      return email(
        renderAccountClaimEmail(recipient, payload as import("@borafest/notifications").AccountClaimPayload),
      );
    }
    throw new Error(`Canal não suportado para account_claim: ${channel}`);
  }

  if (template === "ticket_transferred") {
    if (channel === "EMAIL") {
      return email(renderTicketTransferredEmail(recipient, payload as any));
    }
    throw new Error(`Canal não suportado para ticket_transferred: ${channel}`);
  }

  // pedido grátis cancelado (2026-10-11): sai de cancelarPedidoGratis (API),
  // na mesma transação do cancelamento — sem texto de dinheiro
  if (template === "free_ticket_canceled") {
    if (channel === "EMAIL") {
      return email(renderFreeTicketCanceledEmail(recipient, payload as FreeTicketCanceledPayload));
    }
    throw new Error(`Canal não suportado para free_ticket_canceled: ${channel}`);
  }

  if (template === "free_event_canceled") {
    if (channel === "EMAIL") {
      return email(renderFreeEventCanceledEmail(recipient, payload as FreeEventCanceledPayload));
    }
    throw new Error(`Canal não suportado para free_event_canceled: ${channel}`);
  }

  // reembolso recusado (2026-10-13): sai de recusarPedidoDeReembolso (API), na
  // mesma transação que marca a recusa — casa ou BoraFest
  if (template === "refund_request_rejected") {
    if (channel === "EMAIL") {
      return email(renderRefundRequestRejectedEmail(recipient, payload as RefundRequestRejectedPayload));
    }
    throw new Error(`Canal não suportado para refund_request_rejected: ${channel}`);
  }

  // convite por e-mail (2026-10-12): sai do painel (convites-email na API), na
  // mesma transação que cria, reenvia ou corrige o convite
  if (template === "lot_email_invite") {
    if (channel === "EMAIL") {
      return email(renderLotEmailInviteEmail(recipient, payload as LotEmailInvitePayload));
    }
    throw new Error(`Canal não suportado para lot_email_invite: ${channel}`);
  }

  if (template === "crm_reactivation") {
    if (channel === "EMAIL") {
      return email(renderCrmReactivationEmail(recipient, payload as CrmReactivationPayload));
    }
    throw new Error(`Canal não suportado para crm_reactivation: ${channel}`);
  }

  if (template === "promoter_invited") {
    if (channel === "EMAIL") {
      const p = payload as { orgName: string; eventTitle?: string | null; panelUrl: string };
      const escopo = p.eventTitle ? ` para o evento ${p.eventTitle}` : "";
      return email({
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
    }
    throw new Error(`Canal não suportado para promoter_invited: ${channel}`);
  }

  if (template === "member_invited") {
    if (channel === "EMAIL") {
      const p = payload as { orgName: string; roleKey: string; panelUrl: string };
      return email({
        to: recipient,
        subject: `${p.orgName} te convidou para a equipe 🎉`,
        text: [
          `${p.orgName} te convidou para fazer parte da equipe na BoraFest (papel: ${p.roleKey}).`,
          "",
          "Entre no painel com este mesmo e-mail para aceitar:",
          p.panelUrl,
          "",
          "Equipe BoraFest",
        ].join("\n"),
        html: `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
  <p><b>${p.orgName}</b> te convidou para fazer parte da equipe na BoraFest (papel: <b>${p.roleKey}</b>).</p>
  <p><a href="${p.panelUrl}" style="display:inline-block;background:#D9128F;color:#fff;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">Entrar no painel</a></p>
  <p style="color:#666;font-size:13px">Entre com este mesmo e-mail para aceitar o convite.</p>
  <p>Equipe BoraFest</p>
</div>`.trim(),
      });
    }
    throw new Error(`Canal não suportado para member_invited: ${channel}`);
  }

  if (template === "cpf_defined") {
    if (channel === "EMAIL") {
      const p = payload as { cpfMasked: string; name?: string | null };
      const ola = p.name ? `Olá, ${p.name}!` : "Olá!";
      return email({
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
    }
    throw new Error(`Canal não suportado para cpf_defined: ${channel}`);
  }

  if (template !== "ticket_delivery") {
    throw new Error(`Template de notificação desconhecido: ${template}`);
  }
  const data = payload as TicketDeliveryPayload;

  if (channel === "EMAIL") {
    return email(renderTicketDeliveryEmail(recipient, data));
  }
  if (channel === "WHATSAPP") {
    const message = renderTicketDeliveryWhatsApp(data);
    await getWhatsAppSender().send({ to: recipient, ...message });
    return null;
  }
  if (channel === "PUSH") {
    await getPushSender().send(renderTicketDeliveryPush(recipient, data));
    return null;
  }
  throw new Error(`Canal de notificação desconhecido: ${channel}`);
}
