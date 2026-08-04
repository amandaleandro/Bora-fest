import { prisma } from "@borafest/database";
import { getRedisConnection, sweepWaitingRoom, WAITING_ROOM_PENDING_EVENTS_KEY } from "@borafest/queues";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "waiting-room-sweep" });

/** Promove fila → admitidos em todo evento com sala de espera pendente. */
export async function sweepWaitingRooms(): Promise<void> {
  const redis = getRedisConnection();
  const eventIds = await redis.smembers(WAITING_ROOM_PENDING_EVENTS_KEY);
  if (eventIds.length === 0) return;

  const events = await prisma.event.findMany({
    where: { id: { in: eventIds } },
    select: { id: true, waitingRoomConcurrency: true },
  });
  const concurrencyById = new Map(events.map((e) => [e.id, e.waitingRoomConcurrency]));

  for (const eventId of eventIds) {
    try {
      await sweepWaitingRoom(redis, eventId, concurrencyById.get(eventId) ?? 300);
    } catch (error) {
      log.error({ eventId, error: (error as Error).message }, "falha ao varrer sala de espera");
    }
  }
}
