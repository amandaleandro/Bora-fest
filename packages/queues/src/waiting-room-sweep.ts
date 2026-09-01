import { Queue, Worker, type Processor } from "bullmq";
import { getRedisConnection , LIMPEZA_PADRAO } from "./connection";

/**
 * Varredura da sala de espera: promove gente da fila (`wr:queue:{eventId}`)
 * pro conjunto de admitidos (`wr:active:{eventId}`) enquanto houver vaga
 * (concorrência configurada no evento). Só evita escanear TODO evento a cada
 * tick porque só entram em `wr:pending-events` os que têm fila não-vazia.
 */
export const WAITING_ROOM_SWEEP_QUEUE = "waiting-room-sweep";
export const WAITING_ROOM_SWEEP_JOB_ID = "sweep-waiting-rooms";

export function createWaitingRoomSweepQueue() {
  return new Queue(WAITING_ROOM_SWEEP_QUEUE, { connection: getRedisConnection(), defaultJobOptions: LIMPEZA_PADRAO });
}

export function createWaitingRoomSweepWorker(processor: Processor) {
  return new Worker(WAITING_ROOM_SWEEP_QUEUE, processor, { connection: getRedisConnection() });
}
