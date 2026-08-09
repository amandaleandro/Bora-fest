import { prisma } from "@borafest/database";
import { getDefaultGateway } from "@borafest/payments";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "auto-payouts" });

function defaultMinPayoutCents(): number {
  return Number(process.env.AUTO_PAYOUT_MIN_CENTS ?? 5000); // R$ 50 por padrão
}

/** Chave-geral do Pix de saída automático — Arthur liga quando quiser estrear. */
function autoTransferEnabled(): boolean {
  return process.env.AUTO_TRANSFER_ENABLED === "true";
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
    select: { id: true, name: true, settlementMode: true, autoPayoutMinCents: true },
  });

  for (const org of orgs) {
    try {
      await sweepOrganization(org);
    } catch (error) {
      log.error({ organizationId: org.id, err: error }, "falha no repasse automático");
    }
  }

  // última milha: o dinheiro sai sozinho (Pix via provedor) quando habilitado
  if (autoTransferEnabled()) {
    await executeAutoTransfers();
  }
}

/**
 * Executa/concilia as transferências dos repasses automáticos.
 *
 * Anti-duplicidade FAIL-CLOSED (é dinheiro saindo): uma vez que o provedor
 * devolve um id, ele fica gravado e NUNCA se cria outra transferência para o
 * mesmo payout — só se concilia o status. Se a chamada falhar sem sabermos se
 * a transferência foi criada (erro de rede), o payout vai para FAILED com
 * pedido de verificação manual em vez de arriscar pagar duas vezes.
 */
export async function executeAutoTransfers(): Promise<void> {
  const gateway = getDefaultGateway();
  if (!gateway.transferPix || !gateway.getTransferStatus) return;

  // 1) concilia as que já foram criadas e ainda não concluíram
  const emAndamento = await prisma.payout.findMany({
    where: { status: "PENDING", externalId: { not: null } },
    take: 50,
  });
  for (const payout of emAndamento) {
    try {
      const status = await gateway.getTransferStatus(payout.externalId!);
      if (status.status === "DONE") {
        await prisma.payout.update({
          where: { id: payout.id },
          data: { status: "PAID", paidAt: new Date() },
        });
        log.info({ payoutId: payout.id }, "repasse concluído pelo provedor");
      } else if (status.status === "FAILED") {
        await prisma.payout.update({
          where: { id: payout.id },
          data: { status: "FAILED", failReason: status.failReason ?? "transferência falhou no provedor" },
        });
        log.error({ payoutId: payout.id, failReason: status.failReason }, "repasse falhou no provedor");
      }
    } catch (error) {
      log.error({ payoutId: payout.id, err: error }, "falha ao conciliar transferência");
    }
  }

  // 2) dispara as novas (payout automático de org com autoPayout + chave Pix)
  const pendentes = await prisma.payout.findMany({
    where: { status: "PENDING", externalId: null, organization: { autoPayout: true } },
    include: { organization: { select: { id: true, name: true } } },
    take: 50,
  });
  for (const payout of pendentes) {
    const bankAccount = await prisma.bankAccount.findFirst({
      where: { organizationId: payout.organizationId, isDefault: true },
    });
    if (!bankAccount?.pixKey) {
      // sem chave Pix: fica para o backoffice pagar manualmente — sem drama
      continue;
    }
    try {
      const result = await gateway.transferPix({
        amountCents: payout.amountCents,
        pixKey: bankAccount.pixKey,
        description: `Repasse BoraFest — ${payout.organization.name}`,
        externalReference: payout.id,
      });
      await prisma.payout.update({
        where: { id: payout.id },
        data:
          result.status === "DONE"
            ? { status: "PAID", paidAt: new Date(), externalId: result.externalId }
            : result.status === "FAILED"
              ? { status: "FAILED", externalId: result.externalId, failReason: result.failReason ?? "transferência recusada" }
              : { externalId: result.externalId }, // PENDING: concilia na próxima varredura
      });
      await prisma.auditLog.create({
        data: {
          action: "payout.auto_transfer",
          entityType: "payout",
          entityId: payout.id,
          metadata: {
            provider: gateway.provider,
            externalId: result.externalId,
            status: result.status,
            amountCents: payout.amountCents,
          },
        },
      });
      log.info(
        { payoutId: payout.id, externalId: result.externalId, status: result.status },
        "transferência de repasse disparada",
      );
    } catch (error) {
      // não sabemos se o provedor criou a transferência — NUNCA repetir sozinho
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: "FAILED",
          failReason:
            "Falha na comunicação com o provedor — confira no extrato antes de pagar manualmente (risco de duplicidade)",
        },
      });
      log.error({ payoutId: payout.id, err: error }, "transferência com resultado desconhecido — fail closed");
    }
  }
}

async function sweepOrganization(org: {
  id: string;
  name: string;
  settlementMode: "STANDARD" | "INSTANT";
  autoPayoutMinCents: number | null;
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

  // mínimo POR CASA (contrato) com fallback no padrão da plataforma
  if (available < (org.autoPayoutMinCents ?? defaultMinPayoutCents())) return;

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
