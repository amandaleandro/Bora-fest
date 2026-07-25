import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import { OrgAccessService } from "../common/org-access.service";
import { getAvailableForPayoutCents, getOrganizationBalanceCents } from "../common/ledger";

@Injectable()
export class FinanceService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async getBalance(organizationId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);

    const [balanceCents, availableForPayoutCents] = await Promise.all([
      getOrganizationBalanceCents(organizationId),
      getAvailableForPayoutCents(organizationId),
    ]);

    return { organizationId, balanceCents, availableForPayoutCents };
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
  async requestPayout(organizationId: string, userId: string, amountCents: number) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.FINANCE_VIEW);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (org.status !== "ACTIVE") {
      throw new BadRequestException(
        "Saque disponível após a aprovação do seu cadastro — as vendas seguem normalmente",
      );
    }

    const { availableForPayoutCents } = await this.getBalance(organizationId, userId);
    const pending = await prisma.payoutRequest.aggregate({
      where: { organizationId, status: "PENDING" },
      _sum: { amountCents: true },
    });
    const livre = availableForPayoutCents - (pending._sum.amountCents ?? 0);
    if (amountCents > livre) {
      throw new BadRequestException("Valor acima do saldo disponível para saque");
    }

    const bankAccount = await prisma.bankAccount.findFirst({
      where: { organizationId, isDefault: true },
    });
    if (!bankAccount) {
      throw new BadRequestException("Cadastre uma conta bancária antes de solicitar o saque");
    }

    const request = await prisma.payoutRequest.create({
      data: { organizationId, amountCents, bankAccountId: bankAccount.id, requestedBy: userId },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: userId,
        organizationId,
        action: "payout.request",
        entityType: "payout_request",
        entityId: request.id,
        metadata: { amountCents },
      },
    });

    return request;
  }

  async listPayoutRequests(organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.FINANCE_VIEW);
    return prisma.payoutRequest.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

}
