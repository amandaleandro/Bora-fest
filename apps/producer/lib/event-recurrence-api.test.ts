/**
 * Próxima edição / duplicar evento (2026-10-12): Idempotency-Key por tentativa
 * (padrão do PDV da porta) e o mesmo tratamento de erro dos outros clientes.
 * fetch falso — sem servidor.
 * Rodar (o painel não tem tsx próprio): apps/api/node_modules/.bin/tsx --test apps/producer/lib/event-recurrence-api.test.ts
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { ApiError, SESSION_EXPIRED_MESSAGE } from "./api";
import { eventRecurrenceApi, novaChaveDeIdempotencia, tentativaDeEdicao } from "./event-recurrence-api";

// pelo `globalThis as unknown as` (padrão de apps/checkout/lib/attribution.test.ts):
// atribuir direto a uma função global não passa no tsc do Next
const g = globalThis as unknown as { fetch: typeof fetch };
const fetchOriginal = g.fetch;
afterEach(() => {
  g.fetch = fetchOriginal;
});

interface Chamada {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: unknown;
}

/** fetch falso que guarda a chamada e responde `status` com `corpo`. */
function fetchFalso(status: number, corpo: unknown, chamadas: Chamada[]) {
  g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const enviado = init?.body;
    chamadas.push({
      url: String(input),
      method: init?.method,
      headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
      body: typeof enviado === "string" ? JSON.parse(enviado) : undefined,
    });
    return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

const criada = { id: "novo", title: "Festa #2", slug: "festa-2", status: "DRAFT", startsAt: "", endsAt: "", copiedFromEventId: "ev", copiedTicketTypes: 1, copiedLots: 2, copiedAddOns: 0 };

test("tentativa: mesmos dados = mesma chave (clique repetido); dados novos = chave nova", () => {
  let n = 0;
  const gerar = () => `chave-${++n}`;
  const primeira = tentativaDeEdicao(null, '{"a":1}', gerar);
  assert.equal(primeira.chave, "chave-1");
  assert.equal(tentativaDeEdicao(primeira, '{"a":1}', gerar).chave, "chave-1", "repetir reaproveita a chave");
  const outra = tentativaDeEdicao(primeira, '{"a":2}', gerar);
  assert.equal(outra.chave, "chave-2", "mudou a data/nome: o servidor recusaria a mesma chave com corpo diferente");
  assert.equal(outra.pedido, '{"a":2}');
});

test("chave nova é sempre diferente", () => {
  const chaves = new Set(Array.from({ length: 50 }, () => novaChaveDeIdempotencia()));
  assert.equal(chaves.size, 50);
});

test("próxima edição e duplicar mandam a Idempotency-Key", async () => {
  const chamadas: Chamada[] = [];
  fetchFalso(201, criada, chamadas);
  const r1 = await eventRecurrenceApi.nextEdition("tok", "ev-1", { cadenceDays: 7, copyTicketCatalog: true }, "k-1");
  const r2 = await eventRecurrenceApi.duplicate(
    "tok",
    "ev-1",
    { startsAt: "2026-11-01T22:00:00.000Z", endsAt: "2026-11-02T04:00:00.000Z", copyTicketCatalog: false },
    "k-2",
  );
  assert.equal(r1.id, "novo");
  assert.equal(r2.id, "novo");
  assert.match(chamadas[0].url, /\/v1\/events\/ev-1\/next-edition$/);
  assert.equal(chamadas[0].method, "POST");
  assert.equal(chamadas[0].headers["Idempotency-Key"], "k-1");
  assert.equal(chamadas[0].headers.Authorization, "Bearer tok");
  assert.deepEqual(chamadas[0].body, { cadenceDays: 7, copyTicketCatalog: true });
  assert.match(chamadas[1].url, /\/v1\/events\/ev-1\/duplicate$/);
  assert.equal(chamadas[1].headers["Idempotency-Key"], "k-2");
});

test("recusa do servidor: o motivo dele, com o status", async () => {
  fetchFalso(409, { message: "Requisição com esta Idempotency-Key ainda em processamento" }, []);
  await assert.rejects(
    eventRecurrenceApi.nextEdition("tok", "ev-1", { cadenceDays: 7, copyTicketCatalog: true }, "k"),
    (e: unknown) =>
      e instanceof ApiError && e.status === 409 && e.message === "Requisição com esta Idempotency-Key ainda em processamento",
  );
  fetchFalso(400, { message: ["Data de início inválida", "Data de fim inválida"] }, []);
  await assert.rejects(
    eventRecurrenceApi.duplicate("tok", "ev-1", { startsAt: "x", endsAt: "y", copyTicketCatalog: true }, "k"),
    (e: unknown) => e instanceof ApiError && e.message === "Data de início inválida · Data de fim inválida",
  );
});

test("401 com token: sessão expirada; rede fora: texto legível", async () => {
  fetchFalso(401, { message: "Unauthorized" }, []);
  await assert.rejects(
    eventRecurrenceApi.nextEdition("tok", "ev-1", { cadenceDays: 7, copyTicketCatalog: true }, "k"),
    (e: unknown) => e instanceof ApiError && e.status === 401 && e.message === SESSION_EXPIRED_MESSAGE,
  );
  g.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  await assert.rejects(
    eventRecurrenceApi.nextEdition("tok", "ev-1", { cadenceDays: 7, copyTicketCatalog: true }, "k"),
    (e: unknown) => e instanceof ApiError && e.status === 0 && /Falha de conexão/.test(e.message),
  );
});
