import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { sweepAutoPayouts } from "../auto-payouts";
import {
  createFixtureEvent,
  cleanupFixtureEvent,
} from "../../../api/src/__tests__/helpers";

after(async () => {
  await closeRedisConnection();
});

async function creditarVenda(organizationId: string, amountCents: number) {
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
      referenceId: `teste-${Math.random().toString(36).slice(2, 10)}`,
      availableAt: new Date(Date.now() - 1000), // já maduro
      description: "venda teste",
    },
  });
}

test("repasse 100% automático: saldo → payout → Pix sai sozinho (mock) e fica PAID", async () => {
  process.env.AUTO_TRANSFER_ENABLED = "true";
  process.env.PAYMENTS_PROVIDER = "mock";
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  try {
    await prisma.organization.update({
      where: { id: fixture.organization.id },
      data: { autoPayout: true, settlementMode: "INSTANT" },
    });
    await prisma.bankAccount.create({
      data: {
        organizationId: fixture.organization.id,
        holderName: "Casa Teste",
        holderDocument: "12345678000190",
        bankCode: "000",
        agency: "1",
        account: "1",
        accountType: "corrente",
        pixKey: "casa@teste.dev",
        isDefault: true,
      },
    });
    await creditarVenda(fixture.organization.id, 20_000); // R$ 200 > mínimo global

    await sweepAutoPayouts();

    const payout = await prisma.payout.findFirst({
      where: { organizationId: fixture.organization.id },
    });
    assert.ok(payout, "payout deve nascer da varredura");
    assert.equal(payout!.status, "PAID", "com transferência automática, conclui sozinho");
    assert.ok(payout!.externalId?.startsWith("mock_transfer_"), "id do provedor gravado");
    assert.ok(payout!.paidAt, "paidAt preenchido");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "payout.auto_transfer", entityId: payout!.id },
    });
    assert.ok(audit, "trilha de auditoria da transferência");
  } finally {
    delete process.env.AUTO_TRANSFER_ENABLED;
    await prisma.payout.deleteMany({ where: { organizationId: fixture.organization.id } });
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("mínimo POR CASA segura repasse pequeno (contrato de casa grande)", async () => {
  process.env.AUTO_TRANSFER_ENABLED = "true";
  process.env.PAYMENTS_PROVIDER = "mock";
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 1000, feeCents: 0 });
  try {
    await prisma.organization.update({
      where: { id: fixture.organization.id },
      data: { autoPayout: true, settlementMode: "INSTANT", autoPayoutMinCents: 50_000 },
    });
    await prisma.bankAccount.create({
      data: {
        organizationId: fixture.organization.id,
        holderName: "Casa Grande",
        holderDocument: "12345678000190",
        bankCode: "000",
        agency: "1",
        account: "2",
        accountType: "corrente",
        pixKey: "grande@teste.dev",
        isDefault: true,
      },
    });
    await creditarVenda(fixture.organization.id, 30_000); // R$ 300 < mínimo da casa (R$ 500)

    await sweepAutoPayouts();
    const nenhum = await prisma.payout.findFirst({
      where: { organizationId: fixture.organization.id },
    });
    assert.equal(nenhum, null, "abaixo do mínimo da casa, não gera repasse");

    // vendeu mais e passou do mínimo → agora sai
    await creditarVenda(fixture.organization.id, 25_000);
    await sweepAutoPayouts();
    const payout = await prisma.payout.findFirst({
      where: { organizationId: fixture.organization.id },
    });
    assert.ok(payout, "acima do mínimo da casa, repasse sai");
    assert.equal(payout!.amountCents, 55_000);
    assert.equal(payout!.status, "PAID");
  } finally {
    delete process.env.AUTO_TRANSFER_ENABLED;
    await prisma.payout.deleteMany({ where: { organizationId: fixture.organization.id } });
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
