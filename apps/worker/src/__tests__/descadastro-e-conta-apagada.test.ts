import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { ENVIO_CANCELADO, emailAnonimoDaConta, prisma } from "@borafest/database";
import { registerEmailSender } from "@borafest/notifications";
import type { EmailMessage } from "@borafest/notifications";
import { sendAbandonedCartReminders, sendExpiredRescueEmails } from "../abandoned-cart";
import { createFixtureEvent, cleanupFixtureEvent } from "../../../api/src/__tests__/helpers";
import {
  MOTIVO_CAMPANHA_SEM_CASA,
  MOTIVO_SAIU_DAS_CAMPANHAS,
  TEMPLATES_DE_CAMPANHA,
  casaDaCampanha,
  deliverPendingNotifications,
  motivoParaNaoEnviar,
} from "../deliver-notifications";
import { ERRO_DESCADASTRADO, TEMPLATES_DE_CAMPANHA as TEMPLATES_DA_API } from "../../../api/src/descadastro/supressao";
import { ENVIO_CANCELADO as ENVIO_CANCELADO_DA_API } from "../../../api/src/me/exclusao-de-conta";

// FRENTE WORKER (LGPD, 2026-10-12) — conferência LOGO ANTES do envio:
//  - destinatário de conta excluída (@anon.borafest.invalid) nunca recebe: a
//    linha vira FAILED com o motivo na 1ª vez, sem as 5 tentativas;
//  - campanha de uma Casa não vai para quem saiu das campanhas DELA
//    (marketing_opt_outs, Casa + e-mail normalizado); outra Casa continua;
//  - lembrete de carrinho e resgate (que mandam direto, sem a fila) também
//    pulam pedido de conta excluída.
// O e-mail é capturado aqui; nada sai para caixa de verdade. WhatsApp e push
// vão para o log (a rodada pode pegar sobras PENDING do banco de dev).

const enviados: EmailMessage[] = [];
registerEmailSender({
  provider: "captura-descadastro",
  async send(mensagem) {
    enviados.push(mensagem);
    return undefined;
  },
});
process.env.EMAIL_PROVIDER = "captura-descadastro";
process.env.WHATSAPP_PROVIDER = "devlog";
process.env.PUSH_PROVIDER = "devlog";

after(async () => {
  await prisma.$disconnect();
});

const rand = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

test("regra: worker e API falam a mesma língua (templates de campanha e motivos)", () => {
  assert.deepEqual([...TEMPLATES_DE_CAMPANHA].sort(), [...TEMPLATES_DA_API].sort());
  assert.equal(MOTIVO_SAIU_DAS_CAMPANHAS, ERRO_DESCADASTRADO, "mesmo texto do descadastro na hora");
  assert.equal(ENVIO_CANCELADO, ENVIO_CANCELADO_DA_API, "mesmo texto da exclusão de conta");
});

test("regra: Casa da campanha só com id válido no corpo", () => {
  const casa = randomUUID();
  assert.equal(casaDaCampanha({ organizationId: casa }), casa);
  assert.equal(casaDaCampanha({ organizationId: "casa-1" }), null);
  assert.equal(casaDaCampanha({ organizationId: 123 }), null);
  assert.equal(casaDaCampanha({}), null);
  assert.equal(casaDaCampanha(null), null);
  assert.equal(casaDaCampanha([casa]), null);
  assert.equal(casaDaCampanha("x"), null);
});

test("regra: conta excluída não recebe nada, de nenhum modelo", async () => {
  const anonimo = emailAnonimoDaConta(randomUUID());
  assert.equal(await motivoParaNaoEnviar({ recipient: anonimo, template: "ticket_delivery", payload: {} }), ENVIO_CANCELADO);
  assert.equal(
    await motivoParaNaoEnviar({ recipient: `  ${anonimo.toUpperCase()} `, template: "otp_code", payload: {} }),
    ENVIO_CANCELADO,
    "maiúscula e espaço não escapam",
  );
  assert.equal(
    await motivoParaNaoEnviar({ recipient: anonimo, template: "crm_reactivation", payload: { organizationId: randomUUID() } }),
    ENVIO_CANCELADO,
  );
  // e-mail comum, fora de campanha: pode sair (sem consulta ao banco)
  assert.equal(await motivoParaNaoEnviar({ recipient: "pessoa@borafest.dev", template: "ticket_delivery", payload: {} }), null);
});

// ---------------------------------------------------------------------------
// Entrega real pela fila
// ---------------------------------------------------------------------------

async function criarPendente(dados: { recipient: string; template: string; payload: object }) {
  return prisma.notification.create({
    data: {
      channel: "EMAIL",
      recipient: dados.recipient,
      template: dados.template,
      payload: dados.payload,
      status: "PENDING",
      // mais antigas de todas: entram no primeiro lote mesmo com sobras no banco
      createdAt: new Date(0),
      availableAt: new Date(0),
    },
  });
}

function campanha(organizationId: string | null) {
  return {
    campaignId: randomUUID(),
    ...(organizationId ? { organizationId } : {}),
    houseName: "Casa Teste",
    customerName: "Pessoa",
    subject: "Volta pra Casa",
    message: "Tem evento novo.",
  };
}

