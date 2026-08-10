import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import { createAutoPayoutsQueue } from "@borafest/queues";
import { OrgAccessService } from "../common/org-access.service";
import { computeAnticipationFeeCents, getPayoutAvailability } from "../common/ledger";

const QUARANTINE_HOURS = 48;

/**
 * Antecipação (plano padrão) libera no máximo 80% do saldo em janela — os
 * 20% retidos são o colchão de reembolso caso o evento dê problema (mesmo
 * teto da Sympla). Casas de confiança (INSTANT) não passam por aqui.
 */
function anticipationMaxBps(): number {
  return Number(process.env.ANTICIPATION_MAX_BPS ?? 8000);
}

function minWithdrawalCents(org: { autoPayoutMinCents: number | null }): number {
  return org.autoPayoutMinCents ?? Number(process.env.AUTO_PAYOUT_MIN_CENTS ?? 5000);
}

@Injectable()
export class FinanceService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async getBalance(organizationId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);

    const availability = await getPayoutAvailability(organizationId);
    return { organizationId, ...availability };
  }

  async listEntries(organizationId: string, actorUserId: string, limit = 50) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);

    const ledgerAccount = await prisma.ledgerAccount.findUnique({ where: { organizationId } });
    if (!ledgerAccount) return [];

    return prisma.ledgerEntry.findMany({
      where: { ledgerAccountId: ledgerAccount.id },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });
  }

  /** Somente leitura: criação/marcação de repasse continua exclusiva do backoffice (admin). */
  async listPayouts(organizationId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);

    return prisma.payout.findMany({
      where: { organizationId },
      orderBy: { requestedAt: "desc" },
      take: 100,
    });
  }
  /**
   * Solicitação de saque pelo produtor (handoff v2 §Financeiro).
   * Regra cravada: saldo liberado = D+2 do EVENTO e KYC aprovado
   * (Organization.status === ACTIVE). O admin aprova e cria o Payout.
   */
  /**
   * Saque v2 (molde aprovado 2026-08-09): o produtor clica, as regras decidem
   * o caminho.
   *
   * - PADRÃO: saca o saldo LIBERADO (D+2 úteis pós-evento). Antecipação
   *   (saldo em janela) só via `anticipation: true`, com taxa e análise.
   * - CONFIANÇA (INSTANT): saca tudo na hora, até o teto contratual por
   *   saque; acima do teto vai para análise.
   * - Comuns: 1 saque/dia, 1 em andamento, mínimo por casa, quarentena de
   *   48h após troca de chave Pix, 1º saque da casa sempre com análise.
   * - Caminho direto cria o Payout e ACORDA o worker — o Pix sai em
   *   segundos quando AUTO_TRANSFER_ENABLED=true.
   */
  async requestPayout(
    organizationId: string,
    userId: string,
    amountCents: number,
    anticipation = false,
  ) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.FINANCE_VIEW);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (org.status !== "ACTIVE") {
      throw new BadRequestException(
        "Saque disponível após a aprovação do seu cadastro — as vendas seguem normalmente",
      );
    }

    // --- regras comuns -----------------------------------------------------
    if (amountCents < minWithdrawalCents(org)) {
      throw new BadRequestException(
        `O saque mínimo é de R$ ${(minWithdrawalCents(org) / 100).toFixed(2).replace(".", ",")}`,
      );
    }

    const emAndamento = await prisma.payoutRequest.findFirst({
      where: { organizationId, status: "PENDING" },
    });
    const payoutAberto = await prisma.payout.findFirst({
      where: { organizationId, status: "PENDING" },
    });
    if (emAndamento || payoutAberto) {
      throw new BadRequestException(
        "Você já tem um saque em andamento — aguarde a conclusão para pedir outro",
      );
    }

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const sacouHoje = await prisma.payoutRequest.findFirst({
      where: { organizationId, createdAt: { gte: hoje }, status: { not: "REJECTED" } },
    });
    if (sacouHoje) {
      throw new BadRequestException("Limite de 1 saque por dia — tente novamente amanhã");
    }

    const bankAccount = await prisma.bankAccount.findFirst({
      where: { organizationId, isDefault: true },
    });
    if (!bankAccount) {
      throw new BadRequestException("Cadastre uma conta bancária antes de solicitar o saque");
    }
    if (bankAccount.pixKeyUpdatedAt) {
      const horasDesdeTroca =
        (Date.now() - bankAccount.pixKeyUpdatedAt.getTime()) / 3_600_000;
      if (horasDesdeTroca < QUARANTINE_HOURS) {
        const faltam = Math.ceil(QUARANTINE_HOURS - horasDesdeTroca);
        throw new BadRequestException(
          `Conta bancária alterada há pouco — por segurança, saques liberam em ${faltam}h`,
        );
      }
    }

    // --- saldo -------------------------------------------------------------
    const { availableForPayoutCents, heldCents, settlementMode } = await this.getBalance(
      organizationId,
      userId,
    );
    // antecipação (PADRÃO): liberado + até 80% do que está em janela — o
    // restante fica de colchão para reembolsos até o evento acontecer
    const tetoDePedido =
      anticipation && settlementMode === "STANDARD"
        ? availableForPayoutCents + Math.floor((heldCents * anticipationMaxBps()) / 10000)
        : availableForPayoutCents;
    if (amountCents > tetoDePedido) {
      throw new BadRequestException(
        anticipation
          ? "A antecipação libera até 80% do valor em janela — o restante fica de colchão para reembolsos"
          : "Valor acima do saldo disponível para saque",
      );
    }

    const anticipationFeeCents =
      settlementMode === "INSTANT" || anticipation
        ? await computeAnticipationFeeCents(organizationId, amountCents)
        : 0;

    // --- roteamento: direto (Pix já) ou análise do backoffice ---------------
    const primeiroSaque =
      (await prisma.payout.count({ where: { organizationId, status: "PAID" } })) === 0;
    const acimaDoTeto =
      settlementMode === "INSTANT" &&
      org.instantMaxPerWithdrawalCents !== null &&
      amountCents > org.instantMaxPerWithdrawalCents;
    const precisaAnalise = primeiroSaque || anticipation || acimaDoTeto;

    const request = await prisma.payoutRequest.create({
      data: {
        organizationId,
        amountCents,
        anticipation,
        anticipationFeeCents,
        bankAccountId: bankAccount.id,
        requestedBy: userId,
      },
    });

    let payoutId: string | null = null;
    if (!precisaAnalise) {
      payoutId = await this.approveRequestInternal(request.id, null);
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: userId,
        organizationId,
        action: "payout.request",
        entityType: "payout_request",
        entityId: request.id,
        metadata: {
          amountCents,
          settlementMode,
          anticipation,
          anticipationFeeCents,
          rota: precisaAnalise ? "analise" : "direto",
          motivoAnalise: primeiroSaque
            ? "primeiro_saque"
            : anticipation
              ? "antecipacao"
              : acimaDoTeto
                ? "acima_do_teto"
                : null,
        },
      },
    });

    return {
      ...request,
      anticipationFeeCents,
      needsApproval: precisaAnalise,
      payoutId,
    };
  }

  /**
   * Aprova a solicitação: cria o Payout, lança a taxa de antecipação (se
   * houver) e acorda o worker para o Pix sair. Usado pelo caminho direto e
   * pelo backoffice (approvedBy = admin).
   */
  async approveRequestInternal(requestId: string, approvedBy: string | null): Promise<string> {
    const payout = await prisma.$transaction(async (tx) => {
      const request = await tx.payoutRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (request.status !== "PENDING") {
        throw new BadRequestException("Solicitação já resolvida");
      }
      const created = await tx.payout.create({
        data: { organizationId: request.organizationId, amountCents: request.amountCents },
      });
      if (request.anticipationFeeCents > 0) {
        const account = await tx.ledgerAccount.findUniqueOrThrow({
          where: { organizationId: request.organizationId },
        });
        await tx.ledgerEntry.create({
          data: {
            ledgerAccountId: account.id,
            type: "ANTICIPATION_FEE",
            amountCents: -request.anticipationFeeCents,
            referenceType: "payout",
            referenceId: created.id,
            description: "Antecipação de saque",
          },
        });
      }
      await tx.payoutRequest.update({
        where: { id: requestId },
        data: {
          status: "APPROVED",
          payoutId: created.id,
          resolvedAt: new Date(),
          ...(approvedBy ? { notes: `aprovado pelo backoffice` } : {}),
        },
      });
      return created;
    });

    // acorda o worker: com AUTO_TRANSFER_ENABLED o Pix sai em segundos
    await createAutoPayoutsQueue()
      .add("sweep", {}, { jobId: `payout-${payout.id}` })
      .catch(() => undefined); // fila fora do ar não pode travar o saque — a varredura pega depois

    return payout.id;
  }

  async listPayoutRequests(organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.FINANCE_VIEW);
    return prisma.payoutRequest.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

}
