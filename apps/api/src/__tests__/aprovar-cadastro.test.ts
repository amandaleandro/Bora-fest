import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { AdminService } from "../admin/admin.service";
import { PlatformAccessService } from "../common/platform-access.service";
import { NotificationsService } from "../notifications/notifications.service";
import { FinanceService } from "../finance/finance.service";
import { OrgAccessService } from "../common/org-access.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

function novoAdminService() {
  const orgAccess = new OrgAccessService();
  return new AdminService(
    new PlatformAccessService(),
    new NotificationsService(),
    new FinanceService(orgAccess),
  );
}

/**
 * Buraco achado em 2026-08-11 olhando o backoffice em produção: TODA
 * organização nasce PENDING_VERIFICATION e nada promovia para ACTIVE — o
 * "desbloquear" só aparecia para quem estava BLOCKED. A casa vendia, o
 * dinheiro entrava e o saque ficava travado para sempre, sem botão que
 * resolvesse.
 */
test("aprovar cadastro sai de PENDING_VERIFICATION e destrava o repasse", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5 });
  const admin = novoAdminService();
  try {
    // volta a organização ao estado real de quem acabou de se cadastrar
    await prisma.organization.update({
      where: { id: f.organization.id },
      data: { status: "PENDING_VERIFICATION" },
    });
    const dono = await prisma.user.create({
      data: { email: `dono-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });
    const staff = await prisma.user.create({
      data: {
        email: `staff-${Math.random().toString(36).slice(2, 8)}@borafest.dev`,
        platformRole: "ADMIN",
      },
    });
    await prisma.organizationMember.create({
      data: {
        organizationId: f.organization.id,
        userId: dono.id,
        roleId: f.ownerRoleId,
        status: "ACTIVE",
      },
    });

    // ANTES: repasse recusado, com a mensagem que o Arthur viu na tela
    await assert.rejects(
      () => admin.createPayout(f.organization.id, staff.id),
      /KYC aprovado/,
      "pendente tem que barrar o repasse",
    );

    await admin.approveOrganization(f.organization.id, staff.id);

    const depois = await prisma.organization.findUniqueOrThrow({
      where: { id: f.organization.id },
    });
    assert.equal(depois.status, "ACTIVE", "cadastro aprovado vira ACTIVE");

    // DEPOIS: o bloqueio por cadastro sumiu — o que barra agora é só saldo
    await assert.rejects(
      () => admin.createPayout(f.organization.id, staff.id),
      /Sem saldo disponível/,
      "aprovado só esbarra em saldo, não mais em cadastro",
    );

    const log = await prisma.auditLog.findFirst({
      where: { organizationId: f.organization.id, action: "admin.organization.approve" },
    });
    assert.ok(log, "aprovação fica na auditoria");
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: f.organization.id } });
    await cleanupFixtureEvent(f.organization.id);
  }
});

test("aprovar NUNCA passa por cima de organização bloqueada", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5 });
  const admin = novoAdminService();
  try {
    await prisma.organization.update({
      where: { id: f.organization.id },
      data: { status: "BLOCKED" },
    });
    const staff = await prisma.user.create({
      data: {
        email: `staff-${Math.random().toString(36).slice(2, 8)}@borafest.dev`,
        platformRole: "ADMIN",
      },
    });

    await assert.rejects(
      () => admin.approveOrganization(f.organization.id, staff.id),
      /bloqueada/,
      "aprovar não pode ser um desbloqueio disfarçado",
    );

    const depois = await prisma.organization.findUniqueOrThrow({
      where: { id: f.organization.id },
    });
    assert.equal(depois.status, "BLOCKED", "bloqueio preservado");
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: f.organization.id } });
    await cleanupFixtureEvent(f.organization.id);
  }
});

test("quem não é staff da plataforma não aprova cadastro", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5 });
  const admin = novoAdminService();
  try {
    await prisma.organization.update({
      where: { id: f.organization.id },
      data: { status: "PENDING_VERIFICATION" },
    });
    const qualquer = await prisma.user.create({
      data: { email: `ze-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });

    await assert.rejects(() => admin.approveOrganization(f.organization.id, qualquer.id));

    const depois = await prisma.organization.findUniqueOrThrow({
      where: { id: f.organization.id },
    });
    assert.equal(depois.status, "PENDING_VERIFICATION", "status intocado");
  } finally {
    await cleanupFixtureEvent(f.organization.id);
  }
});
