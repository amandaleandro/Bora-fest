import assert from "node:assert/strict";
import { test } from "node:test";
import { renderTicketDeliveryEmail, renderTicketDeliveryWhatsApp } from "./render";

const payload = {
  contactName: "Ana",
  eventTitle: "Festival <Demo> & Cia",
  eventStartsAt: "22/08/2026 20:00",
  orderUrl: "https://borafest.app/pedido/tok-123",
  tickets: [
    { code: "BF-AAAA-BBBB", typeName: "Pista", lotName: "1º Lote" },
    { code: "BF-CCCC-DDDD", typeName: "Pista", lotName: "1º Lote" },
  ],
};

test("e-mail de entrega: plural, link e códigos presentes; HTML escapado", () => {
  const email = renderTicketDeliveryEmail("ana@test.dev", payload);
  assert.equal(email.to, "ana@test.dev");
  assert.match(email.subject, /^Seus ingressos — /);
  assert.ok(email.text.includes("https://borafest.app/pedido/tok-123"));
  assert.ok(email.text.includes("BF-AAAA-BBBB"));
  assert.ok(email.text.includes("BF-CCCC-DDDD"));
  assert.ok(email.html.includes("Festival &lt;Demo&gt; &amp; Cia"));
  assert.ok(!email.html.includes("<Demo>"));
});

test("e-mail de entrega: singular", () => {
  const email = renderTicketDeliveryEmail("ana@test.dev", {
    ...payload,
    tickets: payload.tickets.slice(0, 1),
  });
  assert.match(email.subject, /^Seu ingresso — /);
  assert.ok(email.text.includes("está pronto"));
});

test("whatsapp de entrega: template e variáveis", () => {
  const message = renderTicketDeliveryWhatsApp(payload);
  assert.equal(message.template, "ticket_delivery");
  assert.equal(message.variables.ticket_count, "2");
  assert.equal(message.variables.order_url, payload.orderUrl);
});
