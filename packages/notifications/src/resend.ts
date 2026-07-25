import { withContext } from "@borafest/observability";
import { NotificationSendError, type EmailMessage, type EmailSender } from "./types";

const log = withContext({ module: "notifications-resend" });

export const RESEND_PROVIDER = "resend";

/**
 * Adapter real de e-mail (Resend — https://resend.com/docs/api-reference).
 * Escolhido por ser o de menor atrito para começar: sem SDK, só um POST com
 * Bearer. Trocar por SES/Postmark é escrever outro adapter com esta interface.
 *
 * Env: RESEND_API_KEY (obrigatório) e EMAIL_FROM (ex.: "BoraFest <ingressos@borafest.com.br>").
 * Ative com EMAIL_PROVIDER=resend.
 */
export class ResendEmailSender implements EmailSender {
  readonly provider = RESEND_PROVIDER;

  async send(message: EmailMessage): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      throw new NotificationSendError(
        "RESEND_API_KEY e EMAIL_FROM são obrigatórios com EMAIL_PROVIDER=resend",
      );
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // erro joga para o worker, que reagenda com backoff e conta a tentativa
      throw new NotificationSendError(`Resend respondeu ${response.status}: ${body.slice(0, 200)}`);
    }

    log.info({ to: message.to, subject: message.subject }, "e-mail enviado pelo Resend");
  }
}
