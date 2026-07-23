import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateOrganizationInput, InviteMemberInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async create(userId: string, input: CreateOrganizationInput) {
    const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: "owner" } });
    const baseSlug = slugify(input.name);
    const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;

    return prisma.organization.create({
      data: {
        name: input.name,
        slug,
        kind: input.kind,
        document: input.document,
        members: {
          create: {
            userId,
            roleId: ownerRole.id,
            status: "ACTIVE",
            joinedAt: new Date(),
          },
        },
      },
      include: { members: true },
    });
  }

  async inviteMember(organizationId: string, actorUserId: string, input: InviteMemberInput) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.ORG_MANAGE_MEMBERS);

    const role = await prisma.role.findUnique({ where: { key: input.roleKey } });
    if (!role) throw new NotFoundException("Papel invalido");

    const invitedUser = await prisma.user.upsert({
      where: { email: input.email },
      update: {},
      create: { email: input.email },
    });

    return prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId, userId: invitedUser.id } },
      update: { roleId: role.id, status: "INVITED" },
      create: {
        organizationId,
        userId: invitedUser.id,
        roleId: role.id,
        status: "INVITED",
      },
    });
  }
}
