/**
 * Item marcado na lateral do painel (lib/menu-ativo.ts, 2026-10-12): por
 * prefixo, agrupado como as pílulas do evento e as de Clientes.
 * Rodar (o painel não tem tsx próprio): apps/api/node_modules/.bin/tsx --test apps/producer/lib/menu-ativo.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { indiceAtivo, itemDaProdutoraAtivo, itemDoEventoAtivo } from "./menu-ativo";

const EV = "ev-123";
const base = `/eventos/${EV}`;

test("evento: convite por e-mail (rota nova) marca Ingressos, como a pílula", () => {
  assert.equal(itemDoEventoAtivo(`${base}/convites`, EV), base);
  assert.equal(itemDoEventoAtivo(base, EV), base);
});

test("evento: sub-telas marcam a seção-mãe", () => {
  assert.equal(itemDoEventoAtivo(`${base}/recorrencia`, EV), `${base}/dashboard`);
  assert.equal(itemDoEventoAtivo(`${base}/checkin-ao-vivo`, EV), `${base}/portaria`);
  assert.equal(itemDoEventoAtivo(`${base}/lista-convidados`, EV), `${base}/portaria`);
});

test("evento: cada seção marca ela mesma, também com algo depois", () => {
  for (const secao of ["dashboard", "editar", "vip", "divulgue", "vendas", "promoters", "participantes", "portaria"]) {
    assert.equal(itemDoEventoAtivo(`${base}/${secao}`, EV), `${base}/${secao}`);
    assert.equal(itemDoEventoAtivo(`${base}/${secao}/algo`, EV), `${base}/${secao}`);
  }
});

test("evento: rota de outro evento (ou de id parecido) não marca nada", () => {
  assert.equal(itemDoEventoAtivo(`/eventos/${EV}9/vendas`, EV), null);
  assert.equal(itemDoEventoAtivo("/eventos/outro/vendas", EV), null);
  assert.equal(itemDoEventoAtivo("/organizacoes/org-1/financeiro", EV), null);
  assert.equal(itemDoEventoAtivo(`${base}/rota-que-nao-existe`, EV), null);
});

test("produtora: sub-telas de Clientes marcam Clientes", () => {
  const org = "/organizacoes/org-1";
  for (const tela of ["clientes", "clientes/segmentos", "clientes/inteligencia", "clientes/retencao", "clientes/reativacao", "fidelidade", "inteligencia"]) {
    assert.equal(itemDaProdutoraAtivo(`${org}/${tela}`, "org-1"), `${org}/clientes`, tela);
  }
});

test("produtora: seções próprias, página da produtora, Resumo e criar evento", () => {
  const org = "/organizacoes/org-1";
  assert.equal(itemDaProdutoraAtivo(`${org}/financeiro`, "org-1"), `${org}/financeiro`);
  assert.equal(itemDaProdutoraAtivo(`${org}/reembolsos`, "org-1"), `${org}/reembolsos`);
  assert.equal(itemDaProdutoraAtivo(`${org}/perfil-publico`, "org-1"), `${org}/perfil-publico`);
  assert.equal(itemDaProdutoraAtivo(org, "org-1"), org);
  assert.equal(itemDaProdutoraAtivo("/resumo", "org-1"), "/resumo");
  assert.equal(itemDaProdutoraAtivo("/eventos/novo", "org-1"), org);
  // sem produtora em foco: "Meus eventos" é a lista de produtoras
  assert.equal(itemDaProdutoraAtivo("/organizacoes", undefined), "/organizacoes");
  assert.equal(itemDaProdutoraAtivo("/eventos/novo", undefined), "/organizacoes");
});

test("produtora: tela do evento e de outra produtora não marcam item da produtora", () => {
  assert.equal(itemDaProdutoraAtivo(`${base}/vendas`, "org-1"), null);
  assert.equal(itemDaProdutoraAtivo("/organizacoes/org-2/financeiro", "org-1"), null);
  assert.equal(itemDaProdutoraAtivo("/organizacoes/org-10", "org-1"), null);
});

test("dois itens com o mesmo link: só o primeiro acende", () => {
  const links = [{ href: "/resumo" }, { href: "/organizacoes/org-1" }, { href: "/organizacoes/org-1/financeiro" }, { href: "/organizacoes/org-1" }];
  assert.equal(indiceAtivo(links, "/organizacoes/org-1"), 1);
  assert.equal(indiceAtivo(links, null), -1);
  assert.equal(indiceAtivo(links, "/nao-tem"), -1);
});
