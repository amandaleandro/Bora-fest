import { Queue, Worker, type Processor } from "bullmq";
import { getRedisConnection , LIMPEZA_PADRAO } from "./connection";

/**
 * Repasse automático (decisão 2026-07-28): varre organizações com
 * autoPayout ligado e cria o Payout do saldo recém-liberado da janela de
 * reembolso — a execução bancária continua com o backoffice (ou, no futuro,
 * transferência via API do Asaas).
 */
export const AUTO_PAYOUTS_QUEUE = "auto-payouts";
export const AUTO_PAYOUTS_JOB_ID = "sweep-auto-payouts";

export function createAutoPayoutsQueue() {
  return new Queue(AUTO_PAYOUTS_QUEUE, { connection: getRedisConnection(), defaultJobOptions: LIMPEZA_PADRAO });
}

export function createAutoPayoutsWorker(processor: Processor) {
  return new Worker(AUTO_PAYOUTS_QUEUE, processor, {
    connection: getRedisConnection(),
  });
}
