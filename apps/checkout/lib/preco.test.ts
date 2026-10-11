/**
 * "Grátis" no site do comprador (2026-10-11).
 *
 * Antes: lote de R$ 0 aparecia como "R$ 0,00 + R$ 0,00 taxa", o botão do
 * evento dizia "Comprar ingressos · a partir de R$ 0,00" — inclusive depois
 * que o lote grátis esgotava — e pedido de R$ 0 mostrava "R$ 0,00" no pedido,
 * em Minhas compras e no Perfil.
 *
 * Estes testes cobrem as regras puras de lib/preco.ts (sem browser, sem banco).
 * Rodar (o checkout não tem tsx próprio): apps/api/node_modules/.bin/tsx --test apps/checkout/lib/preco.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatCents } from "./format";
import {
  loteComEstoque,
  menorPrecoDisponivel,
  pedidoGratis,
  precoDoLote,
  precoOuGratis,
  textoBotaoEvento,
} from "./preco";

type Lote = {
  priceCents: number;
  feeCents: number;
  feeMode: "BUYER" | "PRODUCER";
  status: string;
  capacity: number;
  soldCount: number;
  reservedCount: number;
};

function lote(parcial: Partial<Lote>): Lote {
  return {
    priceCents: 3000,
    feeCents: 150,
    feeMode: "BUYER",
    status: "ACTIVE",
    capacity: 100,
    soldCount: 0,
    reservedCount: 0,
    ...parcial,
  };
}

function evento(...lots: Lote[]) {
  return { ticketTypes: [{ lots }] };
}

test("precoOuGratis: zero vira 'Grátis'; qualquer outro valor segue em reais", () => {
  assert.equal(precoOuGratis(0), "Grátis");
  assert.equal(precoOuGratis(1), formatCents(1));
  assert.equal(precoOuGratis(3150), formatCents(3150));
});

test("pedidoGratis: só pedido de total zero (lote grátis, cupom de 100%, cortesia)", () => {
  assert.equal(pedidoGratis({ totalCents: 0 }), true);
  assert.equal(pedidoGratis({ totalCents: 1 }), false);
  assert.equal(pedidoGratis({ totalCents: 3150 }), false);
});

test("precoDoLote: taxa entra só quando é do comprador", () => {
  assert.equal(precoDoLote(lote({ priceCents: 3000, feeCents: 150, feeMode: "BUYER" })), 3150);
  assert.equal(precoDoLote(lote({ priceCents: 3000, feeCents: 150, feeMode: "PRODUCER" })), 3000);
  assert.equal(precoDoLote(lote({ priceCents: 0, feeCents: 0 })), 0);
});

test("loteComEstoque: ativo e com vaga (reserva em andamento ocupa vaga)", () => {
  assert.equal(loteComEstoque(lote({})), true);
  assert.equal(loteComEstoque(lote({ capacity: 10, soldCount: 10 })), false);
  assert.equal(loteComEstoque(lote({ capacity: 10, soldCount: 8, reservedCount: 2 })), false);
  assert.equal(loteComEstoque(lote({ capacity: 10, soldCount: 9 })), true);
  assert.equal(loteComEstoque(lote({ status: "PAUSED" })), false);
  assert.equal(loteComEstoque(lote({ status: "SOLD_OUT" })), false);
});

test("menorPrecoDisponivel: lote grátis com estoque é o mais barato", () => {
  const ev = evento(lote({ priceCents: 0, feeCents: 0 }), lote({ priceCents: 3000, feeCents: 150 }));
  assert.equal(menorPrecoDisponivel(ev), 0);
});

test("menorPrecoDisponivel: lote grátis ESGOTADO não conta — vale o pago que sobrou", () => {
  const ev = evento(
    lote({ priceCents: 0, feeCents: 0, capacity: 50, soldCount: 50 }),
    lote({ priceCents: 3000, feeCents: 150 }),
  );
  assert.equal(menorPrecoDisponivel(ev), 3150);
});

test("menorPrecoDisponivel: lote pago esgotado também sai do 'a partir de'", () => {
  const ev = evento(
    lote({ priceCents: 2000, feeCents: 100, capacity: 10, soldCount: 7, reservedCount: 3 }),
    lote({ priceCents: 3000, feeCents: 150 }),
  );
  assert.equal(menorPrecoDisponivel(ev), 3150);
});

test("menorPrecoDisponivel: nada com estoque → null", () => {
  const ev = evento(
    lote({ priceCents: 0, feeCents: 0, capacity: 1, soldCount: 1 }),
    lote({ status: "PAUSED" }),
  );
  assert.equal(menorPrecoDisponivel(ev), null);
  assert.equal(menorPrecoDisponivel({ ticketTypes: [] }), null);
});

test("menorPrecoDisponivel: taxa absorvida pelo produtor não entra no preço anunciado", () => {
  const ev = evento(lote({ priceCents: 3000, feeCents: 150, feeMode: "PRODUCER" }), lote({ priceCents: 3100, feeCents: 155 }));
  assert.equal(menorPrecoDisponivel(ev), 3000);
});

test("textoBotaoEvento: grátis, pago e nada à venda", () => {
  assert.equal(textoBotaoEvento(0), "Garantir ingresso · Grátis");
  assert.equal(textoBotaoEvento(3150), `Comprar ingressos · a partir de ${formatCents(3150)}`);
  assert.equal(textoBotaoEvento(null), "Comprar ingressos");
});
