import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PERMISSIONS } from "@borafest/auth";
import { prisma } from "@borafest/database";
import type { CreateLoyaltyRewardInput, UpdateLoyaltyRewardInput } from "@borafest/contracts";
import { IdempotencyService } from "../common/idempotency.service";
import { OrgAccessService } from "../common/org-access.service";

type RewardRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  pointsCost: number;
  quantity: number | null;
  maxPerCustomer: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type AccountRow = { id: string; userId: string | null };

type BuyerCasaRow = {
  accountId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  enabled: boolean;
  pointsPerReal: number;
  silverPoints: number;
  goldPoints: number;
  platinumPoints: number;
  points: bigint;
  lifetimePoints: bigint;
};

@Injectable()
export class LoyaltyRewardsService {
  constructor(
    private readonly orgAccess: OrgAccessService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async listRewards(organizationId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
    const rows = await prisma.$queryRaw<Array<RewardRow & { claimed: bigint; available: number | null }>>`
      SELECT
        rw.id,
        rw.organization_id AS "organizationId",
        rw.name,
        rw.description,
        rw.points_cost AS "pointsCost",
        rw.quantity,
        rw.max_per_customer AS "maxPerCustomer",
        rw.active,
        rw.created_at AS "createdAt",
        rw.updated_at AS "updatedAt",
        COUNT(rd.id)::bigint AS claimed,
        CASE
          WHEN rw.quantity IS NULL THEN NULL
          ELSE GREATEST(rw.quantity - COUNT(rd.id)::int, 0)
        END AS available
      FROM loyalty_rewards rw
      LEFT JOIN loyalty_redemptions rd ON rd.reward_id = rw.id
      WHERE rw.organization_id = ${organizationId}::uuid
      GROUP BY rw.id
      ORDER BY rw.active DESC, rw.points_cost ASC, rw.created_at DESC
    `;
    return rows.map((row) => ({ ...row, claimed: Number(row.claimed) }));
  }

  async createReward(organizationId: string, actorUserId: string, input: CreateLoyaltyRewardInput) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.ORG_MANAGE_MEMBERS);
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<RewardRow[]>`
        INSERT INTO loyalty_rewards (
          id, organization_id, name, description, points_cost, quantity,
          max_per_customer, active, created_at, updated_at
        ) VALUES (
          ${randomUUID()}::uuid,
          ${organizationId}::uuid,
          ${input.name},
          ${input.description ?? null},
          ${input.pointsCost},
          ${input.quantity ?? null},
          ${input.maxPerCustomer},
          TRUE,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING
          id,
          organization_id AS "organizationId",
          name,
          description,
          points_cost AS "pointsCost",
          quantity,
          max_per_customer AS "maxPerCustomer",
          active,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `;
      const reward = rows[0]!;
      await tx.auditLog.create({
        data: {
          actorUserId,
          organizationId,
          action: "loyalty.reward.created",
          entityType: "LoyaltyReward",
          entityId: reward.id,
          metadata: input,
        },
      });
      return reward;
    });
  }

  async updateReward(
    organizationId: string,
    rewardId: string,
    actorUserId: string,
    input: UpdateLoyaltyRewardInput,
  ) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.ORG_MANAGE_MEMBERS);
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<RewardRow[]>`
        SELECT
          id,
          organization_id AS "organizationId",
          name,
          description,
          points_cost AS "pointsCost",
          quantity,
          max_per_customer AS "maxPerCustomer",
          active,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM loyalty_rewards
        WHERE id = ${rewardId}::uuid AND organization_id = ${organizationId}::uuid
        FOR UPDATE
      `;
      const current = locked[0];
      if (!current) throw new NotFoundException("Recompensa não encontrada");

      const claimedRows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM loyalty_redemptions
        WHERE reward_id = ${rewardId}::uuid
      `;
      const claimed = Number(claimedRows[0]?.count ?? 0n);
      const quantity = input.quantity === undefined ? current.quantity : input.quantity;
      if (quantity !== null && quantity < claimed) {
        throw new ConflictException(`Já existem ${claimed} resgate(s); o estoque não pode ficar abaixo disso`);
      }

      const rows = await tx.$queryRaw<RewardRow[]>`
        UPDATE loyalty_rewards
        SET
          name = ${input.name ?? current.name},
          description = ${input.description === undefined ? current.description : input.description ?? null},
          points_cost = ${input.pointsCost ?? current.pointsCost},
          quantity = ${quantity},
          max_per_customer = ${input.maxPerCustomer ?? current.maxPerCustomer},
          active = ${input.active ?? current.active},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${rewardId}::uuid
        RETURNING
          id,
          organization_id AS "organizationId",
          name,
          description,
          points_cost AS "pointsCost",
          quantity,
          max_per_customer AS "maxPerCustomer",
          active,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `;
      const updated = rows[0]!;
      await tx.auditLog.create({
        data: {
          actorUserId,
          organizationId,
          action: "loyalty.reward.updated",
          entityType: "LoyaltyReward",
          entityId: rewardId,
          metadata: input,
        },
      });
      return updated;
    });
  }

  async listRedemptions(organizationId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
    return prisma.$queryRaw<Array<{
      id: string;
      code: string;
      status: string;
      pointsCost: number;
      createdAt: Date;
      usedAt: Date | null;
      rewardName: string;
      customerEmail: string;
      customerName: string | null;
    }>>`
      SELECT
        rd.id,
        rd.code,
        rd.status,
        rd.points_cost AS "pointsCost",
        rd.created_at AS "createdAt",
        rd.used_at AS "usedAt",
        rw.name AS "rewardName",
        a.email_key AS "customerEmail",
        a.display_name AS "customerName"
      FROM loyalty_redemptions rd
      JOIN loyalty_rewards rw ON rw.id = rd.reward_id
      JOIN loyalty_accounts a ON a.id = rd.loyalty_account_id
      WHERE rd.organization_id = ${organizationId}::uuid
      ORDER BY rd.created_at DESC
      LIMIT 300
    `;
  }

  async consumeCode(organizationId: string, actorUserId: string, rawCode: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
    const code = rawCode.trim().toUpperCase();
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string;
        status: string;
        code: string;
        rewardName: string;
        customerEmail: string;
        usedAt: Date | null;
      }>>`
        SELECT
          rd.id,
          rd.status,
          rd.code,
          rw.name AS "rewardName",
          a.email_key AS "customerEmail",
          rd.used_at AS "usedAt"
        FROM loyalty_redemptions rd
        JOIN loyalty_rewards rw ON rw.id = rd.reward_id
        JOIN loyalty_accounts a ON a.id = rd.loyalty_account_id
        WHERE rd.organization_id = ${organizationId}::uuid AND rd.code = ${code}
        FOR UPDATE OF rd
      `;
      const redemption = rows[0];
      if (!redemption) throw new NotFoundException("Voucher não encontrado");
      if (redemption.status === "USED") return redemption;

      const usedAt = new Date();
      await tx.$executeRaw`
        UPDATE loyalty_redemptions
        SET status = 'USED', used_at = ${usedAt}, used_by_user_id = ${actorUserId}::uuid
        WHERE id = ${redemption.id}::uuid AND status = 'ISSUED'
      `;
      await tx.auditLog.create({
        data: {
          actorUserId,
          organizationId,
          action: "loyalty.redemption.used",
          entityType: "LoyaltyRedemption",
          entityId: redemption.id,
          metadata: { code },
        },
      });
      return { ...redemption, status: "USED", usedAt };
    });
  }

  async myLoyalty(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const email = user?.email?.trim().toLowerCase();
    if (!email) return [];

    await prisma.$executeRaw`
      UPDATE loyalty_accounts
      SET user_id = ${userId}::uuid, updated_at = CURRENT_TIMESTAMP
      WHERE user_id IS NULL AND email_key = ${email}
    `;

    const casas = await prisma.$queryRaw<BuyerCasaRow[]>`
      SELECT
        a.id AS "accountId",
        a.organization_id AS "organizationId",
        COALESCE(o.display_name, o.name) AS "organizationName",
        o.slug AS "organizationSlug",
        p.enabled,
        p.points_per_real AS "pointsPerReal",
        p.silver_points AS "silverPoints",
        p.gold_points AS "goldPoints",
        p.platinum_points AS "platinumPoints",
        COALESCE(SUM(e.delta_points), 0)::bigint AS points,
        COALESCE(SUM(e.delta_points) FILTER (WHERE e.source_type <> 'REWARD_REDEEM'), 0)::bigint AS "lifetimePoints"
      FROM loyalty_accounts a
      JOIN organizations o ON o.id = a.organization_id
      JOIN loyalty_programs p ON p.organization_id = a.organization_id
      LEFT JOIN loyalty_entries e ON e.loyalty_account_id = a.id
      WHERE a.user_id = ${userId}::uuid
      GROUP BY a.id, o.id, p.id
      ORDER BY "lifetimePoints" DESC, "organizationName" ASC
    `;

    return Promise.all(casas.map(async (casa) => {
      const points = Number(casa.points ?? 0n);
      const lifetimePoints = Number(casa.lifetimePoints ?? 0n);
      const level = lifetimePoints >= casa.platinumPoints
        ? "PLATINUM"
        : lifetimePoints >= casa.goldPoints
          ? "GOLD"
          : lifetimePoints >= casa.silverPoints
            ? "SILVER"
            : "BRONZE";

      const rewards = await prisma.$queryRaw<Array<{
        id: string;
        name: string;
        description: string | null;
        pointsCost: number;
        quantity: number | null;
        maxPerCustomer: number;
        claimed: bigint;
        mine: bigint;
      }>>`
        SELECT
          rw.id,
          rw.name,
          rw.description,
          rw.points_cost AS "pointsCost",
          rw.quantity,
          rw.max_per_customer AS "maxPerCustomer",
          COUNT(rd.id)::bigint AS claimed,
          COUNT(rd.id) FILTER (WHERE rd.loyalty_account_id = ${casa.accountId}::uuid)::bigint AS mine
        FROM loyalty_rewards rw
        LEFT JOIN loyalty_redemptions rd ON rd.reward_id = rw.id
        WHERE rw.organization_id = ${casa.organizationId}::uuid AND rw.active = TRUE
        GROUP BY rw.id
        ORDER BY rw.points_cost ASC, rw.created_at DESC
      `;

      const vouchers = await prisma.$queryRaw<Array<{
        id: string;
        code: string;
        status: string;
        pointsCost: number;
        createdAt: Date;
        usedAt: Date | null;
        rewardName: string;
      }>>`
        SELECT
          rd.id,
          rd.code,
          rd.status,
          rd.points_cost AS "pointsCost",
          rd.created_at AS "createdAt",
          rd.used_at AS "usedAt",
          rw.name AS "rewardName"
        FROM loyalty_redemptions rd
        JOIN loyalty_rewards rw ON rw.id = rd.reward_id
        WHERE rd.loyalty_account_id = ${casa.accountId}::uuid
        ORDER BY rd.created_at DESC
        LIMIT 30
      `;

      return {
        organizationId: casa.organizationId,
        organizationName: casa.organizationName,
        organizationSlug: casa.organizationSlug,
        enabled: casa.enabled,
        pointsPerReal: casa.pointsPerReal,
        points,
        lifetimePoints,
        level,
        rewards: rewards.map((reward) => {
          const claimed = Number(reward.claimed ?? 0n);
          const mine = Number(reward.mine ?? 0n);
          return {
            id: reward.id,
            name: reward.name,
            description: reward.description,
            pointsCost: reward.pointsCost,
            available: reward.quantity === null ? null : Math.max(0, reward.quantity - claimed),
            canRedeem: points >= reward.pointsCost && mine < reward.maxPerCustomer && (reward.quantity === null || claimed < reward.quantity),
            redeemedByMe: mine,
            maxPerCustomer: reward.maxPerCustomer,
          };
        }),
        vouchers,
      };
    }));
  }

  async redeem(userId: string, organizationId: string, rewardId: string, idempotencyKey?: string) {
    return this.idempotency.run(
      idempotencyKey,
      "loyalty:redeem",
      { userId, organizationId, rewardId },
      async () => {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
        const email = user?.email?.trim().toLowerCase();
        if (!email) throw new ConflictException("Sua conta precisa ter um e-mail válido para resgatar benefícios");

        return prisma.$transaction(async (tx) => {
          const rewards = await tx.$queryRaw<RewardRow[]>`
            SELECT
              id,
              organization_id AS "organizationId",
              name,
              description,
              points_cost AS "pointsCost",
              quantity,
              max_per_customer AS "maxPerCustomer",
              active,
              created_at AS "createdAt",
              updated_at AS "updatedAt"
            FROM loyalty_rewards
            WHERE id = ${rewardId}::uuid AND organization_id = ${organizationId}::uuid
            FOR UPDATE
          `;
          const reward = rewards[0];
          if (!reward || !reward.active) throw new NotFoundException("Recompensa indisponível");

          await tx.$executeRaw`
            UPDATE loyalty_accounts
            SET user_id = ${userId}::uuid, updated_at = CURRENT_TIMESTAMP
            WHERE organization_id = ${organizationId}::uuid AND user_id IS NULL AND email_key = ${email}
          `;
          const accounts = await tx.$queryRaw<AccountRow[]>`
            SELECT id, user_id AS "userId"
            FROM loyalty_accounts
            WHERE organization_id = ${organizationId}::uuid AND user_id = ${userId}::uuid
            LIMIT 1
            FOR UPDATE
          `;
          const account = accounts[0];
          if (!account) throw new ConflictException("Você ainda não possui pontos nesta Casa");

          const balances = await tx.$queryRaw<Array<{ points: bigint }>>`
            SELECT COALESCE(SUM(delta_points), 0)::bigint AS points
            FROM loyalty_entries
            WHERE loyalty_account_id = ${account.id}::uuid
          `;
          const balance = Number(balances[0]?.points ?? 0n);
          if (balance < reward.pointsCost) throw new ConflictException("Saldo de pontos insuficiente para esta recompensa");

          const mineRows = await tx.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(*)::bigint AS count
            FROM loyalty_redemptions
            WHERE reward_id = ${rewardId}::uuid AND loyalty_account_id = ${account.id}::uuid
          `;
          const mine = Number(mineRows[0]?.count ?? 0n);
          if (mine >= reward.maxPerCustomer) {
            throw new ConflictException("Você já atingiu o limite de resgates desta recompensa");
          }

          if (reward.quantity !== null) {
            const claimedRows = await tx.$queryRaw<Array<{ count: bigint }>>`
              SELECT COUNT(*)::bigint AS count FROM loyalty_redemptions WHERE reward_id = ${rewardId}::uuid
            `;
            if (Number(claimedRows[0]?.count ?? 0n) >= reward.quantity) {
              throw new ConflictException("Esta recompensa esgotou");
            }
          }

          const redemptionId = randomUUID();
          const code = `BF-${redemptionId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
          await tx.$executeRaw`
            INSERT INTO loyalty_redemptions (
              id, organization_id, reward_id, loyalty_account_id, code, points_cost, status, created_at
            ) VALUES (
              ${redemptionId}::uuid, ${organizationId}::uuid, ${rewardId}::uuid, ${account.id}::uuid,
              ${code}, ${reward.pointsCost}, 'ISSUED', CURRENT_TIMESTAMP
            )
          `;
          await tx.$executeRaw`
            INSERT INTO loyalty_entries (
              id, loyalty_account_id, organization_id, delta_points, source_type, source_id, description, created_at
            ) VALUES (
              ${randomUUID()}::uuid, ${account.id}::uuid, ${organizationId}::uuid, ${-reward.pointsCost},
              'REWARD_REDEEM', ${redemptionId}::uuid, ${`Resgate: ${reward.name}`}, CURRENT_TIMESTAMP
            )
          `;

          return { id: redemptionId, code, status: "ISSUED", rewardName: reward.name, pointsCost: reward.pointsCost };
        });
      },
    );
  }
}
