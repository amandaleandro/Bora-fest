import IORedis from "ioredis";

let connection: IORedis | undefined;

export function getRedisConnection(): IORedis {
  if (!connection) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is not set");
    connection = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return connection;
}

/** Só pra scripts de vida curta (testes) — a API/worker mantêm a conexão aberta pra sempre. */
export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = undefined;
  }
}

/**
 * Limpeza padrão de jobs (incidente de performance 2026-08-30): sem
 * removeOnComplete/removeOnFail o BullMQ guarda TODO job concluído para
 * sempre — os sweeps de 2-5s acumularam 2,4 MILHÕES de chaves (3GB) em ~26
 * dias e empurraram o VPS pro swap. Jobs de varredura não carregam informação:
 * 1h de completed e 24h de failed (forense) é mais que suficiente.
 */
export const LIMPEZA_PADRAO = {
  removeOnComplete: { age: 3600, count: 100 },
  removeOnFail: { age: 24 * 3600, count: 1000 },
} as const;
