import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import {
  RETENCAO_PADRAO_DIAS,
  corteDaRetencao,
  diasDeRetencaoDosWebhooks,
  limparCorpoDosWebhooksAntigos,
} from "../retencao-webhooks";

// FRENTE WORKER (LGPD, 2026-10-12) — retenção do corpo cru dos webhooks:
// webhook_deliveries.raw_body (nome, e-mail e CPF do pagador na Pagar.me) é
// esvaziado depois de WEBHOOK_RAW_RETENTION_DAYS dias (padrão 90). A linha e
// os demais campos ficam. As linhas do teste são do ano 2000 e a rodada usa um
// "agora" de 2000: nenhuma linha de verdade do banco de dev é tocada.

after(async () => {
  await prisma.$disconnect();
});

const rand = () => Math.random().toString(36).slice(2, 10);
const AGORA = new Date("2000-06-01T12:00:00.000Z"); // 90 dias antes: 2000-03-03 12:00
const CORPO = JSON.stringify({ id: "hook_1", data: { customer: { name: "Maria Souza", email: "maria@x.com", document: "52998224725" } } });

async function aviso(receivedAt: Date) {
  return prisma.webhookDelivery.create({
    data: {
      provider: "pagarme",
      eventType: "order.paid",
      externalEventId: `hook_${rand()}`,
      signatureValid: true,
      status: "PROCESSED",
      error: null,
      rawBody: CORPO,
      headers: { "content-type": "application/json" },
      receivedAt,
      processedAt: receivedAt,
    },
  });
}

function comEnv<T>(valor: string | undefined, fn: () => Promise<T>): Promise<T> {
  const antes = process.env.WEBHOOK_RAW_RETENTION_DAYS;
  if (valor === undefined) delete process.env.WEBHOOK_RAW_RETENTION_DAYS;
  else process.env.WEBHOOK_RAW_RETENTION_DAYS = valor;
  return fn().finally(() => {
    if (antes === undefined) delete process.env.WEBHOOK_RAW_RETENTION_DAYS;
    else process.env.WEBHOOK_RAW_RETENTION_DAYS = antes;
  });
}

test("regra: dias de retenção — padrão 90, inteiro a partir de 1, inválido é erro (nunca vira padrão calado)", () => {
  assert.equal(RETENCAO_PADRAO_DIAS, 90);
  assert.equal(diasDeRetencaoDosWebhooks(undefined), 90);
  assert.equal(diasDeRetencaoDosWebhooks(""), 90);
  assert.equal(diasDeRetencaoDosWebhooks("   "), 90);
  assert.equal(diasDeRetencaoDosWebhooks("30"), 30);
  assert.equal(diasDeRetencaoDosWebhooks(" 365 "), 365);
  assert.equal(diasDeRetencaoDosWebhooks("1"), 1);
  for (const invalido of ["0", "-5", "abc", "1.5", "90d", "1e3", "NaN"]) {
    assert.throws(() => diasDeRetencaoDosWebhooks(invalido), /WEBHOOK_RAW_RETENTION_DAYS inválido/, invalido);
  }
});

test("regra: corte = agora menos os dias", () => {
  assert.equal(corteDaRetencao(AGORA, 90).toISOString(), "2000-03-03T12:00:00.000Z");
  assert.equal(corteDaRetencao(AGORA, 1).toISOString(), "2000-05-31T12:00:00.000Z");
});

test("retenção: esvazia só o corpo dos avisos antigos; a linha e o resto ficam", async () => {
  const velho = await aviso(new Date("2000-01-01T00:00:00.000Z"));
  const novo = await aviso(new Date("2000-05-20T00:00:00.000Z"));
  try {
    const limpos = await comEnv(undefined, () => limparCorpoDosWebhooksAntigos(AGORA));
    assert.ok(limpos >= 1);

    const v = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: velho.id } });
    assert.equal(v.rawBody, "", "corpo cru apagado");
    assert.equal(v.provider, "pagarme");
    assert.equal(v.eventType, "order.paid");
    assert.equal(v.externalEventId, velho.externalEventId);
    assert.equal(v.signatureValid, true);
    assert.equal(v.status, "PROCESSED");
    assert.deepEqual(v.headers, { "content-type": "application/json" });
    assert.equal(v.receivedAt.toISOString(), velho.receivedAt.toISOString());
    assert.equal(v.processedAt?.toISOString(), velho.processedAt?.toISOString());

    const n = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: novo.id } });
    assert.equal(n.rawBody, CORPO, "dentro da retenção: intacto");

    // de novo: nada a fazer (o já apagado não conta outra vez)
    assert.equal(await comEnv(undefined, () => limparCorpoDosWebhooksAntigos(AGORA)), 0);
  } finally {
    await prisma.webhookDelivery.deleteMany({ where: { id: { in: [velho.id, novo.id] } } });
  }
});

test("retenção: respeita WEBHOOK_RAW_RETENTION_DAYS e, se inválido, falha sem apagar nada", async () => {
  const velho = await aviso(new Date("2000-01-01T00:00:00.000Z"));
  try {
    // 200 dias antes de 2000-06-01 = 1999-11-14: o aviso de janeiro ainda vale
    assert.equal(await comEnv("200", () => limparCorpoDosWebhooksAntigos(AGORA)), 0);
    assert.equal((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: velho.id } })).rawBody, CORPO);

    await assert.rejects(
      comEnv("0", () => limparCorpoDosWebhooksAntigos(AGORA)),
      /WEBHOOK_RAW_RETENTION_DAYS inválido/,
    );
    assert.equal(
      (await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: velho.id } })).rawBody,
      CORPO,
      "configuração inválida: nada apagado",
    );

    // 30 dias: agora sim
    assert.ok((await comEnv("30", () => limparCorpoDosWebhooksAntigos(AGORA))) >= 1);
    assert.equal((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: velho.id } })).rawBody, "");
  } finally {
    await prisma.webhookDelivery.deleteMany({ where: { id: velho.id } });
  }
});
