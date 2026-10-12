/**
 * Validador único de CPF do checkout (2026-10-12).
 *
 * Antes havia três contas iguais copiadas (lib/cpf.ts, perfil e PDV da porta);
 * o perfil e o PDV passaram a importar de lib/cpf.ts. Estes testes fixam o
 * comportamento de que as telas dependem: aceita CPF digitado com ponto,
 * hífen e espaço, recusa dígito verificador errado e sequência repetida.
 *
 * Rodar (o checkout não tem tsx próprio): apps/api/node_modules/.bin/tsx --test apps/checkout/lib/cpf.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ehCpfValido, normalizarCpf } from "./cpf";

test("normalizarCpf tira tudo que não é dígito e trata vazio", () => {
  assert.equal(normalizarCpf("529.982.247-25"), "52998224725");
  assert.equal(normalizarCpf(" 529 982 247 25 "), "52998224725");
  assert.equal(normalizarCpf(""), "");
  assert.equal(normalizarCpf(null), "");
  assert.equal(normalizarCpf(undefined), "");
});

test("CPF válido passa só com dígitos, com máscara ou com espaço", () => {
  assert.equal(ehCpfValido("52998224725"), true);
  assert.equal(ehCpfValido("529.982.247-25"), true);
  assert.equal(ehCpfValido("111 444 777 35"), true);
});

test("dígito verificador que vem de resto 10 vira 0", () => {
  // 123.456.789-09: o 1º verificador sai de resto 10 — tem que valer 0
  assert.equal(ehCpfValido("123.456.789-09"), true);
  assert.equal(ehCpfValido("12345678910"), false);
});

test("verificador errado é recusado", () => {
  assert.equal(ehCpfValido("529.982.247-24"), false);
  assert.equal(ehCpfValido("529.982.247-15"), false);
});

test("sequência repetida, tamanho errado e vazio são recusados", () => {
  assert.equal(ehCpfValido("000.000.000-00"), false);
  assert.equal(ehCpfValido("11111111111"), false);
  assert.equal(ehCpfValido("5299822472"), false);
  assert.equal(ehCpfValido("529982247250"), false);
  assert.equal(ehCpfValido(""), false);
  assert.equal(ehCpfValido(null), false);
  assert.equal(ehCpfValido(undefined), false);
});
