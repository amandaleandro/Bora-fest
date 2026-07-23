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
