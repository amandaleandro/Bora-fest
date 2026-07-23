import { Injectable } from "@nestjs/common";
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
}
