import { ConflictException, Injectable } from "@nestjs/common";
import { prisma } from "@borafest/database";

@Injectable()
export class LoyaltyRedemptionGuardService {
  async assertProgramEnabled(organizationId: string): Promise<void> {
    const rows = await prisma.$queryRaw<Array<{ enabled: boolean }>>`
      SELECT enabled
      FROM loyalty_programs
      WHERE organization_id = ${organizationId}::uuid
      LIMIT 1
    `;
    if (!rows[0]?.enabled) {
      throw new ConflictException("O programa de fidelidade desta Casa está pausado");
    }
  }
}
