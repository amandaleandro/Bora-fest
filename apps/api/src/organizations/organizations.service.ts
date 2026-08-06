import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateOrganizationInput, CreateSalesPartnerInput, InviteMemberInput } from "@borafest/contracts";
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

  async listForUser(userId: string) {
    const memberships = await prisma.organizationMember.findMany({
      where: { userId, status: "ACTIVE" },
      include: { organization: true, role: true },
      orderBy: { joinedAt: "asc" },
    });

    return memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      kind: membership.organization.kind,
      status: membership.organization.status,
      roleKey: membership.role.key,
    }));
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

    if (input.roleKey === "seller" && input.partnerId) {
      const partner = await prisma.salesPartner.findFirst({ where: { id: input.partnerId, organizationId } });
      if (!partner) throw new NotFoundException("Parceiro de vendas não encontrado");
    }

    const membership = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId, userId: invitedUser.id } },
      update: { roleId: role.id, status: "INVITED", salesPartnerId: input.partnerId ?? null },
      create: {
        organizationId,
        userId: invitedUser.id,
        roleId: role.id,
        status: "INVITED",
        salesPartnerId: input.partnerId,
      },
    });

    if (input.roleKey === "seller" && input.partnerId) {
      await prisma.salesPartnerMember.upsert({
        where: { partnerId_userId: { partnerId: input.partnerId, userId: invitedUser.id } },
        update: {},
        create: { partnerId: input.partnerId, userId: invitedUser.id },
      });
    }
    return membership;
  }

  async createSalesPartner(organizationId: string, userId: string, input: CreateSalesPartnerInput) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.ORG_MANAGE_MEMBERS);
    const baseSlug = slugify(input.name) || "parceiro";
    let slug = baseSlug;
    let suffix = 2;
    // slug precisa ser único por organização — tenta o nome puro, senão vai incrementando
    while (await prisma.salesPartner.findFirst({ where: { organizationId, slug } })) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    return prisma.salesPartner.create({ data: { organizationId, name: input.name, slug, commissionBps: input.commissionBps } });
  }

  async listSalesPartners(organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.ORG_MANAGE_MEMBERS);
    return prisma.salesPartner.findMany({
      where: { organizationId, active: true },
      include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
      orderBy: { name: "asc" },
    });
  }

  /** Comprador segue o produtor — qualquer usuário logado, sem checagem de membership. */
  async follow(organizationId: string, userId: string) {
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException("Organização não encontrada");
    return prisma.organizationFollow.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      create: { organizationId, userId },
      update: {},
    });
  }

  async unfollow(organizationId: string, userId: string) {
    await prisma.organizationFollow.deleteMany({ where: { organizationId, userId } });
    return { following: false };
  }

  async isFollowing(organizationId: string, userId: string) {
    const follow = await prisma.organizationFollow.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    return { following: !!follow };
  }

  async addBankAccount(organizationId: string, userId: string, input: {
    holderName: string; holderDocument: string; bankCode: string;
    agency: string; account: string; accountType: string; pixKey?: string;
  }) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.FINANCE_VIEW);
    // a conta nova vira a padrão de repasse
    const [, created] = await prisma.$transaction([
      prisma.bankAccount.updateMany({ where: { organizationId }, data: { isDefault: false } }),
      prisma.bankAccount.create({ data: { organizationId, ...input, isDefault: true } }),
    ]);
    return created;
  }

  async listBankAccounts(organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.FINANCE_VIEW);
    return prisma.bankAccount.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  }

}
