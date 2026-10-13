/**
 * CSVs do painel (2026-10-12): pedidos, participantes e meia-entrada pelo mesmo
 * caminho — motivo do servidor na recusa, 401 = sessão expirada, rede fora em
 * texto legível e a URL do arquivo revogada só DEPOIS do clique de download.
 * fetch, document e URL falsos — sem navegador nem servidor.
 * Rodar (o painel não tem tsx próprio): apps/api/node_modules/.bin/tsx --test apps/producer/lib/csv-download.test.ts
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { ApiError, csvSemLinhas, dashboardApi, mensagemDaRecusa, SESSION_EXPIRED_MESSAGE } from "./api";

// pelo `as unknown as` (padrão de apps/checkout/lib/attribution.test.ts):
// atribuir direto a uma função global não passa no tsc do Next
const g = globalThis as unknown as {
  fetch: typeof fetch;
  setTimeout: (fn: () => void, ms?: number) => unknown;
  document?: unknown;
};
const urlEstatico = URL as unknown as {
  createObjectURL: (obj: Blob) => string;
  revokeObjectURL: (url: string) => void;
};

const fetchOriginal = g.fetch;
const timeoutOriginal = g.setTimeout;
const criarUrlOriginal = urlEstatico.createObjectURL;
const revogarUrlOriginal = urlEstatico.revokeObjectURL;
afterEach(() => {
  g.fetch = fetchOriginal;
  g.setTimeout = timeoutOriginal;
  urlEstatico.createObjectURL = criarUrlOriginal;
  urlEstatico.revokeObjectURL = revogarUrlOriginal;
  delete g.document;
});

function responder(status: number, corpo: string, urls: string[] = []) {
  g.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(corpo, { status });
  }) as typeof fetch;
}

/** document/URL/setTimeout falsos: registram a ordem do que aconteceu. */
function navegadorFalso() {
  const passos: string[] = [];
  const agendados: Array<() => void> = [];
  const link = {
    href: "",
    download: "",
    click: () => passos.push(`click:${link.download}`),
    remove: () => passos.push("remove"),
  };
  g.document = {
    createElement: () => link,
    body: { appendChild: () => passos.push("append") },
  };
  urlEstatico.createObjectURL = () => {
    passos.push("criar-url");
    return "blob:teste";
  };
  urlEstatico.revokeObjectURL = (url: string) => {
    passos.push(`revogar:${url}`);
  };
  g.setTimeout = (fn: () => void, ms?: number) => {
    passos.push(`agendar:${ms}`);
    agendados.push(fn);
    return 0;
  };
  return { passos, agendados };
}

test("mensagem da recusa: a do servidor (texto ou lista); sem JSON, a padrão", () => {
  assert.equal(mensagemDaRecusa(JSON.stringify({ message: "Sem permissão para este evento" }), "padrão"), "Sem permissão para este evento");
  assert.equal(mensagemDaRecusa(JSON.stringify({ message: ["um", "dois"] }), "padrão"), "um · dois");
  assert.equal(mensagemDaRecusa(JSON.stringify({ message: [] }), "padrão"), "padrão");
  assert.equal(mensagemDaRecusa(JSON.stringify({ message: "  " }), "padrão"), "padrão");
  assert.equal(mensagemDaRecusa("<html>502 Bad Gateway</html>", "padrão"), "padrão");
  assert.equal(mensagemDaRecusa("null", "padrão"), "padrão");
  assert.equal(mensagemDaRecusa("", "padrão"), "padrão");
});

test("planilha só com o cabeçalho = vazia", () => {
  assert.equal(csvSemLinhas("id,nome"), true);
  assert.equal(csvSemLinhas("id,nome\n"), true);
  assert.equal(csvSemLinhas(""), true);
  assert.equal(csvSemLinhas("id,nome\n1,Ana"), false);
});

test("pedidos: baixa o arquivo e só revoga a URL depois do clique", async () => {
  const urls: string[] = [];
  responder(200, "pedido,total\nBF-1,R$ 10,00", urls);
  const { passos, agendados } = navegadorFalso();
  const r = await dashboardApi.downloadOrdersCsv("tok", "ev-1");
  g.setTimeout = timeoutOriginal;
  assert.match(urls[0], /\/v1\/events\/ev-1\/orders\/export$/);
  assert.deepEqual(r, { vazio: false });
  // antes: revokeObjectURL logo depois do click() — o download podia sair cortado
  assert.ok(!passos.some((p) => p.startsWith("revogar")), "não revoga no mesmo instante do clique");
  assert.ok(passos.indexOf("click:pedidos.csv") > passos.indexOf("criar-url"));
  assert.ok(passos.includes("agendar:1000"));
  agendados.forEach((fn) => fn());
  assert.ok(passos.indexOf("revogar:blob:teste") > passos.indexOf("click:pedidos.csv"));
});

test("pedidos: recusa do servidor vem com o motivo dele (antes: só 'Não foi possível exportar')", async () => {
  navegadorFalso();
  responder(403, JSON.stringify({ message: "Você não tem permissão para ver os pedidos deste evento" }));
  await assert.rejects(
    dashboardApi.downloadOrdersCsv("tok", "ev-1"),
    (e: unknown) =>
      e instanceof ApiError && e.status === 403 && e.message === "Você não tem permissão para ver os pedidos deste evento",
  );
  responder(500, "<html>erro</html>");
  await assert.rejects(
    dashboardApi.downloadOrdersCsv("tok", "ev-1"),
    (e: unknown) => e instanceof ApiError && e.status === 500 && e.message === "Não foi possível exportar os pedidos",
  );
});

test("401 = sessão expirada; rede fora = texto legível — nos três CSVs", async () => {
  navegadorFalso();
  const baixar = [
    () => dashboardApi.downloadOrdersCsv("tok", "ev-1"),
    () => dashboardApi.downloadParticipantsCsv("tok", "ev-1"),
    () => dashboardApi.downloadMeiaEntradaCsv("tok", "ev-1"),
  ];
  for (const fn of baixar) {
    responder(401, JSON.stringify({ message: "Unauthorized" }));
    await assert.rejects(fn(), (e: unknown) => e instanceof ApiError && e.status === 401 && e.message === SESSION_EXPIRED_MESSAGE);
    g.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await assert.rejects(fn(), (e: unknown) => e instanceof ApiError && e.status === 0 && /Falha de conexão/.test(e.message));
  }
});

test("meia-entrada e participantes só com o cabeçalho: vazio, não erro", async () => {
  const { passos } = navegadorFalso();
  responder(200, "ingresso,nome\n");
  assert.deepEqual(await dashboardApi.downloadMeiaEntradaCsv("tok", "ev-1"), { vazio: true });
  responder(200, "ingresso,nome");
  assert.deepEqual(await dashboardApi.downloadParticipantsCsv("tok", "ev-1"), { vazio: true });
  assert.ok(passos.includes("click:meia-entrada.csv"));
  assert.ok(passos.includes("click:participantes.csv"));
});
