import { prisma } from "@borafest/database";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "auto-payouts" });

function minPayoutCents(): number {
  return Number(process.env.AUTO_PAYOUT_MIN_CENTS ?? 5000); // R$ 50 por padrão
}

function anticipationBpsMonthly(): number {
  return Number(process.env.ANTICIPATION_FEE_BPS_MONTHLY ?? 125);
}

/**
 * Varredura do repasse automático (decisão 2026-07-28, "pagamento automático
 * com segurança por datas de reembolso"):
 *
 * - STANDARD: cria Payout do saldo que JÁ passou da janela de reembolso
 *   (availableAt <= agora), descontando repasses pendentes/pagos.
 * - INSTANT (casas de confiança): cria Payout do saldo inteiro e lança a
 *   ANTICIPATION_FEE pró-rata da parcela ainda em janela.
 *
 * O Payout nasce PENDING: a transferência bancária é executada pelo
 * backoffice ("Marcar como pago" — automação via API do Asaas quando a conta
 * existir). Exige KYC ACTIVE e conta bancária padrão cadastrada.
 */
export async function sweepAutoPayouts(): Promise<void> {
  const orgs = await prisma.organization.findMany({
    where: { autoPayout: true, status: "ACTIVE" },
    select: { id: true, name: true, settlementMode: true },
  });

  for (const org of orgs) {
    try {
      await sweepOrganization(org);
    } catch (error) {
      log.error({ organizationId: org.id, err: error }, "falha no repasse automático");
    }
  }
}

async function sweepOrganization(org: {
  id: string;
  name: string;
  settlementMode: "STANDARD" | "INSTANT";
}): Promise<void> {
  const bankAccount = await prisma.bankAccount.findFirst({
    where: { organizationId: org.id, isDefault: true },
  });
  if (!bankAccount) return; // sem conta cadastrada não há para onde repassar

  const ledgerAccount = await prisma.ledgerAccount.findUnique({
    where: { organizationId: org.id },
  });
  if (!ledgerAccount) return;

  const now = new Date();
  const [total, held, reserved] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: { ledgerAccountId: ledgerAccount.id },
      _sum: { amountCents: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { ledgerAccountId: ledgerAccount.id, availableAt: { gt: now }, amountCents: { gt: 0 } },
      _sum: { amountCents: true },
    }),
    prisma.payout.aggregate({
      where: { organizationId: org.id, status: { in: ["PENDING", "PAID"] } },
      _sum: { amountCents: true },
    }),
  ]);

  const balance = total._sum.amountCents ?? 0;
  const heldCents = held._sum.amountCents ?? 0;
  const reservedCents = reserved._sum.amountCents ?? 0;
  const available =
    org.settlementMode === "INSTANT"
      ? Math.max(balance - reservedCents, 0)
      : Math.max(balance - heldCents - reservedCents, 0);

  if (available < minPayoutCents()) return;

  // idempotência da varredura: transação garante payout + taxa juntos
  await prisma.$transaction(async (tx) => {
    const payout = await tx.payout.create({
      data: { organizationId: org.id, amountCents: available, status: "PENDING" },
    });

    let anticipationFeeCents = 0;
    if (org.settlementMode === "INSTANT") {
      const anticipated = Math.max(available - Math.max(balance - heldCents - reservedCents, 0), 0);
      if (anticipated > 0) {
        const heldEntries = await tx.ledgerEntry.findMany({
          where: {
            ledgerAccountId: ledgerAccount.id,
            availableAt: { gt: now },
            amountCents: { gt: 0 },
          },
          orderBy: { availableAt: "asc" },
          select: { amountCents: true, availableAt: true },
        });
        let restante = anticipated;
        for (const entry of heldEntries) {
          if (restante <= 0) break;
          const slice = Math.min(entry.amountCents, restante);
          const remainingDays = Math.max(
            1,
            Math.ceil((entry.availableAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
          );
          anticipationFeeCents += Math.ceil(
            (slice * anticipationBpsMonthly() * remainingDays) / (10000 * 30),
          );
          restante -= slice;
        }
        if (anticipationFeeCents > 0) {
          await tx.ledgerEntry.create({
            data: {
              ledgerAccountId: ledgerAccount.id,
              type: "ANTICIPATION_FEE",
              amountCents: -anticipationFeeCents,
              referenceType: "payout",
              referenceId: payout.id,
              description: "Antecipação (repasse automático instantâneo)",
            },
          });
        }
      }
    }

    await tx.auditLog.create({
      data: {
        organizationId: org.id,
        action: "worker.payout.auto_create",
        entityType: "payout",
        entityId: payout.id,
        metadata: {
          amountCents: available,
          settlementMode: org.settlementMode,
          anticipationFeeCents,
        },
      },
    });

    log.info(
      {
        organizationId: org.id,
        payoutId: payout.id,
        amountCents: available,
        anticipationFeeCents,
      },
      `repasse automático criado para ${org.name}`,
    );
  });
}
