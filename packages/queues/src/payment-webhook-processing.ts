import { Queue, Worker, type Processor } from "bullmq";
import { getRedisConnection } from "./connection";

/**
 * Processamento assíncrono de webhooks de pagamento: a requisição HTTP do
 * gateway só valida a assinatura e grava o payload bruto (rápido, sem
 * contenção) — o trabalho de banco (idempotência do evento + aplicar o
 * status ao pagamento/pedido, tudo em transação) fica com o worker. Isso
 * evita que um pico de confirmações simultâneas (ex.: lote esgotando)
 * segure conexões de banco na resposta ao gateway, e some acumula fila em
 * vez de gerar timeout/retry em cascata do lado do provedor.
 */
export const PAYMENT_WEBHOOK_PROCESSING_QUEUE = "payment-webhook-processing";

export interface PaymentWebhookProcessingJobData {
  provider: string;
  headers: Record<string, string>;
  rawBody: string;
}

export function createPaymentWebhookProcessingQueue() {
  return new Queue<PaymentWebhookProcessingJobData>(PAYMENT_WEBHOOK_PROCESSING_QUEUE, {
    connection: getRedisConnection(),
  });
}

/** Concorrência alta: cada job é independente (payment_id diferente) e o gargalo é I/O de banco, não CPU. */
export function createPaymentWebhookProcessingWorker(
  processor: Processor<PaymentWebhookProcessingJobData>,
) {
  return new Worker<PaymentWebhookProcessingJobData>(PAYMENT_WEBHOOK_PROCESSING_QUEUE, processor, {
    connection: getRedisConnection(),
    concurrency: 10,
  });
}
