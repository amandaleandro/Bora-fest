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
    // RETRY (auditoria 2026-08-12): sem isso o BullMQ tenta 1 vez só. Uma falha
    // transitória (deadlock com o expirador de pedidos, blip de conexão) marcava
    // a entrega FAILED e o evento se PERDIA — a API já respondeu 200, o gateway
    // não reenvia, e a reconciliação não cobre estorno/chargeback. Com retry, o
    // efeito (idempotente pelo dedupe de evento) é re-tentado até completar.
    defaultJobOptions: {
      attempts: 6,
      backoff: { type: "exponential", delay: 3000 },
      // NÃO reter o job após processar (auditoria 2026-08-30): o payload carrega
      // os cabeçalhos com o segredo do webhook para a verificação no worker;
      // removê-lo na conclusão tira o segredo do Redis em segundos, em vez de
      // deixá-lo nos últimos 1000 jobs. Falhas expiram em 1h (retry cabe nisso).
      removeOnComplete: true,
      removeOnFail: { age: 3600 },
    },
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
