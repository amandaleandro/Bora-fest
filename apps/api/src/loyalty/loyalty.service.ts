import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PERMISSIONS } from "@borafest/auth";
import { prisma } from "@borafest/database";
import type { UpdateLoyaltyProgramInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";

type ProgramRow = {
  id: string;
  enabled: boolean;
  pointsPerReal: number;
  silverPoints: number;
  goldPoints: number;
  platinumPoints: number;
};

type AccountRow = {
  id: string | null;
  email: string | null;
  name: string | null;
  userId: string | null;
  points: bigint | null;
  lifetimePoints: bigint | null;
  lastActivityAt: Date | null;
  totalRows: bigint;
  totalBalance: bigint;
  silverRows: bigint;
  goldRows: bigint;
  platinumRows: bigint;
};

@Injectable()
export class LoyaltyService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  private async ensureProgram(organizationId: string): Promise<ProgramRow> {
    const rows = await prisma.$queryRaw<ProgramRow[]>`
      INSERT INTO loyalty_programs (
        id, organization_id, enabled, points_per_real,
        silver_points, gold_points, platinum_points, created_at, updated_at
      ) VALUES (
        ${randomUUID()}::uuid, ${organizationId}::uuid, FALSE, 1, 500, 1500, 3000,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (organization_id) DO UPDATE SET organization_id = EXCLUDED.organization_id
      RETURNING
        id,
        enabled,
        points_per_real AS "pointsPerReal",
        silver_points AS "silverPoints",
        gold_points AS "goldPoints",
        platinum_points AS "platinumPoints"
    `;
    return rows[0]!;
  }

  async getProgram(organizationId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
    return this.ensureProgram(organizationId);
  }

  async updateProgram(organizationId: string, actorUserId: string, input: UpdateLoyaltyProgramInput) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.ORG_MANAGE_MEMBERS);
    await this.ensureProgram(organizationId);
    const rows = await prisma.$queryRaw<ProgramRow[]>`
      UPDATE loyalty_programs
      SET
        enabled = ${input.enabled},
        points_per_real = ${input.pointsPerReal},
        silver_points = ${input.silverPoints},
        gold_points = ${input.goldPoints},
        platinum_points = ${input.platinumPoints},
        updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ${organizationId}::uuid
      RETURNING
        id,
        enabled,
        points_per_real AS "pointsPerReal",
        silver_points AS "silverPoints",
        gold_points AS "goldPoints",
        platinum_points AS "platinumPoints"
    `;
    await prisma.auditLog.create({
      data: {
        actorUserId,
        organizationId,
        action: "loyalty.program.updated",
        entityType: "LoyaltyProgram",
        entityId: rows[0]!.id,
        metadata: input,
      },
    });
    return rows[0]!;
  }

  async listAccounts(
    organizationId: string,
    actorUserId: string,
    options: { q?: string; page?: number; pageSize?: number },
  ) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.FINANCE_VIEW);
    const program = await this.ensureProgram(organizationId);
    const page = Math.max(1, Math.floor(options.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize || 30)));
    const offset = (page - 1) * pageSize;
    const q = options.q?.trim().toLowerCase() || "";
    const pattern = `%${q}%`;

    const rows = await prisma.$queryRaw<AccountRow[]>`
      WITH balances AS (
        SELECT
          a.id,
          a.email_key AS email,
          a.display_name AS name,
          a.user_id AS "userId",
          COALESCE(SUM(e.delta_points), 0)::bigint AS points,
          COALESCE(SUM(e.delta_points) FILTER (WHERE e.delta_points > 0), 0)::bigint AS "lifetimePoints",
          MAX(e.created_at) AS "lastActivityAt"
        FROM loyalty_accounts a
        LEFT JOIN loyalty_entries e ON e.loyalty_account_id = a.id
        WHERE a.organization_id = ${organizationId}::uuid
        GROUP BY a.id
      ),
      filtered AS (
        SELECT * FROM balances
        WHERE ${q} = '' OR LOWER(email) LIKE ${pattern} OR LOWER(COALESCE(name, '')) LIKE ${pattern}
      ),
      summary AS (
        SELECT
          COUNT(*)::bigint AS "totalRows",
          COALESCE(SUM(points), 0)::bigint AS "totalBalance",
          COUNT(*) FILTER (WHERE "lifetimePoints" >= ${program.silverPoints} AND "lifetimePoints" < ${program.goldPoints})::bigint AS "silverRows",
          COUNT(*) FILTER (WHERE "lifetimePoints" >= ${program.goldPoints} AND "lifetimePoints" < ${program.platinumPoints})::bigint AS "goldRows",
          COUNT(*) FILTER (WHERE "lifetimePoints" >= ${program.platinumPoints})::bigint AS "platinumRows"
        FROM filtered
      ),
      page_rows AS (
        SELECT * FROM filtered
        ORDER BY "lifetimePoints" DESC, points DESC, "lastActivityAt" DESC NULLS LAST, email ASC
        LIMIT ${pageSize} OFFSET ${offset}
      )
      SELECT
        p.id,
        p.email,
        p.name,
        p."userId",
        p.points,
        p."lifetimePoints",
        p."lastActivityAt",
        s."totalRows",
        s."totalBalance",
        s."silverRows",
        s."goldRows",
        s."platinumRows"
      FROM summary s
      LEFT JOIN page_rows p ON TRUE
      ORDER BY p."lifetimePoints" DESC NULLS LAST, p.points DESC NULLS LAST, p."lastActivityAt" DESC NULLS LAST
    `;

    const first = rows[0];
    const levelFor = (lifetimePoints: number) => {
      if (lifetimePoints >= program.platinumPoints) return "PLATINUM";
      if (lifetimePoints >= program.goldPoints) return "GOLD";
      if (lifetimePoints >= program.silverPoints) return "SILVER";
      return "BRONZE";
    };

    return {
      page,
      pageSize,
      total: Number(first?.totalRows ?? 0n),
      program,
      summary: {
        pointsOutstanding: Number(first?.totalBalance ?? 0n),
        silver: Number(first?.silverRows ?? 0n),
        gold: Number(first?.goldRows ?? 0n),
        platinum: Number(first?.platinumRows ?? 0n),
      },
      accounts: rows
        .filter((row) => row.id && row.email)
        .map((row) => {
          const points = Number(row.points ?? 0n);
          const lifetimePoints = Number(row.lifetimePoints ?? 0n);
          return {
            id: row.id!,
            email: row.email!,
            name: row.name,
            userId: row.userId,
            points,
            lifetimePoints,
            level: levelFor(lifetimePoints),
            lastActivityAt: row.lastActivityAt,
          };
        }),
    };
  }
}
