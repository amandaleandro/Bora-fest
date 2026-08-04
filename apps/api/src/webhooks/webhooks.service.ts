import { Injectable, NotFoundException } from "@nestjs/common";
import { createPaymentWebhookProcessingQueue, type PaymentWebhookProcessingJobData } from "@borafest/queues";
import { getGateway, UnknownGatewayError, type WebhookHeaders } from "@borafest/payments";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "payment-webhooks" });

@Injectable()
export class WebhooksService {
  private readonly processingQueue = createPaymentWebhookProcessingQueue();

  /**
   * Recepção do webhook: só confere que o provedor existe e enfileira o
   * payload bruto pro worker processar — nenhuma escrita no banco acontece
   * aqui. Isso mantém a resposta ao gateway rápida mesmo sob pico de
   * confirmações simultâneas (ex.: lote esgotando), em vez de segurar a
   * conexão do gateway atrás de transações de banco. A verificação de
   * assinatura e o efeito no pagamento ficam no worker (processPaymentWebhookJob),
   * que é quem grava o `webhook_deliveries` (payload sempre auditado, mesmo
   * quando a assinatura é inválida).
   */
  async handlePaymentWebhook(provider: string, headers: WebhookHeaders, rawBody: string) {
    try {
      getGateway(provider);
    } catch (error) {
      if (error instanceof UnknownGatewayError) {
        throw new NotFoundException("Provedor de pagamento desconhecido");
      }
      throw error;
    }

    await this.processingQueue.add("process", { provider, headers: this.sanitizeHeaders(headers), rawBody });

    log.info({ provider }, "webhook de pagamento recebido e enfileirado");
    return { received: true, queued: true };
  }

  /** Nunca persistir credenciais dos headers. */
  private sanitizeHeaders(headers: WebhookHeaders): PaymentWebhookProcessingJobData["headers"] {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === "authorization" || key.toLowerCase() === "cookie") continue;
      out[key] = Array.isArray(value) ? value.join(",") : (value ?? "");
    }
    return out;
  }
}
