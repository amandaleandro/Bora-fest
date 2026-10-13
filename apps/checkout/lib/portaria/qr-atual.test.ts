/**
 * SÓ O QR ATUAL VALE, TAMBÉM SEM REDE (2026-10-12) — a metade offline da
 * correção do QR antigo depois da transferência (a online está em
 * apps/api/src/__tests__/qr-antigo-transferencia.test.ts).
 *
 * QR assinado de verdade (Ed25519, mesmo formato do servidor) e conferido pelo
 * mesmo `verifyLocally` que a portaria usa sem internet.
 * Rodar (o checkout não tem tsx próprio):
 *   apps/api/node_modules/.bin/tsx --test apps/checkout/lib/portaria/qr-atual.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";

import { formatoConfirmado, precisaManifestoInteiro } from "./sync";
import type { ManifestTicket } from "./types";
import { buildIndex, conferirQrAtual, INVALID_REASON_TEXT, verifyLocally } from "./verify";

const EVENTO = randomUUID();
const LOTE = randomUUID();
const chave = generateKeyPairSync("ed25519");
const CHAVE_PUBLICA = chave.publicKey.export({ type: "spki", format: "pem" }).toString();

const EMISSAO = 1_760_000_000;
const TRANSFERENCIA = EMISSAO + 3600;

/** Mesmo formato de packages/tickets/src/qr-token.ts: BF1.<payload>.<assinatura>. */
function assinar(
  tid: string,
  n: string,
  iat: number,
  privada: KeyObject = chave.privateKey,
): string {
  const payload = { v: 1, eid: EVENTO, tid, lid: LOTE, n, iat };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const assinatura = sign(null, Buffer.from(encoded), privada);
  return `BF1.${encoded}.${assinatura.toString("base64url")}`;
}

function ingresso(over: Partial<ManifestTicket> = {}): ManifestTicket {
  return {
    id: randomUUID(),
    code: `BF-${randomUUID().slice(0, 4).toUpperCase()}-TEST`,
    status: "ACTIVE",
    ticketLotId: LOTE,
    checkedInAt: null,
    updatedAt: "",
    attendeeName: "Novo Dono",
    ...over,
  };
}

function indice(tickets: ManifestTicket[]) {
  return buildIndex({ eventId: EVENTO, publicKeyPem: CHAVE_PUBLICA, tickets, lots: [], queue: [] });
}

test("transferido: o QR de antes é recusado offline como QR antigo, sem mostrar o novo dono", () => {
  const t = ingresso({ qrAtual: { n: "nonce-novo", iat: TRANSFERENCIA } });
  const r = verifyLocally({ qrToken: assinar(t.id, "nonce-velho", EMISSAO) }, indice([t]));

  assert.equal(r.kind, "INVALID");
  assert.equal(r.reason, "OLD_QR");
  assert.equal(r.offline, true);
  assert.equal(r.name, undefined, "o nome de quem recebeu não vai para a tela");
  assert.equal(r.ticketId, undefined, "recusa não vira entrada na fila");
});

test("transferido: o QR atual entra offline normalmente", () => {
  const t = ingresso({ qrAtual: { n: "nonce-novo", iat: TRANSFERENCIA } });
  const r = verifyLocally({ qrToken: assinar(t.id, "nonce-novo", TRANSFERENCIA) }, indice([t]));

  assert.equal(r.kind, "VALID");
  assert.equal(r.ticketId, t.id);
  assert.equal(r.name, "Novo Dono");
});

test("QR antigo vale como antigo em qualquer estado: não vira 'Já utilizado' nem 'Cancelado'", () => {
  const usado = ingresso({
    status: "CHECKED_IN",
    checkedInAt: new Date().toISOString(),
    qrAtual: { n: "nonce-novo", iat: TRANSFERENCIA },
  });
  const cancelado = ingresso({ status: "CANCELED", qrAtual: { n: "nonce-novo", iat: TRANSFERENCIA } });
  const idx = indice([usado, cancelado]);

  assert.equal(verifyLocally({ qrToken: assinar(usado.id, "nonce-velho", EMISSAO) }, idx).reason, "OLD_QR");
  assert.equal(verifyLocally({ qrToken: assinar(cancelado.id, "nonce-velho", EMISSAO) }, idx).reason, "OLD_QR");
});