test("worker: conta excluída e quem saiu das campanhas não recebem; o resto sai", async () => {
  const casa = randomUUID();
  const outraCasa = randomUUID();
  const saiu = `saiu-${rand()}@borafest.dev`;
  const ficou = `ficou-${rand()}@borafest.dev`;
  const anonimo = emailAnonimoDaConta(randomUUID());

  // a pessoa saiu das campanhas da `casa` (chave normalizada, como a API grava)
  await prisma.marketingOptOut.create({ data: { organizationId: casa, emailKey: saiu } });
  const linhas = {
    contaApagada: await criarPendente({ recipient: anonimo, template: "ticket_delivery", payload: { name: "x" } }),
    // grafia diferente do mesmo e-mail: a chave é LOWER(TRIM())
    saiuDaCasa: await criarPendente({ recipient: `  ${saiu.toUpperCase()} `, template: "crm_reactivation", payload: campanha(casa) }),
    saiuMasOutraCasa: await criarPendente({ recipient: saiu, template: "crm_reactivation", payload: campanha(outraCasa) }),
    ficou: await criarPendente({ recipient: ficou, template: "crm_reactivation", payload: campanha(casa) }),
    semCasa: await criarPendente({ recipient: ficou, template: "crm_reactivation", payload: campanha(null) }),
  };
  try {
    await deliverPendingNotifications();
    const linha = (id: string) => prisma.notification.findUniqueOrThrow({ where: { id } });

    const apagada = await linha(linhas.contaApagada.id);
    assert.equal(apagada.status, "FAILED");
    assert.equal(apagada.error, ENVIO_CANCELADO);
    assert.equal(apagada.attempts, 1, "não tenta 5 vezes");
    assert.equal(apagada.sentAt, null);

    const saiuDaCasa = await linha(linhas.saiuDaCasa.id);
    assert.equal(saiuDaCasa.status, "FAILED");
    assert.equal(saiuDaCasa.error, MOTIVO_SAIU_DAS_CAMPANHAS);
    assert.equal(saiuDaCasa.attempts, 1);

    const semCasa = await linha(linhas.semCasa.id);
    assert.equal(semCasa.status, "FAILED");
    assert.equal(semCasa.error, MOTIVO_CAMPANHA_SEM_CASA, "sem a Casa não dá para conferir: não sai");

    // o descadastro vale só para a Casa de onde a pessoa saiu
    assert.equal((await linha(linhas.saiuMasOutraCasa.id)).status, "SENT");
    assert.equal((await linha(linhas.ficou.id)).status, "SENT");

    const para = enviados.map((m) => m.to.trim().toLowerCase());
    assert.ok(!para.includes(anonimo), "nada para o endereço anônimo");
    assert.equal(para.filter((p) => p === saiu).length, 1, "só a campanha da outra Casa chegou");
    assert.equal(para.filter((p) => p === ficou).length, 1, "a campanha sem Casa não saiu");
  } finally {
    await prisma.notification.deleteMany({ where: { id: { in: Object.values(linhas).map((n) => n.id) } } });
    await prisma.marketingOptOut.deleteMany({ where: { organizationId: casa } });
  }
});

test("carrinho abandonado e resgate: pedido de conta excluída não recebe e sai da varredura", async () => {
  const fx = await createFixtureEvent({ lotCapacity: 10, priceCents: 5000, feeCents: 0 });
  const anonimo = emailAnonimoDaConta(randomUUID());
  const pedido = async (dados: { status: "PAYMENT_PENDING" | "EXPIRED"; createdAt: Date; expiresAt: Date }) => {
    const reserva = await prisma.reservation.create({
      data: { eventId: fx.event.id, status: "CONVERTED", expiresAt: dados.createdAt },
    });
    return prisma.order.create({
      data: {
        eventId: fx.event.id,
        reservationId: reserva.id,
        contactEmail: anonimo,
        status: dados.status,
        totalCents: 5000,
        createdAt: dados.createdAt,
        expiresAt: dados.expiresAt,
        items: { create: [{ ticketLotId: fx.lot.id, quantity: 1, priceCents: 5000, feeCents: 0 }] },
      },
    });
  };
  try {
    // pendente há 20 min com o Pix ainda valendo (lembrete) e expirado há 2 h (resgate)
    const pendente = await pedido({
      status: "PAYMENT_PENDING",
      createdAt: new Date(Date.now() - 20 * 60_000),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const expirado = await pedido({
      status: "EXPIRED",
      createdAt: new Date(Date.now() - 150 * 60_000),
      expiresAt: new Date(Date.now() - 120 * 60_000),
    });

    await sendAbandonedCartReminders();
    await sendExpiredRescueEmails();

    assert.ok(!enviados.some((m) => m.to.trim().toLowerCase() === anonimo), "nada para o endereço anônimo");
    const salvoPendente = await prisma.order.findUniqueOrThrow({ where: { id: pendente.id } });
    assert.ok(salvoPendente.abandonedReminderSentAt, "marcado como tratado: não reavalia a cada varredura");
    const salvoExpirado = await prisma.order.findUniqueOrThrow({ where: { id: expirado.id } });
    assert.ok(salvoExpirado.rescueReminderSentAt);
  } finally {
    await cleanupFixtureEvent(fx.organization.id);
  }
});

test("worker: rodar de novo não reenvia nem reabre o que foi barrado", async () => {
  const anonimo = emailAnonimoDaConta(randomUUID());
  const n = await criarPendente({ recipient: anonimo, template: "cpf_defined", payload: { cpfMasked: "***", name: "x" } });
  try {
    await deliverPendingNotifications();
    await deliverPendingNotifications();
    const linha = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(linha.status, "FAILED");
    assert.equal(linha.attempts, 1, "FAILED sai da fila: a 2ª rodada nem pega");
    assert.ok(!enviados.some((m) => m.to.trim().toLowerCase() === anonimo));
  } finally {
    await prisma.notification.delete({ where: { id: n.id } });
  }
});
