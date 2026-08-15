import type { UpdateOrganizationInput } from "@borafest/contracts";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma, Prisma } from "@borafest/database";
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
    // Documento sempre normalizado (só dígitos): evita duplicata mascarada
    // ("103.176.886-69" vs "10317688669") e mantém o unique honesto.
    const document = input.document.replace(/\D/g, "");
    if (document.length < 11) {
      throw new BadRequestException("Documento inválido — informe um CPF (11 dígitos) ou CNPJ (14 dígitos).");
    }

    const criada = await prisma.organization
      .create({
        data: {
          name: input.name,
          slug,
          kind: input.kind,
          producerType: input.producerType,
          document,
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
      })
      .catch((error: unknown) => {
        // document é @unique global: o mesmo CPF/CNPJ não abre duas
        // organizações. Antes isso vazava como 500 "Internal server error".
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const alvo = Array.isArray(error.meta?.target)
            ? (error.meta?.target as string[]).join(",")
            : String(error.meta?.target ?? "");
          if (alvo.includes("document")) {
            throw new ConflictException(
              "Já existe uma organização cadastrada com esse CPF/CNPJ. Use a que já existe ou fale com o suporte.",
            );
          }
          throw new ConflictException("Não foi possível criar: já existe uma organização com esses dados.");
        }
        throw error;
      });

    // "A mesma conta cresce" (decisão 2026-08-11): quem juntou comissão como
    // promoter (carteira de PESSOA) e agora completou o cadastro leva o saldo
    // junto — a carteira vira da organização, com histórico e datas de
    // maturação intactos, e passa a usar o motor de saque normal.
    const carteiraPessoal = await prisma.ledgerAccount.findUnique({ where: { userId } });
    if (carteiraPessoal) {
      await prisma.ledgerAccount.update({
        where: { id: carteiraPessoal.id },
        data: { organizationId: criada.id, userId: null },
      });
      await prisma.auditLog.create({
        data: {
          actorUserId: userId,
          organizationId: criada.id,
          action: "wallet.promoted_to_organization",
          entityType: "ledger_account",
          entityId: carteiraPessoal.id,
        },
      });
    }

    return criada;
  }

  /**
   * Carteira do promoter PESSOA (antes de virar produtor): saldo acumulado em
   * comissões e o que já está liberado. Sacar exige completar o cadastro —
   * quando isso acontece, a carteira migra para a organização (ver create()).
   */
  async getMyWallet(userId: string) {
    const account = await prisma.ledgerAccount.findUnique({ where: { userId } });
    if (!account) return { balanceCents: 0, availableCents: 0, needsProducerAccount: true };
    const agora = new Date();
    const [total, maduro] = await Promise.all([
      prisma.ledgerEntry.aggregate({
        where: { ledgerAccountId: account.id },
        _sum: { amountCents: true },
      }),
      prisma.ledgerEntry.aggregate({
        where: { ledgerAccountId: account.id, availableAt: { lte: agora } },
        _sum: { amountCents: true },
      }),
    ]);
    return {
      balanceCents: total._sum.amountCents ?? 0,
      availableCents: Math.max(maduro._sum.amountCents ?? 0, 0),
      // saque só pelo motor da organização: complete o cadastro para sacar
      needsProducerAccount: true,
    };
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
  /** Só quem administra uma organização convida promoters (evita enumeração). */
  private async assertProducer(userId: string) {
    const administra = await prisma.organizationMember.findFirst({
      where: { userId, status: "ACTIVE", role: { key: { in: ["owner", "admin"] } } },
      select: { id: true },
    });
    if (!administra) {
      throw new ForbiddenException("Só produtores podem convidar promoters");
    }
  }

  /** Garante uma conta simples (e-mail) para o convidado — a barreira de entrada. */
  private async upsertBasicUser(email: string) {
    return prisma.user.upsert({
      where: { email: email.trim().toLowerCase() },
      update: {},
      create: { email: email.trim().toLowerCase() },
    });
  }

  private commissionSummary(link: {
    commissionType: string;
    commissionBps: number;
    commissionFixedCents: number;
  }) {
    if (link.commissionType === "PERCENT") return { commissionType: "PERCENT", commissionBps: link.commissionBps };
    if (link.commissionType === "FIXED")
      return { commissionType: "FIXED", commissionFixedCents: link.commissionFixedCents };
    return { commissionType: "NONE" };
  }

  /**
   * A CASA convida uma PESSOA (por e-mail) para ser promoter. Conta simples é
   * criada na hora se não existir — sem exigir produtor nem banco. Comissão
   * NONE/PERCENT/FIXED definida pela casa.
   */
  async invitePromoter(
    organizationId: string,
    actorUserId: string,
    input: {
      email: string;
      eventId?: string;
      commissionType: "NONE" | "PERCENT" | "FIXED";
      commissionBps?: number;
      commissionFixedCents?: number;
    },
  ) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.ORG_MANAGE_MEMBERS);
    const promoter = await this.upsertBasicUser(input.email);

    // escopo por evento (decisão 2026-08-15): o evento tem que ser DESTA casa
    if (input.eventId) {
      const evento = await prisma.event.findFirst({
        where: { id: input.eventId, organizationId },
        select: { id: true },
      });
      if (!evento) throw new BadRequestException("Evento não pertence a esta organização");
    }

    const data = {
      commissionType: input.commissionType,
      commissionBps: input.commissionType === "PERCENT" ? input.commissionBps ?? 0 : 0,
      commissionFixedCents: input.commissionType === "FIXED" ? input.commissionFixedCents ?? 0 : 0,
      eventId: input.eventId ?? null,
    };
    const existente = await prisma.promoterLink.findUnique({
      where: { organizationId_promoterUserId: { organizationId, promoterUserId: promoter.id } },
    });
    if (existente && existente.status !== "DECLINED" && existente.status !== "REMOVED") {
      throw new BadRequestException("Esta pessoa já foi convidada");
    }
    const slug = `${input.email.split("@")[0].replace(/[^a-z0-9]/gi, "").slice(0, 12)}-${Math.random().toString(36).slice(2, 6)}`;
    const link = existente
      ? await prisma.promoterLink.update({
          where: { id: existente.id },
          data: { ...data, status: "INVITED", invitedBy: actorUserId, invitedAt: new Date(), respondedAt: null },
        })
      : await prisma.promoterLink.create({
          data: { organizationId, promoterUserId: promoter.id, ...data, slug, invitedBy: actorUserId },
        });
    await prisma.auditLog.create({
      data: {
        actorUserId,
        organizationId,
        action: "promoter.invited",
        entityType: "promoter_link",
        entityId: link.id,
        metadata: { promoterUserId: promoter.id, ...data },
      },
    });
    return link;
  }

  /** Visão da CASA: promoters com vendas e comissão acumulada. */
  async listPromoters(organizationId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.ORG_MANAGE_MEMBERS);
    const links = await prisma.promoterLink.findMany({
      where: { organizationId, status: { in: ["INVITED", "ACTIVE"] } },
      include: {
        promoterUser: { select: { name: true, email: true } },
        event: { select: { title: true } },
        _count: { select: { sellers: true } },
      },
      orderBy: { invitedAt: "desc" },
    });
    const stats = await prisma.order.groupBy({
      by: ["promoterLinkId"],
      where: { promoterLinkId: { in: links.map((l) => l.id) }, status: { in: ["PAID", "FULFILLED"] } },
      _count: { _all: true },
      _sum: { promoterCommissionCents: true, totalCents: true },
    });
    const porLink = new Map(stats.map((s) => [s.promoterLinkId, s]));
    return links.map((link) => ({
      id: link.id,
      status: link.status,
      slug: link.slug,
      /** null = todos os eventos; senão, o título do evento do escopo */
      eventTitle: link.event?.title ?? null,
      promoterName: link.promoterUser.name ?? link.promoterUser.email,
      sellers: link._count.sellers,
      paidOrders: porLink.get(link.id)?._count._all ?? 0,
      soldCents: porLink.get(link.id)?._sum.totalCents ?? 0,
      commissionCents: porLink.get(link.id)?._sum.promoterCommissionCents ?? 0,
      ...this.commissionSummary(link),
    }));
  }

  /** Convites de promoter pendentes para ESTE usuário (pessoa convidada). */
  async listMyPromoterInvites(userId: string) {
    return prisma.promoterLink.findMany({
      where: { promoterUserId: userId, status: "INVITED" },
      include: { organization: { select: { id: true, name: true, displayName: true } } },
      orderBy: { invitedAt: "desc" },
    });
  }

  /** A pessoa convidada aceita/recusa ser promoter. */
  async respondPromoterInvite(linkId: string, userId: string, accept: boolean) {
    const link = await prisma.promoterLink.findUniqueOrThrow({ where: { id: linkId } });
    if (link.promoterUserId !== userId) throw new ForbiddenException("Convite não é seu");
    if (link.status !== "INVITED") throw new BadRequestException("Convite já respondido");
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

  /** Lado do PROMOTER: meus vínculos ativos, link e vendas (dinheiro só se houver comissão). */
  async listMyPromoterEngagements(userId: string) {
    const links = await prisma.promoterLink.findMany({
      where: { promoterUserId: userId, status: "ACTIVE" },
      include: { organization: { select: { name: true, displayName: true } } },
      orderBy: { invitedAt: "desc" },
    });
    const stats = await prisma.order.groupBy({
      by: ["promoterLinkId"],
      where: { promoterLinkId: { in: links.map((l) => l.id) }, status: { in: ["PAID", "FULFILLED"] } },
      _count: { _all: true },
      _sum: { promoterCommissionCents: true },
    });
    const porLink = new Map(stats.map((s) => [s.promoterLinkId, s]));
    return links.map((link) => ({
      id: link.id,
      hostName: link.organization.displayName ?? link.organization.name,
      slug: link.slug,
      paidOrders: porLink.get(link.id)?._count._all ?? 0,
      ...(link.commissionType !== "NONE"
        ? { ...this.commissionSummary(link), commissionCents: porLink.get(link.id)?._sum.promoterCommissionCents ?? 0 }
        : {}),
    }));
  }

  // ---- vendedores do promoter (nível 3) -----------------------------------

  /** O PROMOTER convida uma pessoa (por e-mail) para vender no link dele. */
  async inviteSeller(promoterLinkId: string, actorUserId: string, input: { email: string }) {
    const link = await prisma.promoterLink.findUniqueOrThrow({ where: { id: promoterLinkId } });
    if (link.promoterUserId !== actorUserId) throw new ForbiddenException("Este promoter não é seu");
    if (link.status !== "ACTIVE") throw new BadRequestException("Aceite o convite de promoter primeiro");
    const seller = await this.upsertBasicUser(input.email);
    if (seller.id === actorUserId) throw new BadRequestException("Você já é o promoter");
    const existente = await prisma.promoterSeller.findUnique({
      where: { promoterLinkId_sellerUserId: { promoterLinkId, sellerUserId: seller.id } },
    });
    if (existente && existente.status !== "DECLINED" && existente.status !== "REMOVED") {
      throw new BadRequestException("Esta pessoa já foi convidada");
    }
    const slug = `${input.email.split("@")[0].replace(/[^a-z0-9]/gi, "").slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`;
    return existente
      ? prisma.promoterSeller.update({
          where: { id: existente.id },
          data: { status: "INVITED", invitedAt: new Date(), respondedAt: null },
        })
      : prisma.promoterSeller.create({ data: { promoterLinkId, sellerUserId: seller.id, slug } });
  }

  /** Convites de vendedor pendentes para ESTE usuário. */
  async listMySellerInvites(userId: string) {
    return prisma.promoterSeller.findMany({
      where: { sellerUserId: userId, status: "INVITED" },
      include: {
        promoterLink: {
          include: {
            organization: { select: { name: true, displayName: true } },
            promoterUser: { select: { name: true, email: true } },
          },
        },
      },
      orderBy: { invitedAt: "desc" },
    });
  }

  async respondSellerInvite(sellerId: string, userId: string, accept: boolean) {
    const seller = await prisma.promoterSeller.findUniqueOrThrow({ where: { id: sellerId } });
    if (seller.sellerUserId !== userId) throw new ForbiddenException("Convite não é seu");
    if (seller.status !== "INVITED") throw new BadRequestException("Convite já respondido");
    return prisma.promoterSeller.update({
      where: { id: sellerId },
      data: { status: accept ? "ACTIVE" : "DECLINED", respondedAt: new Date() },
    });
  }

  /** Lado do VENDEDOR: meus vínculos ativos e quanto EU vendi (nunca dinheiro). */
  async listMySellerEngagements(userId: string) {
    const sellers = await prisma.promoterSeller.findMany({
      where: { sellerUserId: userId, status: "ACTIVE" },
      include: {
        promoterLink: {
          include: {
            organization: { select: { name: true, displayName: true } },
            promoterUser: { select: { name: true, email: true } },
          },
        },
      },
      orderBy: { invitedAt: "desc" },
    });
    const stats = await prisma.order.groupBy({
      by: ["promoterSellerId"],
      where: { promoterSellerId: { in: sellers.map((s) => s.id) }, status: { in: ["PAID", "FULFILLED"] } },
      _count: { _all: true },
      _sum: { totalCents: true },
    });
    const porSeller = new Map(stats.map((s) => [s.promoterSellerId, s]));
    return sellers.map((seller) => ({
      id: seller.id,
      slug: seller.slug,
      hostName: seller.promoterLink.organization.displayName ?? seller.promoterLink.organization.name,
      promoterName: seller.promoterLink.promoterUser.name ?? seller.promoterLink.promoterUser.email,
      paidOrders: porSeller.get(seller.id)?._count._all ?? 0,
      soldCents: porSeller.get(seller.id)?._sum.totalCents ?? 0,
    }));
  }

  /** Cascata: o PROMOTER vê quanto cada vendedor dele vendeu. */
  async listSellersOfPromoter(promoterLinkId: string, actorUserId: string) {
    const link = await prisma.promoterLink.findUniqueOrThrow({ where: { id: promoterLinkId } });
    const isHost = await prisma.organizationMember
      .findFirst({
        where: { organizationId: link.organizationId, userId: actorUserId, status: "ACTIVE" },
        select: { id: true },
      })
      .then(Boolean);
    if (link.promoterUserId !== actorUserId && !isHost) {
      throw new ForbiddenException("Sem acesso a este promoter");
    }
    const sellers = await prisma.promoterSeller.findMany({
      where: { promoterLinkId, status: { in: ["INVITED", "ACTIVE"] } },
      include: { sellerUser: { select: { name: true, email: true } } },
      orderBy: { invitedAt: "desc" },
    });
    const stats = await prisma.order.groupBy({
      by: ["promoterSellerId"],
      where: { promoterSellerId: { in: sellers.map((s) => s.id) }, status: { in: ["PAID", "FULFILLED"] } },
      _count: { _all: true },
      _sum: { totalCents: true },
    });
    const porSeller = new Map(stats.map((s) => [s.promoterSellerId, s]));
    return sellers.map((seller) => ({
      id: seller.id,
      status: seller.status,
      slug: seller.slug,
      sellerName: seller.sellerUser.name ?? seller.sellerUser.email,
      paidOrders: porSeller.get(seller.id)?._count._all ?? 0,
      soldCents: porSeller.get(seller.id)?._sum.totalCents ?? 0,
    }));
  }

  async listBankAccounts(organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.FINANCE_VIEW);
    return prisma.bankAccount.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  }

}
