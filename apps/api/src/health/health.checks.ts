/**
 * Saúde da plataforma para monitor externo (2026-10-12).
 *
 * Antes o /health só fazia `SELECT 1`: com o Redis fora ou o worker parado
 * (ingresso sem emitir, e-mail sem sair), ele seguia dizendo "ok" e quem
 * descobria era o comprador. Agora o /health olha três coisas e responde 503
 * com o motivo se qualquer uma falhar:
 *   - banco: `SELECT 1` com prazo;
 *   - Redis: conexão pronta + leitura com prazo;
 *   - worker: a batida que apps/worker/src/heartbeat.ts grava a cada 30 s
 *     numa chave com validade de 90 s (3 batidas perdidas = parado).
 *
 * Este arquivo não importa banco nem Redis: recebe as consultas por
 * parâmetro, para dar para testar sem infraestrutura. O controller liga as
 * consultas reais. A resposta não leva mensagem de erro nem endereço interno.
 */

/** MESMA chave gravada por apps/worker/src/heartbeat.ts — mudou lá, muda aqui. */
export const WORKER_HEARTBEAT_KEY = "borafest:worker:heartbeat";

/** Sem batida há mais que isto, o worker conta como parado. */
export const WORKER_HEARTBEAT_MAX_AGE_SECONDS = 90;

/** Prazos curtos: o monitor externo espera uns 5 s; o /health tem que responder antes. */
export const PRAZO_BANCO_MS = 3_000;
export const PRAZO_REDIS_MS = 1_500;

export type Situacao = "up" | "down";

export interface CorpoSaude {
  status: "ok" | "erro";
  db: Situacao;
  redis: Situacao;
  worker: Situacao | "desconhecido";
  timestamp: string;
  /** só quando algo falhou: frases curtas, sem detalhe técnico sensível */
  motivos?: string[];
}

export interface DependenciasSaude {
  /** resolve se o banco respondeu; rejeita se não */
  pingBanco: () => Promise<unknown>;
  /** true se a conexão com o Redis está pronta para comandos */
  redisPronto: () => boolean;
  /** valor bruto da chave da batida (null = chave não existe) */
  lerBatida: () => Promise<string | null>;
}

/**
 * Rejeita se a promessa não resolver em `ms`. Necessário porque a conexão
 * Redis compartilhada usa `maxRetriesPerRequest: null`: com o Redis caído,
 * um comando fica na fila esperando para sempre em vez de falhar.
 */
export function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`sem resposta em ${ms} ms`)), ms);
  });
  return Promise.race([promessa, prazo]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

interface BatidaLida {
  em: Date;
  filasParadas: string[];
}

/** Aceita o JSON gravado pelo worker ({"em": ISO, "filasParadas": [...]}) ou um ISO puro. */
export function lerValorDaBatida(valor: string | null): BatidaLida | null {
  if (!valor) return null;
  let em: unknown = valor;
  let filasParadas: string[] = [];
  try {
    const obj = JSON.parse(valor) as { em?: unknown; filasParadas?: unknown };
    if (obj && typeof obj === "object") {
      em = obj.em;
      if (Array.isArray(obj.filasParadas)) {
        filasParadas = obj.filasParadas.filter((f): f is string => typeof f === "string");
      }
    }
  } catch {
    // não é JSON: tenta como data ISO pura
  }
  if (typeof em !== "string") return null;
  const data = new Date(em);
  if (Number.isNaN(data.getTime())) return null;
  return { em: data, filasParadas };
}

/** Decide o resultado a partir do que foi medido. Puro, sem I/O. */
export function avaliarSaude(medicao: {
  db: boolean;
  redis: boolean;
  /** valor bruto da chave; null = chave ausente; ignorado se redis=false */
  batida: string | null;
  agora: Date;
}): { ok: boolean; corpo: CorpoSaude } {
  const motivos: string[] = [];

  if (!medicao.db) motivos.push("banco de dados não respondeu");

  let worker: CorpoSaude["worker"] = "desconhecido";
  if (!medicao.redis) {
    motivos.push("Redis não respondeu (filas, sala de espera e emissão de ingressos dependem dele)");
  } else {
    const batida = lerValorDaBatida(medicao.batida);
    if (!batida) {
      worker = "down";
      motivos.push(
        `worker sem sinal de vida há mais de ${WORKER_HEARTBEAT_MAX_AGE_SECONDS} s (ingressos e e-mails podem não estar saindo)`,
      );
    } else {
      const idadeSegundos = Math.round((medicao.agora.getTime() - batida.em.getTime()) / 1000);
      if (idadeSegundos > WORKER_HEARTBEAT_MAX_AGE_SECONDS) {
        worker = "down";
        motivos.push(
          `worker sem sinal de vida há ${idadeSegundos} s (ingressos e e-mails podem não estar saindo)`,
        );
      } else if (batida.filasParadas.length > 0) {
        worker = "down";
        motivos.push(`worker com fila parada: ${batida.filasParadas.join(", ")}`);
      } else {
        worker = "up";
      }
    }
  }

  const ok = motivos.length === 0;
  const corpo: CorpoSaude = {
    status: ok ? "ok" : "erro",
    db: medicao.db ? "up" : "down",
    redis: medicao.redis ? "up" : "down",
    worker,
    timestamp: medicao.agora.toISOString(),
  };
  if (!ok) corpo.motivos = motivos;
  return { ok, corpo };
}

/**
 * Mede banco e Redis em paralelo, cada um com prazo, e avalia. Nunca rejeita:
 * qualquer falha de medição vira "down" no componente correspondente.
 */
export async function verificarSaude(
  deps: DependenciasSaude,
  agora: () => Date = () => new Date(),
): Promise<{ ok: boolean; corpo: CorpoSaude }> {
  const medirBanco = comPrazo(Promise.resolve().then(deps.pingBanco), PRAZO_BANCO_MS).then(
    () => true,
    () => false,
  );

  const medirRedis = (async (): Promise<{ redis: boolean; batida: string | null }> => {
    try {
      // conexão não pronta: nem tenta (o comando ficaria preso na fila offline)
      if (!deps.redisPronto()) return { redis: false, batida: null };
      const batida = await comPrazo(deps.lerBatida(), PRAZO_REDIS_MS);
      return { redis: true, batida };
    } catch {
      return { redis: false, batida: null };
    }
  })();

  const [db, { redis, batida }] = await Promise.all([medirBanco, medirRedis]);
  return avaliarSaude({ db, redis, batida, agora: agora() });
}
