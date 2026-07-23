import { ForbiddenException, Injectable } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { roleHasPermission, type PermissionKey } from "@borafest/auth";

@Injectable()
export class OrgAccessService {
  async assertPermission(organizationId: string, userId: string, permission: PermissionKey) {
    const membership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { role: true },
    });

    if (
      !membership ||
      membership.status !== "ACTIVE" ||
      !roleHasPermission(membership.role.key, permission)
    ) {
      throw new ForbiddenException("Sem permissão para esta ação na organização");
    }

    return membership;
  }
}
