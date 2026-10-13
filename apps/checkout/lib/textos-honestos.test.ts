/**
 * Textos que prometiam o que o servidor não faz (2026-10-12) — conferidos na
 * fonte das telas, no padrão de codigo-promoter.test.ts (sem navegador):
 *  - Minhas compras: reembolso "garantido em 7 dias" e "resposta em até 5
 *    dias úteis" — o servidor só registra o pedido para análise (sem prazo);
 *  - Perfil: a exclusão de conta dizia que os pedidos continuavam "com o
 *    contato usado na compra" — me.service deleteAccount apaga esse contato;
 *  - Pedido: o aviso de valor diferente vem do /status (polling de 3 s) e uma
 *    falha de rede no polling não apaga mais o pedido da tela.
 * Rodar (o checkout não tem tsx próprio): apps/api/node_modules/.bin/tsx --test apps/checkout/lib/textos-honestos.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fonte = (tela: string) => readFileSync(resolve(__dirname, tela), "utf8");

test("Minhas compras: o pedido de reembolso não promete prazo que o servidor não cumpre", () => {
  const tela = fonte("../app/minhas-compras/page.tsx");
  assert.doesNotMatch(tela, /reembolso garantido/i, "voltou a prometer reembolso garantido");
  assert.doesNotMatch(tela, /dias úteis/i, "voltou a prometer prazo de resposta");
  // o que acontece de verdade: análise (organizador ou BoraFest) e ingresso valendo até a resposta
  assert.match(tela, /análise do organizador do evento ou da BoraFest/);
  assert.match(tela, /os ingressos\s+continuam valendo/);
  // só o estorno TOTAL cancela os ingressos (o parcial os mantém)
  assert.match(tela, /no\s+reembolso total, os ingressos do pedido são cancelados/);
});

test("Minhas compras: confirmar o reembolso duas vezes não manda dois pedidos", () => {
  const tela = fonte("../app/minhas-compras/page.tsx");
  assert.match(tela, /if \(refundTravado\.current\) return;/);
  assert.match(tela, /disabled=\{refundEnviando\}/);
});

test("Perfil: a exclusão de conta diz o que o servidor faz hoje", () => {
  const tela = fonte("../app/perfil/page.tsx");
  assert.doesNotMatch(tela, /com o contato usado na compra/, "voltou a dizer que o contato do pedido fica");
  assert.match(tela, /da sua conta e dos seus pedidos/);
  assert.match(tela, /não é cancelado e continua valendo/);
  assert.match(tela, /não dá mais para entrar nesta conta/);
  // clique duplo: a 1ª chamada derruba a sessão; a 2ª nem sai
  assert.match(tela, /exclusaoTravada\.current\) return;/);
});

test("Pedido: o aviso de valor diferente vem do /status, e o polling sobrevive a uma falha", () => {
  const tela = fonte("../app/pedido/[publicToken]/page.tsx");
  assert.match(tela, /if \(o\.valorDiferente === true\) setValorDiferente\(true\);/);
  // antes o catch fazia setOrder(null): a tela voltava a "Carregando" e o polling parava
  assert.doesNotMatch(tela, /setOrder\(null\)/);
  const api = fonte("./api.ts");
  assert.match(api, /valorDiferente\?: boolean;/);
});
