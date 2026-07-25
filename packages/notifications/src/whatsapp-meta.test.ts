import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { MetaWhatsAppSender } from "./whatsapp-meta";
import { NotificationSendError } from "./types";

const originalFetch = globalThis.fetch;

let fetchCalls: Array<{ url: string; init: RequestInit }> = [];
let nextResponse: () => Response;

beforeEach(() => {
  process.env.WHATSAPP_CLOUD_TOKEN = "token-de-teste";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "111222333";
  fetchCalls = [];
  nextResponse = () =>
    new Response(JSON.stringify({ messages: [{ id: "wamid.TESTE" }] }), { status: 200 });
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init: init ?? {} });
    return nextResponse();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.WHATSAPP_CLOUD_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
});

test("meta: texto vai para o Graph API com Bearer e type=text", async () => {
  const sender = new MetaWhatsAppSender();
  await sender.send({ to: "5511912345678", text: "Seu ingresso chegou!" });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://graph.facebook.com/v20.0/111222333/messages");
  const headers = fetchCalls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer token-de-teste");

  const body = JSON.parse(String(fetchCalls[0].init.body));
  assert.equal(body.messaging_product, "whatsapp");
  assert.equal(body.to, "5511912345678");
  assert.equal(body.type, "text");
  assert.equal(body.text.body, "Seu ingresso chegou!");
});

test("meta: imagem por URL usa type=image com link e caption", async () => {
  const sender = new MetaWhatsAppSender();
  await sender.send({
    to: "5511912345678",
    imageUrl: "https://api.borafest.com.br/v1/orders/tok/tickets/t1/qr.png",
    caption: "QR do ingresso BF-AAAA-BBBB",
  });

  const body = JSON.parse(String(fetchCalls[0].init.body));
  assert.equal(body.type, "image");
  assert.equal(body.image.link, "https://api.borafest.com.br/v1/orders/tok/tickets/t1/qr.png");
  assert.equal(body.image.caption, "QR do ingresso BF-AAAA-BBBB");
});

test("meta: template aprovado vira componentes com parâmetros nomeados", async () => {
  const sender = new MetaWhatsAppSender();
  await sender.send({
    to: "5511912345678",
    template: "ticket_delivery",
    variables: { event_title: "Festival Demo", ticket_count: "2" },
  });

  const body = JSON.parse(String(fetchCalls[0].init.body));
  assert.equal(body.type, "template");
  assert.equal(body.template.name, "ticket_delivery");
  assert.equal(body.template.language.code, "pt_BR");
  assert.deepEqual(body.template.components[0].parameters, [
    { type: "text", parameter_name: "event_title", text: "Festival Demo" },
    { type: "text", parameter_name: "ticket_count", text: "2" },
  ]);
});

test("meta: sem as chaves de env, falha antes de chamar a rede", async () => {
  delete process.env.WHATSAPP_CLOUD_TOKEN;
  const sender = new MetaWhatsAppSender();
  await assert.rejects(
    sender.send({ to: "5511912345678", text: "oi" }),
    NotificationSendError,
  );
  assert.equal(fetchCalls.length, 0);
});

test("meta: resposta não-2xx vira NotificationSendError com o status", async () => {
  nextResponse = () => new Response('{"error":{"message":"invalid token"}}', { status: 401 });
  const sender = new MetaWhatsAppSender();
  await assert.rejects(
    sender.send({ to: "5511912345678", text: "oi" }),
    /Meta respondeu 401/,
  );
});
