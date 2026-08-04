import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";

/**
 * Lógica pura da sala de espera (sem I/O de banco) — compartilhada entre a
 * API (join/status, na requisição do comprador) e o worker (sweep, promove
 * fila → admitidos). Fica em `@borafest/queues` porque ambos os apps já
 * dependem dele para a conexão Redis.
 *
 * Estruturas por evento:
 * - `wr:active:{eventId}` (sorted set): membro = ticketId, score = expiração
 *   (ms epoch) do slot admitido.
 * - `wr:queue:{eventId}` (list): FIFO de ticketId esperando vaga.
 * - `wr:pending-events` (set): eventIds com fila não vazia — o worker só
 *   varre esses, em vez de escanear todo evento a cada tick.
 */

export const WAITING_ROOM_ADMISSION_TTL_MS = 12 * 60 * 1000; // 10min de reserva + folga de navegação
export const WAITING_ROOM_PENDING_EVENTS_KEY = "wr:pending-events";

function activeKey(eventId: string): string {
  return `wr:active:${eventId}`;
}
function queueKey(eventId: string): string {
  return `wr:queue:${eventId}`;
}

export type WaitingRoomJoinResult =
  | { status: "ADMITTED"; ticketId: string }
  | { status: "QUEUED"; ticketId: string; position: number };

export type WaitingRoomStatusResult =
  | { status: "ADMITTED" }
  | { status: "QUEUED"; position: number }
  | { status: "EXPIRED" };

/** Admite direto se houver vaga; senão entra no fim da fila. */
export async function joinWaitingRoom(
  redis: Redis,
  eventId: string,
  concurrency: number,
): Promise<WaitingRoomJoinResult> {
  const now = Date.now();
  const ticketId = randomUUID();

  await redis.zremrangebyscore(activeKey(eventId), "-inf", now);
  const activeCount = await redis.zcard(activeKey(eventId));

  if (activeCount < concurrency) {
    await redis.zadd(activeKey(eventId), now + WAITING_ROOM_ADMISSION_TTL_MS, ticketId);
    return { status: "ADMITTED", ticketId };
  }

  await redis.rpush(queueKey(eventId), ticketId);
  await redis.sadd(WAITING_ROOM_PENDING_EVENTS_KEY, eventId);
  const position = await redis.llen(queueKey(eventId));
  return { status: "QUEUED", ticketId, position };
}

/** Consulta a posição/estado do ticket; se admitido, renova o slot (sliding TTL) enquanto o comprador está ativo. */
export async function getWaitingRoomStatus(
  redis: Redis,
  eventId: string,
  ticketId: string,
): Promise<WaitingRoomStatusResult> {
  const now = Date.now();
  await redis.zremrangebyscore(activeKey(eventId), "-inf", now);

  const score = await redis.zscore(activeKey(eventId), ticketId);
  if (score !== null) {
    await redis.zadd(activeKey(eventId), now + WAITING_ROOM_ADMISSION_TTL_MS, ticketId);
    return { status: "ADMITTED" };
  }

  const position = await redis.lpos(queueKey(eventId), ticketId);
  if (position !== null) {
    return { status: "QUEUED", position: position + 1 };
  }

  return { status: "EXPIRED" };
}

/** Verificação server-side (gate na criação da reserva) — não renova o TTL. */
export async function isWaitingRoomAdmitted(
  redis: Redis,
  eventId: string,
  ticketId: string,
): Promise<boolean> {
  const score = await redis.zscore(activeKey(eventId), ticketId);
  return score !== null && Number(score) > Date.now();
}

/** Promove da fila pros admitidos enquanto houver vaga; some da lista de pendentes quando esvazia. */
export async function sweepWaitingRoom(
  redis: Redis,
  eventId: string,
  concurrency: number,
): Promise<void> {
  const now = Date.now();
  await redis.zremrangebyscore(activeKey(eventId), "-inf", now);

  let activeCount = await redis.zcard(activeKey(eventId));
  while (activeCount < concurrency) {
    const ticketId = await redis.lpop(queueKey(eventId));
    if (!ticketId) break;
    await redis.zadd(activeKey(eventId), now + WAITING_ROOM_ADMISSION_TTL_MS, ticketId);
    activeCount++;
  }

  const [remainingQueue, remainingActive] = await Promise.all([
    redis.llen(queueKey(eventId)),
    redis.zcard(activeKey(eventId)),
  ]);
  if (remainingQueue === 0 && remainingActive === 0) {
    await redis.srem(WAITING_ROOM_PENDING_EVENTS_KEY, eventId);
  }
}
