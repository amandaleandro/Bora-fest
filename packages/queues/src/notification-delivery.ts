import { Queue, Worker, type Processor } from "bullmq";
import { getRedisConnection } from "./connection";

/**
 * Entrega de notificações (§14): scheduler varre a tabela `notifications`
 * (fila persistente no Postgres — queda de Redis não perde mensagem) e envia
 * via adapters de e-mail/WhatsApp.
 */
export const NOTIFICATION_DELIVERY_QUEUE = "notification-delivery";
export const NOTIFICATION_DELIVERY_JOB_ID = "deliver-pending-notifications";

export function createNotificationDeliveryQueue() {
  return new Queue(NOTIFICATION_DELIVERY_QUEUE, { connection: getRedisConnection() });
}

export function createNotificationDeliveryWorker(processor: Processor) {
  return new Worker(NOTIFICATION_DELIVERY_QUEUE, processor, {
    connection: getRedisConnection(),
  });
}
