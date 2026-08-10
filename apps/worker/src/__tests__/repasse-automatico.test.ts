import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { executeAutoTransfers } from "../auto-payouts";
import { FinanceService } from "../../../api/src/finance/finance.service";
import { OrgAccessService } from "../../../api/src/common/org-access.service";
import {
  createFixtureEvent,
  cleanupFixtureEvent,
} from "../../../api/src/__tests__/helpers";

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

async function contaBancaria(organizationId: string, horasDesdeTroca = 72) {
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
      pixKeyUpdatedAt: new Date(Date.now() - horasDesdeTroca * 3_600_000),
    },
  });
}

async function creditar(organizationId: string, amountCents: number, maduro = true) {
  const account = await prisma.ledgerAccount.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId },
  });
  await prisma.ledgerEntry.create({
    data: {
      ledgerAccountId: account.id,
      type: "SALE_CREDIT",
      amountCents,
      referenceType: "order",
      referenceId: `t-${Math.random().toString(36).slice(2, 10)}`,
      availableAt: maduro
        ? new Date(Date.now() - 1000)
        : new Date(Date.now() + 5 * 24 * 3_600_000),
    },
  });
}

/** casa já verificada: um payout PAID histórico pula a regra do 1º saque */
async function jaVerificada(organizationId: string) {
  await prisma.payout.create({
    data: { organizationId, amountCents: 1, status: "PAID", paidAt: new Date() },
  });
}

async function limpar(fixture: Fixture) {
  await prisma.payoutRequest.deleteMany({ where: { organizationId: fixture.organization.id } });
  await prisma.payout.deleteMany({ where: { organizationId: fixture.organization.id } });
  await cleanupFixtureEvent(fixture.organization.id);
}

test("casa de confiança: clique → Pix na hora (payout direto, worker paga)", async () => {
  process.env.AUTO_TRANSFER_ENABLED = "true";
  process.env.PAYMENTS_PROVIDER = "mock";
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  try {
    await prisma.organization.update({
      where: { id: f.organization.id },
      data: { settlementMode: "INSTANT" },
    });
    const user = await membro(f);
    await contaBancaria(f.organization.id);
    await creditar(f.organization.id, 30_000, false); // em janela — INSTANT saca mesmo assim
    await jaVerificada(f.organization.id);

    const req = await finance.requestPayout(f.organization.id, user.id, 20_000);
    assert.equal(req.needsApproval, false, "confiança sob o teto não espera ninguém");
    assert.ok(req.payoutId, "payout nasce direto do clique");
    assert.ok(req.anticipationFeeCents > 0, "parcela em janela paga antecipação");

    await executeAutoTransfers();
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: req.payoutId! } });
    assert.equal(payout.status, "PAID");
    assert.ok(payout.externalId?.startsWith("mock_transfer_"));
  } finally {
    delete process.env.AUTO_TRANSFER_ENABLED;
    await limpar(f);
  }
});

test("teto do contrato: acima dele o pedido cai para análise", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  try {
    await prisma.organization.update({
      where: { id: f.organization.id },
      data: { settlementMode: "INSTANT", instantMaxPerWithdrawalCents: 10_000 },
    });
    const user = await membro(f);
    await contaBancaria(f.organization.id);
    await creditar(f.organization.id, 50_000);
    await jaVerificada(f.organization.id);

    const req = await finance.requestPayout(f.organization.id, user.id, 20_000);
    assert.equal(req.needsApproval, true, "acima do teto contratual = análise");
    assert.equal(req.payoutId, null);

    // backoffice aprova → payout nasce
    const payoutId = await finance.approveRequestInternal(req.id, "admin-teste");
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    assert.equal(payout.amountCents, 20_000);
  } finally {
    await limpar(f);
  }
});

test("regras comuns: 1º saque com análise, 1 por dia, quarentena de chave", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  try {
    const user = await membro(f);
    await contaBancaria(f.organization.id);
    await creditar(f.organization.id, 30_000);

    // 1º saque da casa → análise mesmo com saldo liberado
    const primeiro = await finance.requestPayout(f.organization.id, user.id, 10_000);
    assert.equal(primeiro.needsApproval, true, "1º saque sempre passa pelo backoffice");

    // 1 por dia: segunda solicitação hoje é barrada
    await assert.rejects(
      () => finance.requestPayout(f.organization.id, user.id, 5_000),
      /1 saque por dia|em andamento/,
    );
  } finally {
    await limpar(f);
  }
});

test("quarentena: trocou a chave Pix há pouco, saque espera 48h", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  try {
    const user = await membro(f);
    await contaBancaria(f.organization.id, 2); // trocada há 2h
    await creditar(f.organization.id, 30_000);
    await assert.rejects(
      () => finance.requestPayout(f.organization.id, user.id, 10_000),
      /liberam em \d+h/,
    );
  } finally {
    await limpar(f);
  }
});

test("antecipação (padrão): pede acima do liberado com taxa e vai para análise", async () => {
  const f = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  try {
    const user = await membro(f);
    await contaBancaria(f.organization.id);
    await creditar(f.organization.id, 10_000, true);   // liberado
    await creditar(f.organization.id, 40_000, false);  // em janela (pré-evento)
    await jaVerificada(f.organization.id);

    // sem antecipação: acima do liberado é barrado
    await assert.rejects(
      () => finance.requestPayout(f.organization.id, user.id, 30_000),
      /acima do saldo/,
    );

    // com antecipação: passa, calcula taxa e exige análise
    const req = await finance.requestPayout(f.organization.id, user.id, 30_000, true);
    assert.equal(req.needsApproval, true, "antecipação sempre passa por análise");
    assert.ok(req.anticipationFeeCents > 0, "antecipação tem taxa");

    const payoutId = await finance.approveRequestInternal(req.id, "admin-teste");
    const account = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { organizationId: f.organization.id },
    });
    const fee = await prisma.ledgerEntry.findFirst({
      where: {
        ledgerAccountId: account.id,
        type: "ANTICIPATION_FEE",
        referenceId: payoutId,
      },
    });
    assert.ok(fee, "taxa lançada no caixa na aprovação");
    assert.equal(fee!.amountCents, -req.anticipationFeeCents);
  } finally {
    await limpar(f);
  }
});
