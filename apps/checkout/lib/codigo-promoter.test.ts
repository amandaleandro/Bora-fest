/**
 * Código do promoter no checkout + versão única do aceite (2026-10-12).
 * Regras puras de lib/codigo-promoter.ts e lib/consent.ts (sem browser, sem banco).
 * Rodar (o checkout não tem tsx próprio): apps/api/node_modules/.bin/tsx --test apps/checkout/lib/codigo-promoter.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  avisoDoCodigoPromoter,
  codigoPromoterParaEnviar,
  limparCodigoPromoter,
  TEXTO_CODIGO_CURTO,
} from "./codigo-promoter";
import { CONSENT_VERSION } from "./consent";

test("campo: só letras e números, em maiúsculas, até 16 — o mesmo que o servidor aceita", () => {
  assert.equal(limparCodigoPromoter("bia10"), "BIA10");
  assert.equal(limparCodigoPromoter(" bia-10 "), "BIA10");
  assert.equal(limparCodigoPromoter("ção@1"), "O1");
  assert.equal(limparCodigoPromoter("A".repeat(20)), "A".repeat(16));
  assert.equal(limparCodigoPromoter(""), "");
});

test("envio: vazio não vai; curto demais é barrado com texto claro; o resto vai limpo", () => {
  assert.deepEqual(codigoPromoterParaEnviar(""), {});
  assert.deepEqual(codigoPromoterParaEnviar("   "), {});
  // 1–2 caracteres: o servidor recusaria o pedido inteiro (min 3)
  assert.deepEqual(codigoPromoterParaEnviar("ab"), { erro: TEXTO_CODIGO_CURTO });
  // a limpeza vem antes da contagem: "b-i" vira "BI", curto
  assert.deepEqual(codigoPromoterParaEnviar("b-i"), { erro: TEXTO_CODIGO_CURTO });
  assert.deepEqual(codigoPromoterParaEnviar("bia10"), { codigo: "BIA10" });
  assert.deepEqual(codigoPromoterParaEnviar("ABC"), { codigo: "ABC" });
});

test("aviso: código que não valeu (servidor devolveu promoterLinkId null) é dito com clareza", () => {
  const aviso = avisoDoCodigoPromoter({ codigo: "BIA10", promoterLinkId: null, veioDeLink: false });
  assert.equal(aviso?.tipo, "nao-valeu");
  assert.match(aviso!.texto, /BIA10/);
  assert.match(aviso!.texto, /segue normalmente/);
  // com link que também não pegou: continua sendo "não valeu"
  assert.equal(avisoDoCodigoPromoter({ codigo: "BIA10", promoterLinkId: null, veioDeLink: true })?.tipo, "nao-valeu");
});

test("aviso: código atribuiu a venda (sem link) → confirmação", () => {
  const aviso = avisoDoCodigoPromoter({ codigo: "BIA10", promoterLinkId: "link-1", veioDeLink: false });
  assert.equal(aviso?.tipo, "ok");
  assert.match(aviso!.texto, /BIA10/);
});

test("aviso: a tela não chuta — com link (que vence o código) ou API sem o campo, nada é dito", () => {
  assert.equal(avisoDoCodigoPromoter({ codigo: "BIA10", promoterLinkId: "link-1", veioDeLink: true }), null);
  assert.equal(avisoDoCodigoPromoter({ codigo: "BIA10", promoterLinkId: undefined, veioDeLink: false }), null);
  // sem código digitado não há o que avisar
  assert.equal(avisoDoCodigoPromoter({ codigo: undefined, promoterLinkId: null, veioDeLink: false }), null);
});

test("aceite: uma versão só, e nenhuma tela com cópia própria", () => {
  assert.equal(CONSENT_VERSION, "v2026-07");
  const telas = ["../app/legal/page.tsx", "../app/checkout/[reservationId]/page.tsx", "../app/perfil/page.tsx"];
  for (const tela of telas) {
    const fonte = readFileSync(resolve(__dirname, tela), "utf8");
    assert.doesNotMatch(fonte, /const CONSENT_VERSION\s*=/, `${tela} voltou a ter a versão copiada`);
    assert.match(fonte, /import \{ CONSENT_VERSION \} from "[./]+lib\/consent"/, `${tela} não usa lib/consent`);
  }
});
