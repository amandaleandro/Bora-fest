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
/**
 * Executa/concilia as transferências dos repasses automáticos.
 *
 * Anti-duplicidade FAIL-CLOSED (é dinheiro saindo): uma vez que o provedor
 * devolve um id, ele fica gravado e NUNCA se cria outra transferência para o
 * mesmo payout — só se concilia o status. Se a chamada falhar sem sabermos se
 * a transferência foi criada (erro de rede), o payout vai para FAILED com
 * pedido de verificação manual em vez de arriscar pagar duas vezes.
 */

/**
 * Repasse concluído = dinheiro FORA da conta: lança PAYOUT_DEBIT no caixa da
 * organização (idempotente por payoutId). Sem isso o saldo nunca caía e a
 * mesma quantia podia ser sacada de novo — descoberto ao corrigir a dupla
 * contagem de reservado (auditoria 2026-08-10).
 */
async function debitPayoutOnce(payoutId: string, organizationId: string, amountCents: number) {
  const account = await prisma.ledgerAccount.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId },
  });
  const existente = await prisma.ledgerEntry.findFirst({
    where: { ledgerAccountId: account.id, type: "PAYOUT_DEBIT", referenceId: payoutId },
  });
  if (existente) return;
  await prisma.ledgerEntry.create({
    data: {
      ledgerAccountId: account.id,
      type: "PAYOUT_DEBIT",
      amountCents: -amountCents,
      referenceType: "payout",
      referenceId: payoutId,
      description: "Repasse enviado por Pix",
    },
  });
}

export async function executeAutoTransfers(): Promise<void> {
  if (!autoTransferEnabled()) return;
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
        await debitPayoutOnce(payout.id, payout.organizationId, payout.amountCents);
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

  // 2) dispara as novas — payout só nasce de clique/aprovação (molde v2),
  // então todo PENDING sem transferência é para pagar
  const pendentes = await prisma.payout.findMany({
    where: { status: "PENDING", externalId: null },
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
      if (result.status === "DONE") {
        await debitPayoutOnce(payout.id, payout.organizationId, payout.amountCents);
      }
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

