import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeRedisConnection } from "@borafest/queues";
import { rateLimitDesligadoParaTeste } from "../common/rate-limit.guard";

// Limite desligado só para teste de carga (2026-10-12): o script de carga
// forjava X-Forwarded-For para escapar do limite. Agora existe um caminho
// explícito — RATE_LIMIT_DISABLED=1 — que só vale em desenvolvimento/teste.
// O que este arquivo garante é o lado perigoso: produção NUNCA desliga.

after(async () => {
  await closeRedisConnection();
});

const env = (vars: Record<string, string | undefined>) => vars as NodeJS.ProcessEnv;

test("produção nunca desliga o limite, mesmo com a variável", () => {
  assert.equal(rateLimitDesligadoParaTeste(env({ NODE_ENV: "production", RATE_LIMIT_DISABLED: "1" })), false);
});

test("NODE_ENV vazio ou desconhecido não desliga — esquecer o NODE_ENV não abre a porta", () => {
  assert.equal(rateLimitDesligadoParaTeste(env({ RATE_LIMIT_DISABLED: "1" })), false);
  assert.equal(rateLimitDesligadoParaTeste(env({ NODE_ENV: "staging", RATE_LIMIT_DISABLED: "1" })), false);
  assert.equal(rateLimitDesligadoParaTeste(env({ NODE_ENV: "Production", RATE_LIMIT_DISABLED: "1" })), false);
});

test("só o valor exato '1' desliga", () => {
  for (const valor of [undefined, "", "0", "true", "yes", " 1"]) {
    assert.equal(
      rateLimitDesligadoParaTeste(env({ NODE_ENV: "development", RATE_LIMIT_DISABLED: valor })),
      false,
      `RATE_LIMIT_DISABLED=${JSON.stringify(valor)}`,
    );
  }
});

test("desenvolvimento e teste, com a variável, desligam", () => {
  assert.equal(rateLimitDesligadoParaTeste(env({ NODE_ENV: "development", RATE_LIMIT_DISABLED: "1" })), true);
  assert.equal(rateLimitDesligadoParaTeste(env({ NODE_ENV: "test", RATE_LIMIT_DISABLED: "1" })), true);
});
