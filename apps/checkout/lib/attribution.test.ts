/**
 * Regressão da atribuição de vendas.
 *
 * Bug corrigido: os links de promoter (`/?pr=slug`) e vendedor (`/?vd=slug`)
 * gerados no painel aterrissam na HOME, mas só a página de evento chamava a
 * captura. A home ignorava ?pr=/?vd= e a navegação para o evento descarta a
 * query — então promoterSlug/sellerSlug nunca chegavam ao createOrder e a
 * comissão do promoter ficava sempre zero.
 *
 * Estes testes exercitam a lógica pura de captura/persistência (last-click,
 * janela de 7 dias) com `window` e `localStorage` mockados — sem browser.
 * Rodar: apps/checkout/node_modules/.bin/tsx --test apps/checkout/lib/attribution.test.ts
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  captureAttributionFromUrl,
  getAttributedPartnerSlug,
  getAttributedPromoterSlug,
  getAttributedSellerSlug,
} from "./attribution";

// localStorage de memória (o módulo lê o global `localStorage` a cada chamada)
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

const g = globalThis as unknown as {
  localStorage: MemStorage;
  window: { location: { search: string } };
};

/** Simula aterrissar numa URL (o módulo lê `window.location.search`). */
function landOn(search: string) {
  g.window.location.search = search;
  captureAttributionFromUrl();
}

beforeEach(() => {
  g.localStorage = new MemStorage();
  g.window = { location: { search: "" } };
});

test("home com ?pr= captura o promoter (era ignorado — causa do bug)", () => {
  landOn("?pr=promoX");
  assert.equal(getAttributedPromoterSlug(), "promoX");
  assert.equal(getAttributedPartnerSlug(), undefined);
  assert.equal(getAttributedSellerSlug(), undefined);
});

test("home com ?vd= captura o vendedor", () => {
  landOn("?vd=vendY");
  assert.equal(getAttributedSellerSlug(), "vendY");
  assert.equal(getAttributedPromoterSlug(), undefined);
});

test("promoter capturado na home sobrevive à navegação para o evento (query vazia não apaga)", () => {
  landOn("?pr=promoX");
  landOn(""); // vai para /evento/slug, sem query — não pode zerar a atribuição
  assert.equal(getAttributedPromoterSlug(), "promoX");
});

test("last-click: um canal novo zera os outros (?vd= depois de ?pr=)", () => {
  landOn("?pr=promoX");
  landOn("?vd=vendY");
  assert.equal(getAttributedSellerSlug(), "vendY");
  assert.equal(getAttributedPromoterSlug(), undefined, "promoter antigo deve ser apagado");
});

test("last-click: ?p= (atlética) zera promoter e vendedor", () => {
  landOn("?vd=vendY");
  landOn("?p=atletZ");
  assert.equal(getAttributedPartnerSlug(), "atletZ");
  assert.equal(getAttributedPromoterSlug(), undefined);
  assert.equal(getAttributedSellerSlug(), undefined);
});

test("fora da janela de 7 dias a atribuição expira", () => {
  g.localStorage.setItem(
    "bf.promoter",
    JSON.stringify({ slug: "promoVelho", expiresAt: Date.now() - 1 }),
  );
  assert.equal(getAttributedPromoterSlug(), undefined);
});

test("aterrissar sem parâmetro não captura nada", () => {
  landOn("?utm_source=insta");
  assert.equal(getAttributedPartnerSlug(), undefined);
  assert.equal(getAttributedPromoterSlug(), undefined);
  assert.equal(getAttributedSellerSlug(), undefined);
});
