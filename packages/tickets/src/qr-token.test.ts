import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateEventKeyPair,
  InvalidTicketTokenError,
  signTicketToken,
  verifyTicketToken,
} from "./qr-token";
import { generateTicketCode } from "./code";

test("assina e verifica token de ingresso (Ed25519)", () => {
  const pair = generateEventKeyPair();
  const payload = {
    v: 1 as const,
    eid: "evt-1",
    tid: "tkt-1",
    lid: "lot-1",
    n: "abc123",
    iat: 1784785613,
  };

  const token = signTicketToken(payload, pair.privateKeyPem);
  assert.ok(token.startsWith("BF1."));
  assert.deepEqual(verifyTicketToken(token, pair.publicKeyPem), payload);
});

test("token adulterado ou de outra chave é rejeitado", () => {
  const pair = generateEventKeyPair();
  const outra = generateEventKeyPair();
  const token = signTicketToken(
    { v: 1, eid: "e", tid: "t", lid: "l", n: "n", iat: 1 },
    pair.privateKeyPem,
  );

  assert.throws(
    () => verifyTicketToken(token.slice(0, -6) + "AAAAAA", pair.publicKeyPem),
    InvalidTicketTokenError,
  );
  assert.throws(() => verifyTicketToken(token, outra.publicKeyPem), InvalidTicketTokenError);
  assert.throws(() => verifyTicketToken("BF1.só.duas", pair.publicKeyPem), InvalidTicketTokenError);
});

test("código humano tem formato BF-XXXX-XXXX sem caracteres ambíguos", () => {
  for (let i = 0; i < 50; i++) {
    const code = generateTicketCode();
    assert.match(code, /^BF-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  }
});
