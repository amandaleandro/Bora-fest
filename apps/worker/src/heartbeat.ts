import { getRedisConnection } from "@borafest/queues";
import { withContext } from "@borafest/observability";

/**
 * Batida do worker (2026-10-12): o /health da API não tinha como saber se o
 * worker estava vivo — worker parado (ingresso sem emitir, e-mail sem sair)
 * aparecia como "ok". Agora o worker grava a cada 30 s uma chave no Redis com
 * validade de 90 s; o /health lê essa chave e responde 503 se ela sumir
 * (3 batidas perdidas) ou se alguma fila estiver parada.
 *
 * A batida só diz "estou vivo" se o processo responde (o setInterval roda) E
 * o Redis aceita a escrita; a lista `filasParadas` diz quais consumidores do
 * BullMQ não estão rodando (isRunning() = false: fechado ou caído).
 */

/** MESMA chave lida por apps/api/src/health/health.checks.ts — mudou aqui, muda lá. */
export const WORKER_HEARTBEAT_KEY = "borafest:worker:heartbeat";
export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;
/** 3 batidas: tolera uma batida atrasada sem alarme falso. */
export const WORKER_HEARTBEAT_TTL_SECONDS = 90;
/** Uma escrita presa (Redis caído) não pode empilhar batidas. */
const PRAZO_ESCRITA_MS = 5_000;

const log = withContext({ module: "worker-heartbeat" });

type ClienteRedis = ReturnType<typeof getRedisConnection>;

/** O mínimo que a batida precisa saber de cada consumidor BullMQ. */
export interface ConsumidorObservado {
  nome: string;
  estaRodando: () => boolean;
}

/** Valor gravado na chave: só horário e nomes de fila (nada sensível). */
export function montarBatida(consumidores: ConsumidorObservado[], agora: Date = new Date()): string {
  const filasParadas: string[] = [];
  for (const c of consumidores) {
    let rodando = false;
    try {
      rodando = c.estaRodando();
    } catch {
      rodando = false;
    }
    if (!rodando) filasParadas.push(c.nome);
  }
  return JSON.stringify({ em: agora.toISOString(), filasParadas });
}

/** Grava uma batida (com prazo). Rejeita se o Redis não aceitar a escrita. */
export async function baterUmaVez(
  redis: ClienteRedis,
  consumidores: ConsumidorObservado[],
  agora: Date = new Date(),
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis não respondeu em ${PRAZO_ESCRITA_MS} ms`)), PRAZO_ESCRITA_MS);
    timer.unref();
  });
  try {
    await Promise.race([
      redis.set(WORKER_HEARTBEAT_KEY, montarBatida(consumidores, agora), "EX", WORKER_HEARTBEAT_TTL_SECONDS),
      prazo,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Começa a bater já (sem esperar 30 s) e repete a cada intervalo. Falha de
 * escrita só vai pro log — a batida nunca derruba o worker. Devolve a função
 * que para a batida (usada no desligamento educado).
 */
export function iniciarBatidaDoWorker(opcoes: {
  consumidores: ConsumidorObservado[];
  redis?: ClienteRedis;
  intervaloMs?: number;
}): () => void {
  const intervaloMs = opcoes.intervaloMs ?? WORKER_HEARTBEAT_INTERVAL_MS;
  let emAndamento = false;
  let falhando = false;

  const bater = async () => {
    if (emAndamento) return; // a anterior ainda está presa: não empilha
    emAndamento = true;
    try {
      await baterUmaVez(opcoes.redis ?? getRedisConnection(), opcoes.consumidores);
      if (falhando) log.info("batida do worker voltou a ser gravada no Redis");
      falhando = false;
    } catch (error) {
      // loga só na primeira falha seguida, para não encher o log a cada 30 s
      if (!falhando) {
        log.error({ error: (error as Error).message }, "não consegui gravar a batida do worker no Redis");
      }
      falhando = true;
    } finally {
      emAndamento = false;
    }
  };

  void bater();
  const timer = setInterval(() => void bater(), intervaloMs);
  // não segura o processo vivo sozinho: quem decide o fim é o shutdown
  timer.unref();
  return () => clearInterval(timer);
}
