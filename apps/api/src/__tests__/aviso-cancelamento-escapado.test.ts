import { test } from "node:test";
import assert from "node:assert/strict";
import { montarAvisoDeCancelamento } from "../events/events.service";

// FRENTE SERVIDOR (2026-10-12): título do evento, nome da Casa e motivo do
// cancelamento são texto do produtor e entravam CRUS no HTML do e-mail aos
// compradores. Agora entram escapados; o texto puro e o assunto seguem iguais.

const perigoso = {
  titulo: `Festa <script>alert("x")</script> & Cia`,
  casa: `Casa "da Ana" <b>`,
  motivo: "Chuva forte <img src=x onerror=alert(1)>\nnova data em breve",
};

test("HTML do aviso de cancelamento escapa título, Casa e motivo", () => {
  for (const daPorta of [false, true]) {
    const aviso = montarAvisoDeCancelamento({ ...perigoso, daPorta });
    assert.ok(!aviso.html.includes("<script>"), "título não vira tag");
    assert.ok(!aviso.html.includes("<img"), "motivo não vira tag");
    assert.ok(!aviso.html.includes("<b>"), "nome da Casa não vira tag");
    assert.ok(aviso.html.includes("Festa &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Cia"));
    assert.ok(aviso.html.includes("Casa &quot;da Ana&quot; &lt;b&gt;"));
    assert.ok(aviso.html.includes("<br />nova data em breve"), "quebra de linha do motivo vira <br />");
    // texto puro e assunto não são HTML: ficam como o produtor escreveu
    assert.ok(aviso.text.includes(perigoso.titulo));
    assert.ok(aviso.subject.startsWith(perigoso.titulo));
  }
});

test("aviso de quem pagou promete o estorno; o da porta não", () => {
  const online = montarAvisoDeCancelamento({ titulo: "Baile", casa: "Casa X", motivo: "chuva", daPorta: false });
  const porta = montarAvisoDeCancelamento({ titulo: "Baile", casa: "Casa X", motivo: "chuva", daPorta: true });
  assert.equal(online.subject, "Baile foi cancelado — seu dinheiro está voltando");
  assert.equal(porta.subject, "Baile foi cancelado");
  assert.match(online.text, /devolvido/);
  assert.doesNotMatch(`${porta.subject} ${porta.text} ${porta.html}`, /dinheiro está voltando|devolvido/);
  assert.match(porta.text, /comprado na porta/);
});

test("sem nome da Casa: 'pela produção do evento', sem texto quebrado", () => {
  const aviso = montarAvisoDeCancelamento({ titulo: "Baile", casa: null, motivo: "chuva", daPorta: false });
  assert.ok(aviso.text.startsWith("Baile foi cancelado pela produção do evento."));
  assert.ok(aviso.html.includes("foi cancelado pela produção do evento."));
});
