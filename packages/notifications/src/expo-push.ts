import { NotificationSendError } from "./types";
import type { PushMessage, PushSender } from "./types";

/**
 * Push via Expo Push API (https://exp.host/--/api/v2/push/send) — diferente
 * de e-mail/WhatsApp, não é uma decisão comercial pendente: o serviço é
 * gratuito e não exige conta/credencial pra funcionar (`EXPO_ACCESS_TOKEN` é
 * opcional, só recomendado pra evitar rate-limit em volume alto). Por isso
 * é o adapter DEFAULT de push, ao contrário de e-mail/WhatsApp que caem em
 * devlog até um provedor real ser escolhido.
 */
export const EXPO_PUSH_PROVIDER = "expo";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export class ExpoPushSender implements PushSender {
  readonly provider = EXPO_PUSH_PROVIDER;

  async send(message: PushMessage): Promise<void> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (process.env.EXPO_ACCESS_TOKEN) {
      headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    }

    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: message.to,
        title: message.title,
        body: message.body,
        data: message.data,
      }),
    });

    const result: any = await response.json().catch(() => null);
    const ticket = Array.isArray(result?.data) ? result.data[0] : result?.data;

    if (!response.ok || ticket?.status === "error") {
      throw new NotificationSendError(
        `Expo Push API recusou o envio: ${ticket?.message ?? response.statusText}`,
      );
    }
  }
}
