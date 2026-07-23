import { Queue, Worker, type Processor } from "bullmq";
import { getRedisConnection } from "./connection";

/**
 * Despacho do Outbox Pattern: um scheduler repetitivo varre `outbox_events`
 * PENDING e processa (ex.: `order.paid` → emissão de ingressos). O worker é
 * idempotente — reprocessar um evento nunca gera efeito duplicado.
 */
export const OUTBOX_DISPATCH_QUEUE = "outbox-dispatch";
export const OUTBOX_DISPATCH_JOB_ID = "dispatch-outbox-events";

export function createOutboxDispatchQueue() {
  return new Queue(OUTBOX_DISPATCH_QUEUE, { connection: getRedisConnection() });
}

export function createOutboxDispatchWorker(processor: Processor) {
  return new Worker(OUTBOX_DISPATCH_QUEUE, processor, { connection: getRedisConnection() });
}
