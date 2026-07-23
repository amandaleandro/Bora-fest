import { Queue, Worker, type Processor } from "bullmq";
import { getRedisConnection } from "./connection";

/**
 * Reconciliação periódica com o gateway (arquitetura §11): pagamentos PENDING
 * antigos são consultados na origem para corrigir webhooks perdidos.
 */
export const PAYMENT_RECONCILIATION_QUEUE = "payment-reconciliation";
export const PAYMENT_RECONCILIATION_JOB_ID = "reconcile-pending-payments";

export function createPaymentReconciliationQueue() {
  return new Queue(PAYMENT_RECONCILIATION_QUEUE, { connection: getRedisConnection() });
}

export function createPaymentReconciliationWorker(processor: Processor) {
  return new Worker(PAYMENT_RECONCILIATION_QUEUE, processor, {
    connection: getRedisConnection(),
  });
}
