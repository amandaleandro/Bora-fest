/**
 * "Não vou mais" no site do comprador (2026-10-12): textos e tratamento de erro.
 * Regras puras de lib/nao-vou-mais.ts (sem browser, sem banco).
 * Rodar (o checkout não tem tsx próprio): apps/api/node_modules/.bin/tsx --test apps/checkout/lib/nao-vou-mais.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "./api";
import { erroDoNaoVou, SESSAO_EXPIRADA_NAO_VOU, textoLiberou, textosConfirmacaoNaoVou } from "./nao-vou-mais";

const expirou = { mensagem: SESSAO_EXPIRADA_NAO_VOU, tipo: "sessao" as const };

test("confirmação: os textos do protótipo, no plural quando o pedido tem mais de um ingresso", () => {
  assert.deepEqual(textosConfirmacaoNaoVou(1), {
    titulo: "Liberar sua vaga?",
    explicacao: "O ingresso deixa de valer e a vaga volta para outra pessoa. Dá para fazer até o evento começar.",
    botao: "Liberar minha vaga",
  });
  const plural = textosConfirmacaoNaoVou(3);
  assert.equal(plural.titulo, "Liberar suas vagas?");
  assert.equal(plural.botao, "Liberar minhas vagas");
  assert.match(plural.explicacao, /^Os ingressos deixam de valer/);
});

test("depois de liberar: o texto segue o que o servidor fez", () => {
  assert.equal(textoLiberou({ vagas: 1, usados: 0 }), "Você liberou sua vaga. Este QR não vale mais.");
  assert.equal(textoLiberou({ vagas: 2, usados: 0 }), "Você liberou suas vagas. Estes QR codes não valem mais.");
  // alguém do pedido já entrou: só os outros caíram
  assert.equal(
    textoLiberou({ vagas: 1, usados: 1 }),
    "Você liberou 1 vaga. O ingresso já usado na entrada continua registrado.",
  );
  assert.equal(
    textoLiberou({ vagas: 2, usados: 2 }),
    "Você liberou 2 vagas. Os ingressos já usados na entrada continuam registrados.",
  );
});

test("erro: sessão vencida pede login; recusa do servidor é definitiva; rede e servidor fora deixam tentar", () => {
  assert.deepEqual(erroDoNaoVou(new ApiError(401, "Sessao ausente"), expirou), expirou);
  assert.deepEqual(erroDoNaoVou(new ApiError(400, "O evento já começou."), expirou), {
    mensagem: "O evento já começou.",
    tipo: "definitivo",
  });
  assert.equal(erroDoNaoVou(new ApiError(403, "Só quem pegou"), expirou).tipo, "definitivo");
  assert.equal(erroDoNaoVou(new ApiError(429, "Muitas tentativas"), expirou).tipo, "tentar");
  const fora = erroDoNaoVou(new ApiError(502, "Bad Gateway"), expirou);
  assert.equal(fora.tipo, "tentar");
  assert.doesNotMatch(fora.mensagem, /Bad Gateway/, "erro técnico não vai para a tela");
  assert.equal(erroDoNaoVou(new TypeError("Failed to fetch"), expirou).tipo, "tentar");
});
