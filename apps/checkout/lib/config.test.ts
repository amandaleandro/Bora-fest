/**
 * Endereço do site nos links absolutos (2026-10-12).
 *
 * Em produção, robots.txt, sitemap.xml e o canonical das páginas saíram com
 * http://localhost:3100: o build não recebia NEXT_PUBLIC_SITE_URL e o fallback
 * era localhost. Estes testes fixam que build de produção sem a variável cai
 * no domínio real e que localhost só aparece fora de produção.
 *
 * Rodar (o checkout não tem tsx próprio): apps/api/node_modules/.bin/tsx --test apps/checkout/lib/config.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolverSiteUrl } from "./config";

test("produção sem NEXT_PUBLIC_SITE_URL usa o domínio real, nunca localhost", () => {
  assert.equal(resolverSiteUrl(undefined, "production"), "https://borafest.com.br");
  assert.equal(resolverSiteUrl("", "production"), "https://borafest.com.br");
  assert.equal(resolverSiteUrl("   ", "production"), "https://borafest.com.br");
});

test("fora de produção sem a variável usa a porta do next dev", () => {
  assert.equal(resolverSiteUrl(undefined, "development"), "http://localhost:3000");
  assert.equal(resolverSiteUrl(undefined, "test"), "http://localhost:3000");
  assert.equal(resolverSiteUrl(undefined, undefined), "http://localhost:3000");
});

test("a variável, quando vem, manda — sem barra final para não dobrar no /slug", () => {
  assert.equal(resolverSiteUrl("https://borafest.com.br", "production"), "https://borafest.com.br");
  assert.equal(resolverSiteUrl("https://borafest.com.br/", "production"), "https://borafest.com.br");
  assert.equal(resolverSiteUrl(" https://outro.com.br// ", "development"), "https://outro.com.br");
  assert.equal(`${resolverSiteUrl("https://borafest.com.br/", "production")}/festa-x`, "https://borafest.com.br/festa-x");
});
