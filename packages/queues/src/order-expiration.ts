import { Queue, Worker, type Processor } from "bullmq";
import { getRedisConnection } from "./connection";

/**
 * Expiração da janela de pagamento: pedidos PAYMENT_PENDING cujo `expires_at`
 * passou sem pagamento aprovado são expirados e o estoque reservado liberado.
 */
export const ORDER_EXPIRATION_QUEUE = "order-expiration";
export const ORDER_EXPIRATION_JOB_ID = "expire-stale-orders";

export function createOrderExpirationQueue() {
  return new Queue(ORDER_EXPIRATION_QUEUE, { connection: getRedisConnection() });
}

export function createOrderExpirationWorker(processor: Processor) {
  return new Worker(ORDER_EXPIRATION_QUEUE, processor, { connection: getRedisConnection() });
}
