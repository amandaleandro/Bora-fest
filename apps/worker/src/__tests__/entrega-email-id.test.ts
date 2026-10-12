import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { registerEmailSender } from "@borafest/notifications";
import type { EmailMessage } from "@borafest/notifications";
import { deliverPendingNotifications, idDoProvedor } from "../deliver-notifications";

// Entrega real (2026-10-12): o worker guarda o id que o Resend devolve e manda
// o id da notificação como tag — é assim que o webhook liga entregue/devolvido
// à linha certa. O e-mail é capturado aqui; nada sai para caixa de verdade.
// WhatsApp e push vão para o log: a rodada pode pegar sobras PENDING do banco
// de dev, e nenhuma delas pode sair para um serviço real.

const enviados: EmailMessage[] = [];
let proximoId: string | undefined;
registerEmailSender({
  provider: "captura-entrega",
  async send(mensagem) {
    enviados.push(mensagem);
    return proximoId ? { providerMessageId: proximoId } : undefined;
  },
});
process.env.EMAIL_PROVIDER = "captura-entrega";
process.env.WHATSAPP_PROVIDER = "devlog";
process.env.PUSH_PROVIDER = "devlog";

after(async () => {
  await prisma.$disconnect();
});

const rand = () => Math.random().toString(36).slice(2, 10);

test("idDoProvedor: só aceita texto não vazio", () => {
  assert.equal(idDoProvedor({ providerMessageId: "re_1" }), "re_1");
  assert.equal(idDoProvedor({ providerMessageId: "" }), null);
  assert.equal(idDoProvedor({}), null);
  assert.equal(idDoProvedor(undefined), null, "provedor sem id (devlog/captura) não quebra");
  assert.equal(idDoProvedor(null), null);
});

async function criarPendente(destino: string) {
  return prisma.notification.create({
    data: {
      channel: "EMAIL",
      recipient: destino,
      template: "cpf_defined",
      payload: { cpfMasked: "***.456.789-**", name: "Teste" },
      status: "PENDING",
      // mais antiga de todas: entra no primeiro lote mesmo com sobras no banco
      createdAt: new Date(0),
      availableAt: new Date(0),
    },
  });
}

test("worker: grava o id do Resend na notificação e manda a tag notification_id", async () => {
  const destino = `entrega-${rand()}@borafest.dev`;
  const n = await criarPendente(destino);
  try {
    proximoId = `re_${rand()}`;
    await deliverPendingNotifications();

    const linha = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(linha.status, "SENT");
    assert.equal(linha.providerMessageId, proximoId, "id do provedor gravado");

    const mensagem = enviados.find((m) => m.to === destino);
    assert.ok(mensagem, "e-mail capturado");
    assert.deepEqual(mensagem.tags, { notification_id: n.id }, "tag com o id da notificação");
  } finally {
    proximoId = undefined;
    await prisma.notification.delete({ where: { id: n.id } });
  }
});

test("worker: provedor sem id marca SENT e deixa o id vazio", async () => {
  const destino = `sem-id-${rand()}@borafest.dev`;
  const n = await criarPendente(destino);
  try {
    proximoId = undefined;
    await deliverPendingNotifications();
    const linha = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(linha.status, "SENT");
    assert.equal(linha.providerMessageId, null);
  } finally {
    await prisma.notification.delete({ where: { id: n.id } });
  }
});
