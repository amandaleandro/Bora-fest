import IORedis from "ioredis";
import { getRedisConnection } from "./connection";

const CHANNEL = "ranking:updates";

/**
 * Notifica que o ranking de vendas por atlética/parceiro de um evento mudou
 * (nova venda paga/emitida). Fire-and-forget: publica no Redis, quem estiver
 * com uma stream SSE aberta (apps/api) reencaminha pro navegador. Publica no
 * cliente de comandos comum — PUBLISH não exige conexão dedicada, só SUBSCRIBE.
 */
export function publishRankingUpdate(eventId: string): void {
  getRedisConnection()
    .publish(CHANNEL, JSON.stringify({ eventId }))
    .catch((error) => console.warn("[ranking-events] falha ao publicar ranking:updates", eventId, (error as Error).message));
}

/**
 * SUBSCRIBE bloqueia a conexão pra comandos normais, então usa uma conexão
 * Redis dedicada (nunca a compartilhada de getRedisConnection). Retorna uma
 * função de cleanup pra fechar a conexão quando o consumidor (ex.: uma stream
 * SSE) se desconectar.
 */
export function subscribeRankingUpdates(onUpdate: (eventId: string) => void): () => void {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");

  const subscriber = new IORedis(url, { maxRetriesPerRequest: null });
  subscriber
    .subscribe(CHANNEL)
    .catch((error) => console.error("[ranking-events] falha ao inscrever em ranking:updates", (error as Error).message));
  subscriber.on("message", (_channel, message) => {
    try {
      const parsed = JSON.parse(message) as { eventId: string };
      onUpdate(parsed.eventId);
    } catch (error) {
      console.warn("[ranking-events] mensagem inválida em ranking:updates", (error as Error).message);
    }
  });

  return () => {
    subscriber.disconnect();
  };
}
