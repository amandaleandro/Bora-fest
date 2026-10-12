import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { prisma } from "@borafest/database";
import { PlatformAccessService } from "../common/platform-access.service";
import {
  assinarSvix,
  chaveDoSegredo,
  lerCabecalhosSvix,
  verificarAssinaturaSvix,
} from "../webhooks-email/assinatura-svix";
import { eventosAbaixoDe, lerEventoResend, planoDoEvento } from "../webhooks-email/eventos-resend";
import { WebhooksEmailService } from "../webhooks-email/webhooks-email.service";

// Entrega real do e-mail (2026-10-12): o webhook do Resend só vale com a
// assinatura Svix conferida, grava entregue/devolvido/spam na notificação e
// nunca deixa um evento atrasado apagar um mais grave.

const SEGREDO = `whsec_${Buffer.from("segredo-de-teste-do-webhook-do-resend").toString("base64")}`;
const rand = () => Math.random().toString(36).slice(2, 10);

after(async () => {
  await prisma.$disconnect();
});

function assinado(corpo: unknown, opcoes: { agora?: Date; segredo?: string } = {}) {
  const cru = Buffer.from(JSON.stringify(corpo), "utf8");
  const id = `msg_${rand()}`;
  const ts = String(Math.floor((opcoes.agora ?? new Date()).getTime() / 1000));
  const assinatura = assinarSvix(opcoes.segredo ?? SEGREDO, id, ts, cru);
  return {
    headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${assinatura}` } as Record<string, string>,
    cru,
  };
}

function evento(tipo: string, dados: Record<string, unknown>, criadoEm = new Date()) {
  return { type: tipo, created_at: criadoEm.toISOString(), data: { created_at: criadoEm.toISOString(), ...dados } };
}

// ---------------------------------------------------------------------------
// assinatura (puro)
// ---------------------------------------------------------------------------

test("assinatura: confere o exemplo oficial do Svix", () => {
  const resultado = verificarAssinaturaSvix({
    segredo: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
    cabecalhos: {
      id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
      timestamp: "1614265330",
      assinaturas: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
    },
    corpo: '{"test": 2432232314}',
    agora: new Date(1614265330 * 1000),
  });
  assert.deepEqual(resultado, { ok: true });
});

test("assinatura: corpo alterado, segredo errado, horário velho e cabeçalho faltando são recusados", () => {
  const { headers, cru } = assinado({ type: "email.delivered", data: { email_id: "x" } });
  const cabecalhos = lerCabecalhosSvix(headers);
  assert.deepEqual(verificarAssinaturaSvix({ segredo: SEGREDO, cabecalhos, corpo: cru }), { ok: true });

  const adulterado = Buffer.from(cru.toString("utf8").replace("delivered", "bounced"));
  assert.equal(verificarAssinaturaSvix({ segredo: SEGREDO, cabecalhos, corpo: adulterado }).ok, false, "corpo trocado");

  const outroSegredo = `whsec_${Buffer.from("outro-segredo-qualquer").toString("base64")}`;
  assert.equal(verificarAssinaturaSvix({ segredo: outroSegredo, cabecalhos, corpo: cru }).ok, false, "segredo errado");

  const seisMinutosDepois = new Date(Date.now() + 6 * 60 * 1000);
  assert.equal(
    verificarAssinaturaSvix({ segredo: SEGREDO, cabecalhos, corpo: cru, agora: seisMinutosDepois }).ok,
    false,
    "fora da janela de 5 minutos (replay)",
  );

  assert.equal(
    verificarAssinaturaSvix({ segredo: SEGREDO, cabecalhos: { ...cabecalhos, assinaturas: undefined }, corpo: cru }).ok,
    false,
    "sem svix-signature",
  );
});

test("assinatura: aceita a lista com várias assinaturas (troca de segredo) e o segredo sem prefixo", () => {
  const { headers, cru } = assinado({ type: "email.sent", data: {} });
  const boa = headers["svix-signature"];
  const cabecalhos = lerCabecalhosSvix({ ...headers, "svix-signature": `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${boa}` });
  assert.deepEqual(verificarAssinaturaSvix({ segredo: SEGREDO, cabecalhos, corpo: cru }), { ok: true });
  assert.deepEqual(
    verificarAssinaturaSvix({ segredo: SEGREDO.slice("whsec_".length), cabecalhos, corpo: cru }),
    { ok: true },
  );
  assert.equal(chaveDoSegredo("whsec_"), null, "segredo vazio não vira chave");
});

// ---------------------------------------------------------------------------
// leitura do evento e ordem de gravidade (puro)
// ---------------------------------------------------------------------------

test("evento: lê id, destinatário, tag (objeto ou lista) e motivo da devolução", () => {
  const id = "3f1f5c2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f";
  const lido = lerEventoResend(
    evento("email.bounced", {
      email_id: "re_123",
      to: ["Fulano@Exemplo.com"],
      tags: { notification_id: id },
      bounce: { message: "Mailbox does not exist", type: "Permanent" },
    }),
  );
  assert.ok(lido);
  assert.equal(lido.emailId, "re_123");
  assert.deepEqual(lido.destinatarios, ["Fulano@Exemplo.com"]);
  assert.equal(lido.notificationId, id);
  assert.equal(lido.motivo, "Mailbox does not exist");

  const comLista = lerEventoResend(evento("email.delivered", { email_id: "re_1", tags: [{ name: "notification_id", value: id }] }));
  assert.equal(comLista?.notificationId, id);

  const tagInvalida = lerEventoResend(evento("email.delivered", { email_id: "re_1", tags: { notification_id: "nao-e-uuid" } }));
  assert.equal(tagInvalida?.notificationId, null, "tag fora do formato é ignorada");

  assert.equal(lerEventoResend({ foo: 1 }), null);
  assert.equal(lerEventoResend(null), null);
});

test("evento: plano por tipo e ordem de gravidade", () => {
  const quando = new Date("2026-10-12T12:00:00Z");
  const base = { emailId: "re_1", ocorridoEm: quando, destinatarios: [], notificationId: null, motivo: null };

  assert.deepEqual(planoDoEvento({ ...base, tipo: "email.delivered" }), {
    deliveryEvent: "email.delivered",
    peso: 3,
    deliveredAt: quando,
  });
  const devolvido = planoDoEvento({ ...base, tipo: "email.bounced", motivo: "caixa cheia" });
  assert.equal(devolvido?.bouncedAt, quando);
  assert.match(devolvido?.erro ?? "", /Devolvido.*caixa cheia/);
  assert.equal(planoDoEvento({ ...base, tipo: "email.opened" }), null, "abertura não é acompanhada");
  assert.equal(planoDoEvento({ ...base, tipo: "email.clicked" }), null, "clique não é acompanhado");

  assert.ok(eventosAbaixoDe(5).includes("email.delivered"), "spam passa por cima de entregue");
  assert.ok(!eventosAbaixoDe(3).includes("email.complained"), "entregue nunca apaga spam");
  assert.ok(!eventosAbaixoDe(4).includes("email.failed"), "mesmo peso não se substitui");
});

// ---------------------------------------------------------------------------
// serviço (banco)
// ---------------------------------------------------------------------------

const segredoAntes = process.env.RESEND_WEBHOOK_SECRET;
beforeEach(() => {
  process.env.RESEND_WEBHOOK_SECRET = SEGREDO;
});
afterEach(() => {
  if (segredoAntes === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
  else process.env.RESEND_WEBHOOK_SECRET = segredoAntes;
});

async function criarNotificacao(dados: { recipient: string; providerMessageId?: string | null }) {
  return prisma.notification.create({
    data: {
      channel: "EMAIL",
      recipient: dados.recipient,
      template: "ticket_delivery",
      payload: {},
      status: "SENT",
      sentAt: new Date(),
      providerMessageId: dados.providerMessageId ?? null,
    },
  });
}

test("webhook: sem RESEND_WEBHOOK_SECRET recusa (503) e assinatura errada recusa (401)", async () => {
  const service = new WebhooksEmailService(new PlatformAccessService());
  const { headers, cru } = assinado(evento("email.delivered", { email_id: "re_x" }));

  delete process.env.RESEND_WEBHOOK_SECRET;
  await assert.rejects(() => service.receberResend(headers, cru), (err: any) => err.getStatus?.() === 503);

  process.env.RESEND_WEBHOOK_SECRET = SEGREDO;
  const falsificado = assinado(evento("email.delivered", { email_id: "re_x" }), {
    segredo: `whsec_${Buffer.from("segredo-do-atacante").toString("base64")}`,
  });
  await assert.rejects(
    () => service.receberResend(falsificado.headers, falsificado.cru),
    (err: any) => err.getStatus?.() === 401,
  );
});

test("webhook: entregue, depois spam, depois um 'entregue' atrasado — spam fica", async () => {
  const service = new WebhooksEmailService(new PlatformAccessService());
  const emailId = `re_${rand()}`;
  const destino = `entrega-${rand()}@borafest.dev`;
  const n = await criarNotificacao({ recipient: destino, providerMessageId: emailId });
  try {
    const entregueEm = new Date(Date.now() - 60_000);
    const r1 = assinado(evento("email.delivered", { email_id: emailId, to: [destino] }, entregueEm));
    assert.deepEqual(await service.receberResend(r1.headers, r1.cru), { recebido: true });

    let linha = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(linha.deliveryEvent, "email.delivered");
    assert.equal(linha.deliveredAt?.getTime(), entregueEm.getTime(), "data do evento, não do recebimento");

    const r2 = assinado(evento("email.complained", { email_id: emailId, to: [destino] }));
    await service.receberResend(r2.headers, r2.cru);
    const r3 = assinado(evento("email.delivered", { email_id: emailId, to: [destino] }));
    await service.receberResend(r3.headers, r3.cru);

    linha = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(linha.deliveryEvent, "email.complained", "entregue atrasado não apaga a reclamação");
    assert.equal(linha.deliveredAt?.getTime(), entregueEm.getTime(), "primeira entrega preservada");
    assert.equal(linha.status, "SENT", "status de envio não muda");
  } finally {
    await prisma.notification.delete({ where: { id: n.id } });
  }
});

test("webhook: devolvido grava bouncedAt e o motivo no erro", async () => {
  const service = new WebhooksEmailService(new PlatformAccessService());
  const emailId = `re_${rand()}`;
  const destino = `devolvido-${rand()}@borafest.dev`;
  const n = await criarNotificacao({ recipient: destino, providerMessageId: emailId });
  try {
    const r = assinado(
      evento("email.bounced", {
        email_id: emailId,
        to: [destino],
        bounce: { message: "The recipient's email address does not exist", type: "Permanent" },
      }),
    );
    await service.receberResend(r.headers, r.cru);
    const linha = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(linha.deliveryEvent, "email.bounced");
    assert.ok(linha.bouncedAt);
    assert.match(linha.error ?? "", /does not exist/);
    assert.equal(linha.deliveredAt, null);
  } finally {
    await prisma.notification.delete({ where: { id: n.id } });
  }
});

test("webhook: evento que chega antes do id gravado acha a linha pela tag — só com o mesmo destinatário", async () => {
  const service = new WebhooksEmailService(new PlatformAccessService());
  const destino = `tag-${rand()}@borafest.dev`;
  const n = await criarNotificacao({ recipient: destino, providerMessageId: null });
  try {
    const emailId = `re_${rand()}`;

    const outroDestino = assinado(
      evento("email.delivered", { email_id: emailId, to: ["outra-pessoa@borafest.dev"], tags: { notification_id: n.id } }),
    );
    const ignorado = await service.receberResend(outroDestino.headers, outroDestino.cru);
    assert.equal((ignorado as { ignorado?: string }).ignorado, "e-mail sem notificação registrada");
    let linha = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(linha.deliveredAt, null, "tag com destinatário diferente não vale");

    const certo = assinado(
      evento("email.delivered", { email_id: emailId, to: [destino.toUpperCase()], tags: { notification_id: n.id } }),
    );
    await service.receberResend(certo.headers, certo.cru);
    linha = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(linha.providerMessageId, emailId, "id do Resend gravado pelo webhook");
    assert.ok(linha.deliveredAt);
  } finally {
    await prisma.notification.delete({ where: { id: n.id } });
  }
});

test("webhook: e-mail desconhecido e evento não acompanhado respondem 200 sem gravar nada", async () => {
  const service = new WebhooksEmailService(new PlatformAccessService());
  const desconhecido = assinado(evento("email.delivered", { email_id: `re_${rand()}`, to: ["x@borafest.dev"] }));
  const r1 = await service.receberResend(desconhecido.headers, desconhecido.cru);
  assert.equal((r1 as { recebido: boolean }).recebido, true);

  const aberto = assinado(evento("email.opened", { email_id: `re_${rand()}` }));
  const r2 = await service.receberResend(aberto.headers, aberto.cru);
  assert.match((r2 as { ignorado?: string }).ignorado ?? "", /não é acompanhado/);
});

test("consulta do suporte: só equipe; traz o estado de entrega e nunca o payload", async () => {
  const service = new WebhooksEmailService(new PlatformAccessService());
  const destino = `suporte-${rand()}@borafest.dev`;
  const n = await criarNotificacao({ recipient: destino, providerMessageId: `re_${rand()}` });
  const staff = await prisma.user.create({ data: { email: `staff-${rand()}@borafest.dev`, platformRole: "SUPPORT" } });
  const comum = await prisma.user.create({ data: { email: `comum-${rand()}@borafest.dev` } });
  try {
    await prisma.notification.update({
      where: { id: n.id },
      data: { bouncedAt: new Date(), deliveryEvent: "email.bounced", payload: { magicLink: "SEGREDO-DO-LINK" } },
    });

    await assert.rejects(() => service.listarParaSuporte(comum.id, { destinatario: destino }), /equipe BoraFest/);
    await assert.rejects(() => service.listarParaSuporte(staff.id, { destinatario: "ab" }), /3 caracteres/);

    const r = await service.listarParaSuporte(staff.id, { destinatario: destino.toUpperCase() });
    assert.equal(r.itens.length, 1);
    assert.equal(r.itens[0].deliveryEvent, "email.bounced");
    assert.ok(r.itens[0].bouncedAt);
    assert.ok(!JSON.stringify(r).includes("SEGREDO-DO-LINK"), "payload nunca sai");
    assert.equal(r.webhookConfigurado, true);

    const problemas = await service.listarParaSuporte(staff.id, { destinatario: destino, situacao: "problemas" });
    assert.equal(problemas.itens.length, 1, "devolvido entra em 'só problemas'");
  } finally {
    await prisma.notification.delete({ where: { id: n.id } });
    await prisma.user.deleteMany({ where: { id: { in: [staff.id, comum.id] } } });
  }
});
