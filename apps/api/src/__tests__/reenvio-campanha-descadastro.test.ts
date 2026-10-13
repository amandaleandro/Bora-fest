import { after, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import {
  AdminService,
  REENVIO_RECUSADO_DESCADASTRO,
  REENVIO_RECUSADO_SEM_LINK,
} from "../admin/admin.service";
import { PlatformAccessService } from "../common/platform-access.service";
import { NotificationsService } from "../notifications/notifications.service";
import { FinanceService } from "../finance/finance.service";
import { OrgAccessService } from "../common/org-access.service";
import { chaveDoEmail } from "../descadastro/descadastro-token";
import { registrarDescadastroDeCampanha } from "../descadastro/supressao";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

// FRENTE SERVIDOR (2026-10-12): o "Reenfileirar" do backoffice desfazia o
// descadastro — o e-mail de campanha que o descadastro tirou da fila voltava a
// sair para quem pediu para não receber. Agora recusa com mensagem clara, e
// também recusa campanha gravada antes do link "Não quero mais receber".

after(async () => {
  await closeRedisConnection();
});

const rand = () => Math.random().toString(36).slice(2, 10);

async function montar() {
  const fx = await createFixtureEvent({ lotCapacity: 5 });
  const staff = await prisma.user.create({
    data: { email: `staff-campanha-${rand()}@borafest.dev`, platformRole: "ADMIN" },
  });
  const admin = new AdminService(
    new PlatformAccessService(),
    new NotificationsService(),
    new FinanceService(new OrgAccessService()),
  );
  return { fx, staff, admin, linhas: [] as string[] };
}

type Ctx = Awaited<ReturnType<typeof montar>>;

async function desmontar(ctx: Ctx) {
  await prisma.auditLog.deleteMany({ where: { entityType: "notification", entityId: { in: ctx.linhas } } });
  await prisma.notification.deleteMany({ where: { id: { in: ctx.linhas } } });
  await prisma.marketingOptOut.deleteMany({ where: { organizationId: ctx.fx.organization.id } });
  await cleanupFixtureEvent(ctx.fx.organization.id);
  await prisma.user.delete({ where: { id: ctx.staff.id } }).catch(() => undefined);
}

/** Linha de campanha que falhou na entrega (como o worker deixa). */
async function campanhaQueFalhou(ctx: Ctx, recipient: string, comLink = true) {
  const linha = await prisma.notification.create({
    data: {
      channel: "EMAIL",
      recipient,
      template: "crm_reactivation",
      status: "FAILED",
      attempts: 5,
      error: "timeout do provedor",
      payload: {
        campaignId: `crm-${rand()}`,
        organizationId: ctx.fx.organization.id,
        houseName: "Casa Teste",
        customerName: "Cliente",
        subject: "Volta pra festa",
        message: "Tem rolê novo.",
        ctaLabel: null,
        ctaUrl: null,
        ...(comLink
          ? {
              unsubscribeUrl: "https://borafest.com.br/descadastro/codigo-de-teste",
              unsubscribeOneClickUrl: "https://api.borafest.com.br/v1/public/descadastro/codigo-de-teste",
            }
          : {}),
      },
    },
  });
  ctx.linhas.push(linha.id);
  return linha;
}

test("reenfileirar campanha de quem saiu: recusa com mensagem clara e a linha fica parada", async () => {
  const ctx = await montar();
  try {
    const email = `Saiu.${rand()}@Example.com`;
    // saiu pela chave normalizada; a linha da fila guarda o e-mail com maiúsculas
    await prisma.marketingOptOut.create({
      data: { organizationId: ctx.fx.organization.id, emailKey: chaveDoEmail(email) },
    });
    const linha = await campanhaQueFalhou(ctx, email);

    await assert.rejects(
      () => ctx.admin.requeueNotification(linha.id, ctx.staff.id),
      (error: any) => error.status === 400 && error.message === REENVIO_RECUSADO_DESCADASTRO,
    );
    const depois = await prisma.notification.findUniqueOrThrow({ where: { id: linha.id } });
    assert.equal(depois.status, "FAILED", "não voltou para a fila");
    assert.equal(
      await prisma.auditLog.count({ where: { action: "admin.notification.requeue", entityId: linha.id } }),
      0,
      "recusa não registra reenvio",
    );
  } finally {
    await desmontar(ctx);
  }
});

test("o descadastro vale só para a Casa dele: campanha de quem não saiu reenfileira normalmente", async () => {
  const ctx = await montar();
  try {
    const fica = `fica-${rand()}@example.com`;
    const saiuDeOutraCasa = `outra-${rand()}@example.com`;
    // saiu das campanhas de OUTRA Casa: não vale para esta
    await registrarDescadastroDeCampanha("00000000-0000-4000-8000-000000000001", saiuDeOutraCasa);

    for (const email of [fica, saiuDeOutraCasa]) {
      const linha = await campanhaQueFalhou(ctx, email);
      const r = await ctx.admin.requeueNotification(linha.id, ctx.staff.id);
      assert.equal(r.requeued, true);
      const depois = await prisma.notification.findUniqueOrThrow({ where: { id: linha.id } });
      assert.equal(depois.status, "PENDING");
      assert.equal(depois.attempts, 0);
      assert.equal(
        await prisma.auditLog.count({ where: { action: "admin.notification.requeue", entityId: linha.id } }),
        1,
      );
    }

    // e quem sai DEPOIS do reenvio: o descadastro tira da fila (status FAILED)
    // e um novo "Reenfileirar" é recusado
    const linhaDoFica = ctx.linhas[0];
    await registrarDescadastroDeCampanha(ctx.fx.organization.id, fica);
    const tirada = await prisma.notification.findUniqueOrThrow({ where: { id: linhaDoFica } });
    assert.equal(tirada.status, "FAILED");
    await assert.rejects(
      () => ctx.admin.requeueNotification(linhaDoFica, ctx.staff.id),
      (error: any) => error.message === REENVIO_RECUSADO_DESCADASTRO,
    );
    assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: linhaDoFica } })).status, "FAILED");
  } finally {
    await prisma.marketingOptOut.deleteMany({ where: { organizationId: "00000000-0000-4000-8000-000000000001" } });
    await desmontar(ctx);
  }
});

test("campanha gravada sem o link de sair não é reenviada", async () => {
  const ctx = await montar();
  try {
    const linha = await campanhaQueFalhou(ctx, `antiga-${rand()}@example.com`, false);
    await assert.rejects(
      () => ctx.admin.requeueNotification(linha.id, ctx.staff.id),
      (error: any) => error.status === 400 && error.message === REENVIO_RECUSADO_SEM_LINK,
    );
    assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: linha.id } })).status, "FAILED");
  } finally {
    await desmontar(ctx);
  }
});
