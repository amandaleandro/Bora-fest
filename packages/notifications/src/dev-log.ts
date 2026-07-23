import { withContext } from "@borafest/observability";
import type { EmailMessage, EmailSender, PushMessage, PushSender, WhatsAppMessage, WhatsAppSender } from "./types";

const log = withContext({ module: "notifications-dev" });

/**
 * Adapters de desenvolvimento: apenas registram no log estruturado.
 * O provedor real (SES/Resend/Postmark; Meta Cloud API/Twilio) é uma decisão
 * comercial pendente — entra como novo adapter sem tocar o restante.
 */
export const DEVLOG_PROVIDER = "devlog";

export class DevLogEmailSender implements EmailSender {
  readonly provider = DEVLOG_PROVIDER;

  async send(message: EmailMessage): Promise<void> {
    log.info(
      { channel: "email", to: message.to, subject: message.subject, text: message.text },
      "e-mail (dev) enviado para o log",
    );
  }
}

export class DevLogWhatsAppSender implements WhatsAppSender {
  readonly provider = DEVLOG_PROVIDER;

  async send(message: WhatsAppMessage): Promise<void> {
    log.info(
      { channel: "whatsapp", to: message.to, template: message.template, variables: message.variables },
      "whatsapp (dev) enviado para o log",
    );
  }
}

export class DevLogPushSender implements PushSender {
  readonly provider = DEVLOG_PROVIDER;

  async send(message: PushMessage): Promise<void> {
    log.info(
      { channel: "push", to: message.to, title: message.title, body: message.body },
      "push (dev) enviado para o log",
    );
  }
}
