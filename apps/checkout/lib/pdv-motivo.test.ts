/**
 * PDV da porta: por que a entrada foi recusada, em texto de operador
 * (lib/pdv-motivo.ts, 2026-10-12) — inclui o QR antigo de ingresso transferido.
 * Rodar (o checkout não tem tsx próprio): apps/api/node_modules/.bin/tsx --test apps/checkout/lib/pdv-motivo.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { motivoLegivel } from "./pdv-motivo";

test("QR antigo (OLD_QR): diz que o ingresso foi transferido e o QR mudou", () => {
  assert.equal(motivoLegivel("INVALID", "OLD_QR"), "Este ingresso foi transferido — o QR mudou");
});

test("os outros motivos continuam com o texto de antes", () => {
  assert.equal(motivoLegivel("INVALID", "OTHER_EVENT"), "O portão selecionado é de outro evento — troque o portão");
  assert.equal(motivoLegivel("INVALID", "NOT_FOUND"), "O servidor não achou este ingresso");
  assert.equal(motivoLegivel("INVALID", "BAD_SIGNATURE"), "QR não reconhecido pelo servidor");
  assert.equal(motivoLegivel("INVALID", "MALFORMED"), "QR não reconhecido pelo servidor");
  assert.equal(motivoLegivel("INVALID", "EVENT_WITHOUT_KEY"), "Evento sem chave de validação — chame o produtor");
  assert.equal(motivoLegivel("CANCELED"), "Ingresso cancelado");
  assert.equal(motivoLegivel("UNVERIFIED"), "Não deu para verificar a entrada");
});

test("motivo desconhecido não vira texto inventado", () => {
  assert.equal(motivoLegivel("INVALID", "ALGO_NOVO"), "O servidor recusou a entrada");
  assert.equal(motivoLegivel("INVALID"), "O servidor recusou a entrada");
});

test("o PDV usa esta função — sem cópia própria que diverge em silêncio", () => {
  const fonte = readFileSync(resolve(__dirname, "../components/PdvPorta.tsx"), "utf8");
  assert.match(fonte, /import \{ motivoLegivel \} from "\.\.\/lib\/pdv-motivo"/);
  assert.doesNotMatch(fonte, /function motivoLegivel\(/, "PdvPorta voltou a ter a própria motivoLegivel");
});