test("manifesto guardado antes do campo (sem qrAtual) não quebra: aceita como antes", () => {
  const t = ingresso(); // sem a chave qrAtual
  const r = verifyLocally({ qrToken: assinar(t.id, "qualquer", EMISSAO) }, indice([t]));
  assert.equal(r.kind, "VALID");

  const semComoComparar = ingresso({ qrAtual: null });
  const r2 = verifyLocally({ qrToken: assinar(semComoComparar.id, "qualquer", EMISSAO) }, indice([semComoComparar]));
  assert.equal(r2.kind, "VALID", "servidor sem nonce para comparar: segue a regra de antes");
});

test("lista local atrasada: o QR MAIS NOVO que o conhecido não barra o novo dono", () => {
  // o aparelho sincronizou antes da transferência e ainda conhece o QR de antes
  const t = ingresso({ qrAtual: { n: "nonce-velho", iat: EMISSAO } });
  const r = verifyLocally({ qrToken: assinar(t.id, "nonce-novo", TRANSFERENCIA) }, indice([t]));
  assert.equal(r.kind, "VALID");
});

test("assinatura continua vindo primeiro: QR com o nonce certo mas chave errada é falsificado", () => {
  const t = ingresso({ qrAtual: { n: "nonce-novo", iat: TRANSFERENCIA } });
  const outra = generateKeyPairSync("ed25519").privateKey;
  const r = verifyLocally({ qrToken: assinar(t.id, "nonce-novo", TRANSFERENCIA, outra) }, indice([t]));
  assert.equal(r.kind, "INVALID");
  assert.equal(r.reason, "BAD_SIGNATURE");
});

test("busca manual (por id ou código) não passa pela conferência do QR", () => {
  const t = ingresso({ qrAtual: { n: "nonce-novo", iat: TRANSFERENCIA } });
  const idx = indice([t]);
  assert.equal(verifyLocally({ ticketId: t.id }, idx).kind, "VALID");
  assert.equal(verifyLocally({ code: t.code.toLowerCase() }, idx).kind, "VALID");
});

test("conferirQrAtual: as três respostas", () => {
  const atual = { n: "b", iat: 200 };
  assert.equal(conferirQrAtual({ n: "b", iat: 200 }, atual), "ATUAL");
  assert.equal(conferirQrAtual({ n: "a", iat: 100 }, atual), "ANTIGO");
  // mesmo segundo, nonce diferente: não dá para dizer que é mais novo — recusa
  assert.equal(conferirQrAtual({ n: "a", iat: 200 }, atual), "ANTIGO");
  assert.equal(conferirQrAtual({ n: "a" }, atual), "ANTIGO", "QR sem emissão não passa por mais novo");
  assert.equal(conferirQrAtual({ n: "c", iat: 300 }, atual), "SEM_COMO_CONFERIR");
  assert.equal(conferirQrAtual({ n: "a", iat: 100 }, undefined), "SEM_COMO_CONFERIR");
  assert.equal(conferirQrAtual({ n: "a", iat: 100 }, null), "SEM_COMO_CONFERIR");
});

test("texto da porta: diz que o ingresso foi transferido e o que pedir", () => {
  const texto = INVALID_REASON_TEXT.OLD_QR;
  assert.ok(texto, "OLD_QR tem texto próprio");
  assert.match(texto.motivo, /QR antigo/);
  assert.match(texto.motivo, /transferido/);
  assert.match(texto.acao, /QR atual/);
});

test("formato 4: manifesto guardado no formato 3 refaz o full uma vez; API antiga não grava 4", () => {
  assert.equal(formatoConfirmado(4), 4);
  assert.equal(formatoConfirmado(3), 3, "API ainda sem qrAtual: grava 3 e o próximo sync refaz o full");
  assert.equal(formatoConfirmado(undefined), 2);
  assert.equal(precisaManifestoInteiro(3), true);
  assert.equal(precisaManifestoInteiro(4), false);
});
