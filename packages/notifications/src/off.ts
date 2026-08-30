import { withContext } from "@borafest/observability";
import type { WhatsAppMessage, WhatsAppSender } from "./types";

const log = withContext({ module: "notifications-off" });

/**
 * Canal DESLIGADO de verdade (incidente 2026-08-30): produção sem WhatsApp
 * contratado precisa de um provider válido que NÃO grave telefone/OTP/link no
 * log (o devlog é proibido em produção pelo assertProductionProviders e o
 * compose usava devlog como default — a API entrava em crash-loop sem saída
 * pelo env). O "off" descarta o envio e registra só a contagem, sem PII.
 */
export const OFF_PROVIDER = "off";

export class OffWhatsAppSender implements WhatsAppSender {
  readonly provider = OFF_PROVIDER;

  async send(_message: WhatsAppMessage): Promise<void> {
    log.info({ channel: "whatsapp" }, "whatsapp desligado (WHATSAPP_PROVIDER=off) — envio descartado");
  }
}
