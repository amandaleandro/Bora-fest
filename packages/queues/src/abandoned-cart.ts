import { Queue, Worker, type Processor } from "bullmq";
import { getRedisConnection } from "./connection";

/**
 * Lembrete de carrinho abandonado: pedidos CREATED/PAYMENT_PENDING antigos o
 * bastante para o comprador ter desistido, mas ainda dentro da janela de
 * pagamento (senão o expire-orders já cuidou). Um e-mail por pedido.
 */
export const ABANDONED_CART_QUEUE = "abandoned-cart";
export const ABANDONED_CART_JOB_ID = "remind-abandoned-carts";

export function createAbandonedCartQueue() {
  return new Queue(ABANDONED_CART_QUEUE, { connection: getRedisConnection() });
}

export function createAbandonedCartWorker(processor: Processor) {
  return new Worker(ABANDONED_CART_QUEUE, processor, { connection: getRedisConnection() });
}
