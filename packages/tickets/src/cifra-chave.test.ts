import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  abrirChavePrivada,
  ChaveMestraInvalidaError,
  ChavePrivadaIlegivelError,
  chavePrivadaEstaCifrada,
  cifrarChavePrivada,
  conferirChaveMestra,
  decifrarChavePrivada,
  lerChaveMestra,
  PREFIXO_CHAVE_CIFRADA,
  protegerChavePrivada,
  VARIAVEL_CHAVE_MESTRA,
} from "./cifra-chave";
import { generateEventKeyPair, signTicketToken, verifyTicketToken } from "./qr-token";

// chave do QR cifrada em repouso (2026-10-12) — ver cifra-chave.ts

const payload = { v: 1 as const, eid: "evt-1", tid: "tkt-1", lid: "lot-1", n: "abc", iat: 1 };

function envCom(valor: string | undefined): NodeJS.ProcessEnv {
  return valor === undefined ? {} : { [VARIAVEL_CHAVE_MESTRA]: valor };
}

test("cifra e decifra: o PEM volta idêntico e ainda assina QR válido", () => {
  const mestra = randomBytes(32);
  const par = generateEventKeyPair();

  const gravado = cifrarChavePrivada(par.privateKeyPem, mestra);
  assert.ok(gravado.startsWith(PREFIXO_CHAVE_CIFRADA));
  assert.ok(chavePrivadaEstaCifrada(gravado));
  assert.ok(!gravado.includes("PRIVATE KEY"), "o valor gravado não pode carregar o PEM legível");
  assert.equal(gravado.split(":").length, 5); // enc:v1:<iv>:<tag>:<dados>

  const aberto = decifrarChavePrivada(gravado, mestra);
  assert.equal(aberto, par.privateKeyPem);
  assert.equal(abrirChavePrivada(gravado, mestra), par.privateKeyPem);

  const token = signTicketToken(payload, abrirChavePrivada(gravado, mestra));
  assert.deepEqual(verifyTicketToken(token, par.publicKeyPem), payload);
});

test("cada gravação usa IV novo: o mesmo PEM não gera o mesmo texto cifrado", () => {
  const mestra = randomBytes(32);
  const { privateKeyPem } = generateEventKeyPair();
  assert.notEqual(cifrarChavePrivada(privateKeyPem, mestra), cifrarChavePrivada(privateKeyPem, mestra));
});

test("compatibilidade: chave antiga em texto puro é lida como está, com ou sem chave mestra", () => {
  const par = generateEventKeyPair();
  assert.ok(!chavePrivadaEstaCifrada(par.privateKeyPem));
  assert.equal(abrirChavePrivada(par.privateKeyPem, randomBytes(32)), par.privateKeyPem);
  assert.equal(abrirChavePrivada(par.privateKeyPem, null), par.privateKeyPem);

  const token = signTicketToken(payload, abrirChavePrivada(par.privateKeyPem, null));
  assert.deepEqual(verifyTicketToken(token, par.publicKeyPem), payload);
});

test("sem chave mestra, protegerChavePrivada grava em texto puro (modo antigo)", () => {
  const { privateKeyPem } = generateEventKeyPair();
  assert.equal(protegerChavePrivada(privateKeyPem, null), privateKeyPem);

  const mestra = randomBytes(32);
  const protegido = protegerChavePrivada(privateKeyPem, mestra);
  assert.ok(chavePrivadaEstaCifrada(protegido));
  assert.equal(abrirChavePrivada(protegido, mestra), privateKeyPem);
});

test("chave mestra errada falha com ChavePrivadaIlegivelError (nunca devolve lixo)", () => {
  const { privateKeyPem } = generateEventKeyPair();
  const gravado = cifrarChavePrivada(privateKeyPem, randomBytes(32));
  const outra = randomBytes(32);

  assert.throws(() => decifrarChavePrivada(gravado, outra), ChavePrivadaIlegivelError);
  assert.throws(() => abrirChavePrivada(gravado, outra), ChavePrivadaIlegivelError);
});

test("chave cifrada sem chave mestra no ambiente falha com mensagem clara", () => {
  const gravado = cifrarChavePrivada(generateEventKeyPair().privateKeyPem, randomBytes(32));
  assert.throws(() => abrirChavePrivada(gravado, null), (erro: unknown) => {
    assert.ok(erro instanceof ChavePrivadaIlegivelError);
    assert.match(erro.message, /TICKET_KEY_ENCRYPTION_KEY não está configurada/);
    return true;
  });
});

test("valor adulterado ou corrompido é recusado", () => {
  const mestra = randomBytes(32);
  const gravado = cifrarChavePrivada(generateEventKeyPair().privateKeyPem, mestra);
  const [enc, v1, iv, tag, dados] = gravado.split(":");

  // um byte trocado nos dados: a tag do GCM não confere
  const bytes = Buffer.from(dados, "base64url");
  bytes[0] ^= 0xff;
  const adulterado = [enc, v1, iv, tag, bytes.toString("base64url")].join(":");
  assert.throws(() => decifrarChavePrivada(adulterado, mestra), ChavePrivadaIlegivelError);

  // pedaço faltando / versão desconhecida
  assert.throws(() => decifrarChavePrivada(`${enc}:${v1}:${iv}:${tag}`, mestra), ChavePrivadaIlegivelError);
  assert.throws(() => decifrarChavePrivada(`enc:v9:${iv}:${tag}:${dados}`, mestra), ChavePrivadaIlegivelError);
  assert.throws(() => abrirChavePrivada(`enc:v9:${iv}:${tag}:${dados}`, mestra), ChavePrivadaIlegivelError);
});

test("não cifra duas vezes", () => {
  const mestra = randomBytes(32);
  const gravado = cifrarChavePrivada(generateEventKeyPair().privateKeyPem, mestra);
  assert.throws(() => cifrarChavePrivada(gravado, mestra));
});

test("lerChaveMestra: ausente = null; 32 bytes em base64 ou base64url = ok; o resto lança", () => {
  assert.equal(lerChaveMestra(envCom(undefined)), null);
  assert.equal(lerChaveMestra(envCom("   ")), null);

  const bruta = randomBytes(32);
  assert.deepEqual(lerChaveMestra(envCom(bruta.toString("base64"))), bruta);
  assert.deepEqual(lerChaveMestra(envCom(`${bruta.toString("base64")}\n`)), bruta); // colado com quebra de linha
  assert.deepEqual(lerChaveMestra(envCom(bruta.toString("base64url"))), bruta);

  assert.throws(() => lerChaveMestra(envCom(randomBytes(16).toString("base64"))), ChaveMestraInvalidaError);
  assert.throws(() => lerChaveMestra(envCom(bruta.toString("hex"))), ChaveMestraInvalidaError); // 64 hex = 48 bytes
  assert.throws(() => lerChaveMestra(envCom("não é base64!")), ChaveMestraInvalidaError);
});

test("conferirChaveMestra: sem variável avisa; com variável cifra; mal formada lança", () => {
  const sem = conferirChaveMestra(envCom(undefined));
  assert.equal(sem.cifrando, false);
  assert.match(sem.aviso ?? "", /TEXTO PURO/);

  const com = conferirChaveMestra(envCom(randomBytes(32).toString("base64")));
  assert.deepEqual(com, { cifrando: true, aviso: null });

  assert.throws(() => conferirChaveMestra(envCom("curta")), ChaveMestraInvalidaError);
});
