import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRAZO_BANCO_MS,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_MAX_AGE_SECONDS,
  avaliarSaude,
  comPrazo,
  lerValorDaBatida,
  verificarSaude,
  type DependenciasSaude,
} from "../health/health.checks";

// /health com banco + Redis + batida do worker (2026-10-12). Teste puro: não
// precisa de Postgres nem Redis — as consultas entram por parâmetro.

const AGORA = new Date("2026-10-12T12:00:00.000Z");
const batidaHa = (segundos: number, filasParadas: string[] = []) =>
  JSON.stringify({ em: new Date(AGORA.getTime() - segundos * 1000).toISOString(), filasParadas });

test("a chave da batida é a mesma que o worker grava", () => {
  // apps/worker/src/heartbeat.ts grava exatamente esta chave
  assert.equal(WORKER_HEARTBEAT_KEY, "borafest:worker:heartbeat");
  assert.equal(WORKER_HEARTBEAT_MAX_AGE_SECONDS, 90);
});

test("tudo de pé: 200 com status ok e db up (formato que o healthcheck-alert.sh procura)", () => {
  const { ok, corpo } = avaliarSaude({ db: true, redis: true, batida: batidaHa(10), agora: AGORA });
  assert.equal(ok, true);
  assert.deepEqual(corpo, {
    status: "ok",
    db: "up",
    redis: "up",
    worker: "up",
    timestamp: AGORA.toISOString(),
  });
  const json = JSON.stringify(corpo);
  assert.ok(json.includes('"status":"ok"'));
  assert.ok(json.includes('"db":"up"'));
});

test("banco fora: erro com motivo, sem detalhe técnico", () => {
  const { ok, corpo } = avaliarSaude({ db: false, redis: true, batida: batidaHa(5), agora: AGORA });
  assert.equal(ok, false);
  assert.equal(corpo.status, "erro");
  assert.equal(corpo.db, "down");
  assert.equal(corpo.worker, "up");
  assert.deepEqual(corpo.motivos, ["banco de dados não respondeu"]);
});

test("Redis fora: worker vira desconhecido (não dá para ler a batida)", () => {
  const { ok, corpo } = avaliarSaude({ db: true, redis: false, batida: null, agora: AGORA });
  assert.equal(ok, false);
  assert.equal(corpo.redis, "down");
  assert.equal(corpo.worker, "desconhecido");
  assert.equal(corpo.motivos?.length, 1);
  assert.match(corpo.motivos![0], /Redis/);
});

test("sem batida (chave expirou): worker parado", () => {
  const { ok, corpo } = avaliarSaude({ db: true, redis: true, batida: null, agora: AGORA });
  assert.equal(ok, false);
  assert.equal(corpo.worker, "down");
  assert.match(corpo.motivos![0], /worker sem sinal de vida/);
});

test("batida velha (relógio/TTL): worker parado com a idade no motivo", () => {
  const { ok, corpo } = avaliarSaude({ db: true, redis: true, batida: batidaHa(200), agora: AGORA });
  assert.equal(ok, false);
  assert.equal(corpo.worker, "down");
  assert.match(corpo.motivos![0], /200 s/);
});

test("batida no limite de 90 s ainda conta como viva", () => {
  const { ok } = avaliarSaude({ db: true, redis: true, batida: batidaHa(90), agora: AGORA });
  assert.equal(ok, true);
});

test("fila parada no worker: erro com o nome da fila", () => {
  const { ok, corpo } = avaliarSaude({
    db: true,
    redis: true,
    batida: batidaHa(3, ["outbox", "notificações"]),
    agora: AGORA,
  });
  assert.equal(ok, false);
  assert.equal(corpo.worker, "down");
  assert.deepEqual(corpo.motivos, ["worker com fila parada: outbox, notificações"]);
});

test("tudo fora: junta todos os motivos", () => {
  const { corpo } = avaliarSaude({ db: false, redis: false, batida: null, agora: AGORA });
  assert.equal(corpo.motivos?.length, 2);
  assert.equal(corpo.db, "down");
  assert.equal(corpo.redis, "down");
});

test("lerValorDaBatida aceita JSON do worker, ISO puro e recusa lixo", () => {
  assert.equal(lerValorDaBatida(null), null);
  assert.equal(lerValorDaBatida(""), null);
  assert.equal(lerValorDaBatida("não é data"), null);
  assert.equal(lerValorDaBatida(JSON.stringify({ em: 123 })), null);
  assert.equal(lerValorDaBatida("2026-10-12T11:59:50.000Z")?.em.toISOString(), "2026-10-12T11:59:50.000Z");
  const lida = lerValorDaBatida(JSON.stringify({ em: "2026-10-12T11:59:50.000Z", filasParadas: ["outbox", 7] }));
  assert.deepEqual(lida?.filasParadas, ["outbox"]);
});

test("comPrazo rejeita quem não responde e repassa quem responde", async () => {
  await assert.rejects(comPrazo(new Promise(() => undefined), 20), /sem resposta em 20 ms/);
  assert.equal(await comPrazo(Promise.resolve(42), 20), 42);
});

function deps(over: Partial<DependenciasSaude>): DependenciasSaude {
  return {
    pingBanco: async () => 1,
    redisPronto: () => true,
    lerBatida: async () => batidaHa(1),
    ...over,
  };
}

test("verificarSaude: tudo de pé", async () => {
  const r = await verificarSaude(deps({}), () => AGORA);
  assert.equal(r.ok, true);
  assert.equal(r.corpo.worker, "up");
});

test("verificarSaude: banco que lança vira db down, sem vazar a mensagem", async () => {
  const r = await verificarSaude(
    deps({
      pingBanco: async () => {
        throw new Error("connect ECONNREFUSED postgres:5432 senha=segredo");
      },
    }),
    () => AGORA,
  );
  assert.equal(r.ok, false);
  assert.equal(r.corpo.db, "down");
  assert.ok(!JSON.stringify(r.corpo).includes("ECONNREFUSED"));
  assert.ok(!JSON.stringify(r.corpo).includes("segredo"));
});

test("verificarSaude: banco que lança de forma síncrona também vira down", async () => {
  const r = await verificarSaude(
    deps({
      pingBanco: () => {
        throw new Error("sync");
      },
    }),
    () => AGORA,
  );
  assert.equal(r.corpo.db, "down");
});

test("verificarSaude: Redis não pronto nem chega a ler a batida (não fica preso na fila offline)", async () => {
  let leu = false;
  const r = await verificarSaude(
    deps({
      redisPronto: () => false,
      lerBatida: async () => {
        leu = true;
        return null;
      },
    }),
    () => AGORA,
  );
  assert.equal(leu, false);
  assert.equal(r.corpo.redis, "down");
  assert.equal(r.corpo.worker, "desconhecido");
});

test("verificarSaude: leitura do Redis presa responde down dentro do prazo", async () => {
  const inicio = Date.now();
  const r = await verificarSaude(deps({ lerBatida: () => new Promise(() => undefined) }), () => AGORA);
  const duracao = Date.now() - inicio;
  assert.equal(r.corpo.redis, "down");
  assert.ok(duracao < PRAZO_BANCO_MS + 500, `demorou ${duracao} ms`);
});
