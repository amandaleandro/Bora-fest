import { withContext } from "@borafest/observability";
import { NotificationSendError, type WhatsAppMessage, type WhatsAppSender } from "./types";

const log = withContext({ module: "notifications-whatsapp-meta" });

export const WHATSAPP_META_PROVIDER = "meta";

const GRAPH_API_BASE = "https://graph.facebook.com/v20.0";

/**
 * Adapter real de WhatsApp (Meta Cloud API). Mesmo espírito do Resend: sem
 * SDK, um POST com Bearer no Graph API do número da conta business.
 *
 * Env: WHATSAPP_CLOUD_TOKEN e WHATSAPP_PHONE_NUMBER_ID (obrigatórios).
 * Ative com WHATSAPP_PROVIDER=meta — sem as chaves, fique no devlog.
 */
export class MetaWhatsAppSender implements WhatsAppSender {
  readonly provider = WHATSAPP_META_PROVIDER;

  async send(message: WhatsAppMessage): Promise<void> {
    const token = process.env.WHATSAPP_CLOUD_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) {
      throw new NotificationSendError(
        "WHATSAPP_CLOUD_TOKEN e WHATSAPP_PHONE_NUMBER_ID são obrigatórios com WHATSAPP_PROVIDER=meta",
      );
    }

    const response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: message.to,
        ...toGraphPayload(message),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // erro joga para o chamador (worker reagenda com backoff; endpoint devolve erro)
      throw new NotificationSendError(`Meta respondeu ${response.status}: ${body.slice(0, 200)}`);
    }

    log.info({ to: message.to }, "whatsapp enviado pela Meta Cloud API");
  }
}

/** Corpo específico de cada tipo de mensagem no Graph API. */
function toGraphPayload(message: WhatsAppMessage): Record<string, unknown> {
  if ("template" in message) {
    // template aprovado com parâmetros nomeados (mesmas chaves de `variables`)
    return {
      type: "template",
      template: {
        name: message.template,
        language: { code: "pt_BR" },
        components: [
          {
            type: "body",
            parameters: Object.entries(message.variables).map(([name, text]) => ({
              type: "text",
              parameter_name: name,
              text,
            })),
          },
        ],
      },
    };
  }
  if ("imageUrl" in message) {
    return { type: "image", image: { link: message.imageUrl, caption: message.caption } };
  }
  return { type: "text", text: { body: message.text, preview_url: true } };
}
