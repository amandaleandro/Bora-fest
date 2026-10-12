import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TOTP_PASSO_SEGUNDOS,
  base32Decode,
  base32Encode,
  codigoTotp,
  hotp,
  linkOtpauth,
  passoTotp,
  verificarTotp,
} from "../seguranca-2fa/totp";
import {
  TOTP_CHAVE_ENV,
  chaveMestraTotp,
  cifrarSegredoTotp,
  decifrarSegredoTotp,
} from "../seguranca-2fa/cofre-totp";

/**
 * Segundo fator do backoffice (2026-10-12): o TOTP foi escrito à mão com o
 * crypto do Node (sem dependência nova), então a prova é contra os vetores
 * oficiais. Teste puro: não usa banco nem Redis.
 */

// RFC 6238, Apêndice B — semente SHA1 = ASCII "12345678901234567890", 8 dígitos
const SEMENTE_RFC = Buffer.from("12345678901234567890", "ascii");
const VETORES_RFC6238_SHA1: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

test("TOTP bate com todos os vetores SHA1 da RFC 6238 (8 dígitos)", () => {
  for (const [segundos, esperado] of VETORES_RFC6238_SHA1) {
    assert.equal(codigoTotp(SEMENTE_RFC, segundos * 1000, 8), esperado, `T=${segundos}`);
    assert.equal(hotp(SEMENTE_RFC, Math.floor(segundos / 30), 8), esperado, `contador de T=${segundos}`);
  }
});

test("com 6 dígitos (o que o app mostra) o código é o final do vetor de 8", () => {
  for (const [segundos, esperado] of VETORES_RFC6238_SHA1) {
    assert.equal(codigoTotp(SEMENTE_RFC, segundos * 1000), esperado.slice(-6), `T=${segundos}`);
  }
});

test("HOTP bate com os vetores da RFC 4226 (Apêndice D)", () => {
  const esperados = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  esperados.forEach((codigo, contador) => assert.equal(hotp(SEMENTE_RFC, contador), codigo, `contador ${contador}`));
});

test("verificação aceita ±30 s de relógio e devolve o passo; fora disso recusa", () => {
  const agora = 1_700_000_000_000;
  const passo = passoTotp(agora);
  const passoMs = TOTP_PASSO_SEGUNDOS * 1000;

  assert.equal(verificarTotp(SEMENTE_RFC, codigoTotp(SEMENTE_RFC, agora), agora), passo);
  assert.equal(verificarTotp(SEMENTE_RFC, codigoTotp(SEMENTE_RFC, agora - passoMs), agora), passo - 1);
  assert.equal(verificarTotp(SEMENTE_RFC, codigoTotp(SEMENTE_RFC, agora + passoMs), agora), passo + 1);
  // 2 passos (60 s) de diferença: não vale mais
  assert.equal(verificarTotp(SEMENTE_RFC, codigoTotp(SEMENTE_RFC, agora - 2 * passoMs), agora), null);
  assert.equal(verificarTotp(SEMENTE_RFC, codigoTotp(SEMENTE_RFC, agora + 2 * passoMs), agora), null);
  // espaço no meio (como o app mostra "123 456") é aceito
  const codigo = codigoTotp(SEMENTE_RFC, agora);
  assert.equal(verificarTotp(SEMENTE_RFC, `${codigo.slice(0, 3)} ${codigo.slice(3)}`, agora), passo);
});

test("verificação recusa formato errado sem lançar", () => {
  const agora = 1_700_000_000_000;
  for (const ruim of ["", "12345", "1234567", "abcdef", "12345a", "-12345"]) {
    assert.equal(verificarTotp(SEMENTE_RFC, ruim, agora), null, JSON.stringify(ruim));
  }
  assert.equal(verificarTotp(SEMENTE_RFC, undefined as unknown as string, agora), null);
});

test("código de outro segredo não passa", () => {
  const agora = 1_700_000_000_000;
  const outro = Buffer.from("abcdefghijabcdefghij", "ascii");
  const codigo = codigoTotp(outro, agora);
  // garante que o teste não depende de coincidência entre os dois segredos
  if (codigoTotp(SEMENTE_RFC, agora) !== codigo) {
    assert.equal(verificarTotp(SEMENTE_RFC, codigo, agora, 0), null);
  }
});

test("base32 segue a RFC 4648 (sem '=') e faz ida e volta", () => {
  const vetores: Array<[string, string]> = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];
  for (const [texto, b32] of vetores) {
    assert.equal(base32Encode(Buffer.from(texto)), b32, texto);
    assert.equal(base32Decode(b32).toString(), texto, b32);
  }
  assert.equal(base32Encode(SEMENTE_RFC), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  // como as pessoas copiam: minúsculas, espaços, hífens e "="
  assert.equal(base32Decode("gezd gnbv-gy3t qojq gezdgnbvgy3tqojq==").toString("ascii"), "12345678901234567890");
  assert.throws(() => base32Decode("1NVALIDO"), /base32/);
});

test("link otpauth:// traz segredo, emissor e parâmetros do padrão", () => {
  const link = linkOtpauth({ emissor: "BoraFest", conta: "admin@borafest.com.br", segredoBase32: "GEZDGNBV" });
  assert.equal(
    link,
    "otpauth://totp/BoraFest:admin%40borafest.com.br?secret=GEZDGNBV&issuer=BoraFest&algorithm=SHA1&digits=6&period=30",
  );
});

test("cofre: segredo cifrado volta igual, mas só com a mesma chave e o mesmo usuário", () => {
  const anterior = process.env[TOTP_CHAVE_ENV];
  try {
    delete process.env[TOTP_CHAVE_ENV];
    assert.equal(chaveMestraTotp(), null, "sem a variável não há chave");
    process.env[TOTP_CHAVE_ENV] = "curta-demais";
    assert.equal(chaveMestraTotp(), null, "chave curta é recusada");

    process.env[TOTP_CHAVE_ENV] = "a".repeat(64);
    const chave = chaveMestraTotp()!;
    assert.equal(chave.length, 32);

    const guardado = cifrarSegredoTotp(SEMENTE_RFC, "user-1", chave);
    assert.match(guardado, /^v1:/);
    assert.ok(!guardado.includes(base32Encode(SEMENTE_RFC)), "nada do segredo em texto puro");
    assert.notEqual(cifrarSegredoTotp(SEMENTE_RFC, "user-1", chave), guardado, "IV novo a cada cifragem");
    assert.deepEqual(decifrarSegredoTotp(guardado, "user-1", chave), SEMENTE_RFC);

    // segredo copiado para outra conta não abre (id entra como dado autenticado)
    assert.throws(() => decifrarSegredoTotp(guardado, "user-2", chave));
    // chave mestra trocada não abre
    process.env[TOTP_CHAVE_ENV] = "b".repeat(64);
    assert.throws(() => decifrarSegredoTotp(guardado, "user-1", chaveMestraTotp()!));
    // texto adulterado não abre
    const partes = guardado.split(":");
    const adulterado = [partes[0], partes[1], partes[2], Buffer.from("xxxxxxxxxxxxxxxxxxxx").toString("base64")].join(":");
    assert.throws(() => decifrarSegredoTotp(adulterado, "user-1", chave));
    assert.throws(() => decifrarSegredoTotp("lixo", "user-1", chave), /Formato/);
  } finally {
    if (anterior === undefined) delete process.env[TOTP_CHAVE_ENV];
    else process.env[TOTP_CHAVE_ENV] = anterior;
  }
});
