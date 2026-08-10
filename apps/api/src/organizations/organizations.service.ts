import type { UpdateOrganizationInput } from "@borafest/contracts";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
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
        producerType: input.producerType,
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
      displayName: membership.organization.displayName,
      slug: membership.organization.slug,
      kind: membership.organization.kind,
      status: membership.organization.status,
      roleKey: membership.role.key,
    }));
  }

  /** Perfil público da organização (nome comercial). Só quem gerencia membros edita. */
  async update(organizationId: string, actorUserId: string, input: UpdateOrganizationInput) {
    await this.orgAccess.assertPermission(
      organizationId,
      actorUserId,
      PERMISSIONS.ORG_MANAGE_MEMBERS,
    );
    return prisma.organization.update({
      where: { id: organizationId },
      data: { displayName: input.displayName === undefined ? undefined : input.displayName },
      select: { id: true, name: true, displayName: true, slug: true },
    });
  }

  async inviteMember(organizationId: string, actorUserId: string, input: InviteMemberInput) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.ORG_MANAGE_MEMBERS);

    const role = await prisma.role.findUnique({ where: { key: input.roleKey } });
    if (!role) throw new NotFoundException("Papel invalido");

    // só DONO cria outro dono — admin promovendo alguém a owner era escalação
    // de privilégio (auditoria 2026-08-10)
    if (input.roleKey === "owner") {
      const ator = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: actorUserId } },
        include: { role: true },
      });
      if (ator?.role.key !== "owner") {
        throw new ForbiddenException("Apenas o dono da organização pode convidar outro dono");
      }
    }

    const invitedUser = await prisma.user.upsert({
      where: { email: input.email },
      update: {},
      create: { email: input.email },
    });

    if (input.roleKey === "seller" && input.partnerId) {
      const partner = await prisma.salesPartner.findFirst({ where: { id: input.partnerId, organizationId } });
      if (!partner) throw new NotFoundException("Parceiro de vendas não encontrado");
    }

    // NUNCA rebaixar quem já é membro (incidente 2026-08-10: convidar um
    // e-mail que já era DONO sobrescrevia papel e status — a pessoa perdia a
    // edição dos próprios eventos). Membro ATIVO: papel e status são
    // intocáveis pelo convite; só o vínculo de parceiro pode ser somado.
    const existing = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: invitedUser.id } },
      include: { role: true },
    });
    if (existing && existing.status === "ACTIVE") {
      if (existing.role.key === input.roleKey) {
        // idempotente: mesmo papel — no máximo anexa o parceiro
        const membership =
          input.partnerId && existing.salesPartnerId !== input.partnerId
            ? await prisma.organizationMember.update({
                where: { id: existing.id },
                data: { salesPartnerId: input.partnerId },
              })
            : existing;
        if (input.roleKey === "seller" && input.partnerId) {
          await prisma.salesPartnerMember.upsert({
            where: { partnerId_userId: { partnerId: input.partnerId, userId: invitedUser.id } },
            update: {},
            create: { partnerId: input.partnerId, userId: invitedUser.id },
          });
        }
        return membership;
      }
      throw new BadRequestException(
        `Este e-mail já é membro da organização (papel: ${existing.role.key}). ` +
          "Para trocar o papel, remova o membro e convide de novo.",
      );
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
    // trocar o DESTINO DO DINHEIRO é ato de gestão, não de leitura financeira
    // (auditoria 2026-08-10: bastava FINANCE_VIEW)
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.ORG_MANAGE_MEMBERS);
    // a conta nova vira a padrão de repasse; trocar destino do dinheiro
    // carimba a quarentena de saque (48h) — defesa contra conta invadida
    const [, created] = await prisma.$transaction([
      prisma.bankAccount.updateMany({ where: { organizationId }, data: { isDefault: false } }),
      prisma.bankAccount.create({
        data: { organizationId, ...input, isDefault: true, pixKeyUpdatedAt: new Date() },
      }),
    ]);
    await prisma.auditLog.create({
      data: {
        actorUserId: userId,
        organizationId,
        action: "bank_account.changed",
        entityType: "bank_account",
        entityId: created.id,
        metadata: { quarantineHours: 48 },
      },
    });
    return created;
  }

  /**
   * Busca de contas de produtor para convite de promoter (nome, nome
   * comercial, CPF ou CNPJ). Documento só é comparado por igualdade exata
   * (nada de varrer por prefixo de CPF) e volta mascarado.
   */
  async searchOrganizations(userId: string, query: string) {
    // busca por CPF/CNPJ é para convidar promoter — restrita a quem administra
    // uma organização (auditoria 2026-08-10: qualquer sessão enumerava)
    const administra = await prisma.organizationMember.findFirst({
      where: { userId, status: "ACTIVE", role: { key: { in: ["owner", "admin"] } } },
      select: { id: true },
    });
    if (!administra) {
      throw new ForbiddenException("Só produtores podem buscar contas para convidar");
    }
    const q = query.trim();
    if (q.length < 3) return [];
    const digits = q.replace(/\D/g, "");
    const orgs = await prisma.organization.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
          ...(digits.length >= 11 ? [{ document: digits }] : []),
        ],
      },
      select: { id: true, name: true, displayName: true, producerType: true, document: true },
      take: 10,
    });
    return orgs.map((org) => ({
      id: org.id,
      name: org.displayName ?? org.name,
      producerType: org.producerType,
      documentMasked: `***${org.document.slice(-4)}`,
    }));
  }

  /** Convida outra conta de produtor para ser promoter desta organização. */
  async invitePromoter(
    organizationId: string,
    actorUserId: string,
    input: { promoterOrgId: string; commissionBps: number },
  ) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.ORG_MANAGE_MEMBERS);
    if (input.promoterOrgId === organizationId) {
      throw new BadRequestException("A organização não pode ser promoter dela mesma");
    }
    const promoterOrg = await prisma.organization.findUnique({
      where: { id: input.promoterOrgId },
      select: { id: true, slug: true, status: true },
    });
    if (!promoterOrg || promoterOrg.status !== "ACTIVE") {
      throw new BadRequestException("Conta de produtor não encontrada ou inativa");
    }
    const existente = await prisma.promoterLink.findUnique({
      where: {
        organizationId_promoterOrgId: { organizationId, promoterOrgId: input.promoterOrgId },
      },
    });
    if (existente && existente.status !== "DECLINED" && existente.status !== "REMOVED") {
      throw new BadRequestException("Esta conta já foi convidada");
    }
    const slug = `${promoterOrg.slug}-${Math.random().toString(36).slice(2, 6)}`;
    const link = existente
      ? await prisma.promoterLink.update({
          where: { id: existente.id },
          data: {
            status: "INVITED",
            commissionBps: input.commissionBps,
            invitedBy: actorUserId,
            invitedAt: new Date(),
            respondedAt: null,
          },
        })
      : await prisma.promoterLink.create({
          data: {
            organizationId,
            promoterOrgId: input.promoterOrgId,
            commissionBps: input.commissionBps,
            slug,
            invitedBy: actorUserId,
          },
        });
    await prisma.auditLog.create({
      data: {
        actorUserId,
        organizationId,
        action: "promoter.invited",
        entityType: "promoter_link",
        entityId: link.id,
        metadata: { promoterOrgId: input.promoterOrgId, commissionBps: input.commissionBps },
      },
    });
    return link;
  }

  /** Lista de promoters da organização anfitriã, com contagem de vendas. */
  async listPromoters(organizationId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.ORG_MANAGE_MEMBERS);
    const links = await prisma.promoterLink.findMany({
      where: { organizationId, status: { in: ["INVITED", "ACTIVE"] } },
      include: { promoterOrg: { select: { name: true, displayName: true } } },
      orderBy: { invitedAt: "desc" },
    });
    const stats = await prisma.order.groupBy({
      by: ["promoterLinkId"],
      where: { promoterLinkId: { in: links.map((l) => l.id) }, status: "PAID" },
      _count: { _all: true },
      _sum: { promoterCommissionCents: true },
    });
    const porLink = new Map(stats.map((s) => [s.promoterLinkId, s]));
    return links.map((link) => ({
      id: link.id,
      status: link.status,
      commissionBps: link.commissionBps,
      slug: link.slug,
      promoterName: link.promoterOrg.displayName ?? link.promoterOrg.name,
      paidOrders: porLink.get(link.id)?._count._all ?? 0,
      commissionCents: porLink.get(link.id)?._sum.promoterCommissionCents ?? 0,
    }));
  }

  /** Convites pendentes para as organizações que o usuário administra. */
  async listMyPromoterInvites(userId: string) {
    const memberships = await prisma.organizationMember.findMany({
      where: { userId, status: "ACTIVE", role: { key: { in: ["owner", "admin"] } } },
      select: { organizationId: true },
    });
    const orgIds = memberships.map((m) => m.organizationId);
    if (orgIds.length === 0) return [];
    return prisma.promoterLink.findMany({
      where: { promoterOrgId: { in: orgIds }, status: "INVITED" },
      include: {
        organization: { select: { id: true, name: true, displayName: true } },
        promoterOrg: { select: { id: true, name: true, displayName: true } },
      },
      orderBy: { invitedAt: "desc" },
    });
  }

  /** Aceita/recusa convite — precisa administrar a organização convidada. */
  async respondPromoterInvite(linkId: string, userId: string, accept: boolean) {
    const link = await prisma.promoterLink.findUniqueOrThrow({ where: { id: linkId } });
    if (link.status !== "INVITED") throw new BadRequestException("Convite já respondido");
    await this.orgAccess.assertPermission(link.promoterOrgId, userId, PERMISSIONS.ORG_MANAGE_MEMBERS);
    const updated = await prisma.promoterLink.update({
      where: { id: linkId },
      data: { status: accept ? "ACTIVE" : "DECLINED", respondedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: userId,
        organizationId: link.organizationId,
        action: accept ? "promoter.accepted" : "promoter.declined",
        entityType: "promoter_link",
        entityId: linkId,
      },
    });
    return updated;
  }

  /**
   * Lado do PROMOTER: meus vínculos ativos com link e contagem de vendas.
   * commissionBps = 0 → o payload NÃO fala de dinheiro (só contagem) — a UI
   * nunca diz "você não vai receber".
   */
  async listMyPromoterEngagements(userId: string) {
    const memberships = await prisma.organizationMember.findMany({
      where: { userId, status: "ACTIVE" },
      select: { organizationId: true },
    });
    const orgIds = memberships.map((m) => m.organizationId);
    if (orgIds.length === 0) return [];
    const links = await prisma.promoterLink.findMany({
      where: { promoterOrgId: { in: orgIds }, status: "ACTIVE" },
      include: { organization: { select: { name: true, displayName: true } } },
      orderBy: { invitedAt: "desc" },
    });
    const stats = await prisma.order.groupBy({
      by: ["promoterLinkId"],
      where: { promoterLinkId: { in: links.map((l) => l.id) }, status: "PAID" },
      _count: { _all: true },
      _sum: { promoterCommissionCents: true },
    });
    const porLink = new Map(stats.map((s) => [s.promoterLinkId, s]));
    return links.map((link) => ({
      id: link.id,
      hostName: link.organization.displayName ?? link.organization.name,
      slug: link.slug,
      paidOrders: porLink.get(link.id)?._count._all ?? 0,
      // dinheiro só aparece quando há comissão de verdade
      ...(link.commissionBps > 0
        ? {
            commissionBps: link.commissionBps,
            commissionCents: porLink.get(link.id)?._sum.promoterCommissionCents ?? 0,
          }
        : {}),
    }));
  }

  async listBankAccounts(organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.FINANCE_VIEW);
    return prisma.bankAccount.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  }

}
