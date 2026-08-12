import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { FinanceService } from "../finance/finance.service";
import { OrgAccessService } from "../common/org-access.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

const finance = new FinanceService(new OrgAccessService());

type Fixture = Awaited<ReturnType<typeof createFixtureEvent>>;

async function membro(fixture: Fixture) {
  const user = await prisma.user.create({
    data: { email: `saque-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
  });
  await prisma.organizationMember.create({
    data: {
      organizationId: fixture.organization.id,
      userId: user.id,
      roleId: fixture.ownerRoleId,
      status: "ACTIVE",
    },
  });
  return user;
}

async function contaBancaria(organizationId: string) {
  return prisma.bankAccount.create({
    data: {
      organizationId,
      holderName: "Casa",
      holderDocument: "12345678000190",
      bankCode: "000",
      agency: "1",
      account: `${Math.floor(Math.random() * 1e6)}`,
      accountType: "corrente",
      pixKey: `${Math.random().toString(36).slice(2, 8)}@pix.dev`,
      isDefault: true,
      // trocada há 72h: já passou da quarentena de 48h
      pixKeyUpdatedAt: new Date(Date.now() - 72 * 3_600_000),
    },
  });
}

async function lancar(organizationId: string, amountCents: number, type: string) {
  const account = await prisma.ledgerAccount.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId },
  });
  await prisma.ledgerEntry.create({
    data: {
      ledgerAccountId: account.id,
      type: type as never,
      amountCents,
      referenceType: "order",
      referenceId: `t-${Math.random().toString(36).slice(2, 10)}`,
      availableAt: new Date(Date.now() - 1000), // maduro
    },
  });
}

async function limpar(fixture: Fixture) {
  await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organization.id } });
  await prisma.payoutRequest.deleteMany({ where: { organizationId: fixture.organization.id } });
  await prisma.payout.deleteMany({ where: { organizationId: fixture.organization.id } });
  await prisma.bankAccount.deleteMany({ where: { organizationId: fixture.organization.id } });
  await cleanupFixtureEvent(fixture.organization.id);
}

/**
 * Buraco de dinheiro (auditoria 2026-08-12): a aprovação criava o Payout com o
 * valor de QUANDO o saque foi pedido, sem rechecar o saldo de agora. Se o
 * disponível cai na janela até a aprovação (estorno/chargeback debita o
 * ledger), a casa recebia um Pix acima do saldo e o caixa ficava negativo.
 */
test("aprovar recusa quando o saldo caiu desde o pedido (estorno na janela de análise)", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  try {
    const user = await membro(f);
    await contaBancaria(f.organization.id);
    await lancar(f.organization.id, 30_000, "SALE_CREDIT"); // liberado

    // 1º saque da casa → cai em análise, NENHUM payout nasce ainda
    const req = await finance.requestPayout(f.organization.id, user.id, 20_000);
    assert.equal(req.needsApproval, true, "1º saque passa pela análise");
    assert.equal(req.payoutId, null, "sem payout antes da aprovação");

    // estorno/chargeback entre o pedido e a aprovação: disponível cai para 5k
    await lancar(f.organization.id, -25_000, "REFUND_DEBIT");

    // aprovar agora tem que RECUSAR — 20k não cabe em 5k
    await assert.rejects(
      () => finance.approveRequestInternal(req.id, "admin-teste"),
      /Saldo insuficiente para aprovar/,
    );

    // e o mais importante: nenhum Pix foi disparado — nada de payout
    const payouts = await prisma.payout.count({ where: { organizationId: f.organization.id } });
    assert.equal(payouts, 0, "recusa não pode criar repasse acima do saldo");

    // a solicitação segue PENDING para o backoffice recusar/reprocessar
    const depois = await prisma.payoutRequest.findUniqueOrThrow({ where: { id: req.id } });
    assert.equal(depois.status, "PENDING", "solicitação intacta para o backoffice decidir");
  } finally {
    await limpar(f);
  }
});

/** Guarda de regressão: com saldo suficiente, a aprovação continua criando o Payout normalmente. */
test("aprovar cria o payout normalmente quando o saldo ainda cobre o pedido", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  try {
    const user = await membro(f);
    await contaBancaria(f.organization.id);
    await lancar(f.organization.id, 30_000, "SALE_CREDIT");

    const req = await finance.requestPayout(f.organization.id, user.id, 20_000);
    assert.equal(req.needsApproval, true, "1º saque passa pela análise");

    const payoutId = await finance.approveRequestInternal(req.id, "admin-teste");
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    assert.equal(payout.amountCents, 20_000, "paga exatamente o pedido coberto pelo saldo");

    const depois = await prisma.payoutRequest.findUniqueOrThrow({ where: { id: req.id } });
    assert.equal(depois.status, "APPROVED", "solicitação aprovada");
    assert.equal(depois.payoutId, payoutId, "solicitação aponta para o payout criado");
  } finally {
    await limpar(f);
  }
});
