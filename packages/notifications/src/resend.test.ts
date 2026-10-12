import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { ResendEmailSender, resendTags } from "./resend";
import { NotificationSendError } from "./types";

// Entrega real (2026-10-12): o envio devolve o id do Resend (chave dos eventos
// do webhook) e manda as tags válidas. Tag ruim é descartada — o Resend
// recusaria o e-mail inteiro por causa dela.

const originalFetch = globalThis.fetch;
let chamadas: Array<{ url: string; init: RequestInit }> = [];
let proximaResposta: () => Response;

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_chave_de_teste";
  process.env.EMAIL_FROM = "BoraFest <ingressos@borafest.com.br>";
  chamadas = [];
  proximaResposta = () => new Response(JSON.stringify({ id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }), { status: 200 });
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    return proximaResposta();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

const mensagem = { to: "fulano@exemplo.com", subject: "Seus ingressos", html: "<p>oi</p>", text: "oi" };

test("resend: devolve o id que o Resend respondeu", async () => {
  const resultado = await new ResendEmailSender().send(mensagem);
  assert.deepEqual(resultado, { providerMessageId: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });
  const corpo = JSON.parse(String(chamadas[0].init.body));
  assert.equal(corpo.tags, undefined, "sem tags, o campo nem vai");
});

test("resend: manda as tags no formato da API e descarta as inválidas", async () => {
  await new ResendEmailSender().send({
    ...mensagem,
    tags: { notification_id: "3f1f5c2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f", "com espaço": "x", origem: "valor inválido!" },
  });
  const corpo = JSON.parse(String(chamadas[0].init.body));
  assert.deepEqual(corpo.tags, [{ name: "notification_id", value: "3f1f5c2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f" }]);
  assert.deepEqual(resendTags(undefined), []);
});

test("resend: resposta aceita sem id não vira erro (o e-mail já saiu — repetir duplicaria)", async () => {
  proximaResposta = () => new Response("ok", { status: 200 });
  const resultado = await new ResendEmailSender().send(mensagem);
  assert.deepEqual(resultado, { providerMessageId: undefined });
});

test("resend: recusa do Resend continua sendo erro (o worker reagenda)", async () => {
  proximaResposta = () => new Response(JSON.stringify({ message: "invalid" }), { status: 422 });
  await assert.rejects(() => new ResendEmailSender().send(mensagem), NotificationSendError);
});
