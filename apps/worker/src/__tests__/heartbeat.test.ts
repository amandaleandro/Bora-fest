import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
  baterUmaVez,
  iniciarBatidaDoWorker,
  montarBatida,
} from "../heartbeat";

// Batida do worker para o /health da API (2026-10-12). Teste puro: o Redis é
// um falso que só registra as chamadas — não precisa de Redis de verdade.

type Chamada = { chave: string; valor: string; modo: string; segundos: number };

function redisFalso(comportamento: "ok" | "falha" | "preso" = "ok") {
  const chamadas: Chamada[] = [];
  const redis = {
    set: (chave: string, valor: string, modo: string, segundos: number) => {
      chamadas.push({ chave, valor, modo, segundos });
      if (comportamento === "falha") return Promise.reject(new Error("redis fora"));
      if (comportamento === "preso") return new Promise(() => undefined);
      return Promise.resolve("OK");
    },
  };
  return { chamadas, redis: redis as any };
}

test("chave e validade combinam com o que o /health da API lê", () => {
  // apps/api/src/health/health.checks.ts lê esta chave e tolera 90 s
  assert.equal(WORKER_HEARTBEAT_KEY, "borafest:worker:heartbeat");
  assert.equal(WORKER_HEARTBEAT_TTL_SECONDS, 90);
});

test("montarBatida grava horário e só os nomes das filas paradas", () => {
  const agora = new Date("2026-10-12T12:00:00.000Z");
  const valor = montarBatida(
    [
      { nome: "outbox", estaRodando: () => true },
      { nome: "notificações", estaRodando: () => false },
      {
        nome: "pedidos",
        estaRodando: () => {
          throw new Error("worker fechado");
        },
      },
    ],
    agora,
  );
  assert.deepEqual(JSON.parse(valor), {
    em: "2026-10-12T12:00:00.000Z",
    filasParadas: ["notificações", "pedidos"],
  });
});

test("baterUmaVez usa SET com EX de 90 s na chave combinada", async () => {
  const { chamadas, redis } = redisFalso();
  await baterUmaVez(redis, [{ nome: "outbox", estaRodando: () => true }], new Date("2026-10-12T12:00:00.000Z"));
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].chave, "borafest:worker:heartbeat");
  assert.equal(chamadas[0].modo, "EX");
  assert.equal(chamadas[0].segundos, 90);
  assert.deepEqual(JSON.parse(chamadas[0].valor).filasParadas, []);
});

test("baterUmaVez repassa a falha do Redis (quem chama decide o que fazer)", async () => {
  const { redis } = redisFalso("falha");
  await assert.rejects(baterUmaVez(redis, []), /redis fora/);
});

test("iniciarBatidaDoWorker bate na hora, não derruba o worker se o Redis falhar e para quando pedido", async () => {
  const { chamadas, redis } = redisFalso("falha");
  const parar = iniciarBatidaDoWorker({ consumidores: [], redis, intervaloMs: 10 });
  await new Promise((r) => setTimeout(r, 35));
  parar();
  const total = chamadas.length;
  assert.ok(total >= 2, `esperava várias tentativas, veio ${total}`);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(chamadas.length, total, "depois de parar não pode bater mais");
});

test("escrita presa não empilha batidas", async () => {
  const { chamadas, redis } = redisFalso("preso");
  const parar = iniciarBatidaDoWorker({ consumidores: [], redis, intervaloMs: 5 });
  await new Promise((r) => setTimeout(r, 40));
  parar();
  assert.equal(chamadas.length, 1);
});
