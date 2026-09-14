import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma, prisma } from "@borafest/database";
import type {
  CrmAudiencePreviewInput,
  CrmReactivationSendInput,
  CrmReactivationSegment,
} from "@borafest/contracts";
import { IdempotencyService } from "../common/idempotency.service";
import { CustomerCrmService } from "./customer-crm.service";

const PAGE_SIZE = 100;
const MAX_SCAN = 20_000;
const MAX_SEND = 5_000;

function matchesSegment(tags: string[], segment: CrmReactivationSegment): boolean {
  if (segment === "ALL" || segment === "EMAIL_OPT_IN") return true;
  return tags.includes(segment);
}

@Injectable()
export class CrmReactivationService {
  constructor(
    private readonly customerCrm: CustomerCrmService,
    private readonly idempotency: IdempotencyService,
  ) {}

  private async loadAudience(
    organizationId: string,
    actorUserId: string,
    segment: CrmReactivationSegment,
  ) {
    const audience = new Map<string, {
      email: string;
      name: string | null;
      tags: string[];
      eventsCount: number;
      spentCents: number;
      lastEventAt: Date | null;
    }>();

    let page = 1;
    let scanned = 0;
    let sourceTotal = 0;
    let truncated = false;

    while (scanned < MAX_SCAN) {
      const result = await this.customerCrm.list(organizationId, actorUserId, {
        segment: "EMAIL_OPT_IN",
        page,
        pageSize: PAGE_SIZE,
      });
      sourceTotal = result.total;

      for (const customer of result.customers) {
        scanned += 1;
        if (!matchesSegment(customer.tags, segment)) continue;
        const key = customer.email.trim().toLowerCase();
        if (!key || audience.has(key)) continue;
        audience.set(key, {
          email: customer.email.trim(),
          name: customer.name,
          tags: customer.tags,
          eventsCount: customer.eventsCount,
          spentCents: customer.spentCents,
          lastEventAt: customer.lastEventAt,
        });
      }

      if (page * PAGE_SIZE >= result.total) break;
      page += 1;
    }

    if (sourceTotal > scanned) truncated = true;

    return {
      customers: Array.from(audience.values()),
      scanned,
      sourceTotal,
      truncated,
    };
  }

  async preview(
    organizationId: string,
    actorUserId: string,
    input: CrmAudiencePreviewInput,
  ) {
    const audience = await this.loadAudience(organizationId, actorUserId, input.segment);
    return {
      segment: input.segment,
      eligibleCount: audience.customers.length,
      truncated: audience.truncated,
      maxSend: MAX_SEND,
      canSend: !audience.truncated && audience.customers.length > 0 && audience.customers.length <= MAX_SEND,
      sample: audience.customers.slice(0, 5).map((customer) => ({
        email: customer.email,
        name: customer.name,
        tags: customer.tags,
      })),
    };
  }

  async send(
    organizationId: string,
    actorUserId: string,
    idempotencyKey: string | undefined,
    input: CrmReactivationSendInput,
  ) {
    const rawKey = idempotencyKey?.trim();
    if (!rawKey || rawKey.length < 8 || rawKey.length > 120) {
      throw new BadRequestException("Envie um Idempotency-Key válido para disparar a campanha");
    }

    const campaignDigest = createHash("sha256")
      .update(`${organizationId}:${rawKey}`)
      .digest("hex")
      .slice(0, 32);
    const campaignId = `crm-${campaignDigest}`;
    const scopedKey = `crm-reactivation:${organizationId}:${rawKey}`;

    const alreadySent = await prisma.auditLog.findFirst({
      where: {
        organizationId,
        action: "crm.reactivation.send",
        entityType: "crm_campaign",
        entityId: campaignId,
      },
      select: { metadata: true, createdAt: true },
    });
    if (alreadySent) {
      const metadata = (alreadySent.metadata ?? {}) as Record<string, unknown>;
      return {
        campaignId,
        queued: Number(metadata.queued ?? 0),
        segment: String(metadata.segment ?? input.segment),
        createdAt: alreadySent.createdAt,
        replayed: true,
      };
    }

    return this.idempotency.run(scopedKey, `crm-reactivation:${organizationId}`, input, async () => {
      const duplicate = await prisma.auditLog.findFirst({
        where: {
          organizationId,
          action: "crm.reactivation.send",
          entityType: "crm_campaign",
          entityId: campaignId,
        },
        select: { metadata: true, createdAt: true },
      });
      if (duplicate) {
        const metadata = (duplicate.metadata ?? {}) as Record<string, unknown>;
        return {
          campaignId,
          queued: Number(metadata.queued ?? 0),
          segment: String(metadata.segment ?? input.segment),
          createdAt: duplicate.createdAt,
          replayed: true,
        };
      }

      const [organization, audience] = await Promise.all([
        prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true, displayName: true },
        }),
        this.loadAudience(organizationId, actorUserId, input.segment),
      ]);

      if (!organization) throw new BadRequestException("Casa não encontrada");
      if (audience.truncated) {
        throw new BadRequestException(
          "O público é grande demais para este disparo. Refine o segmento antes de enviar.",
        );
      }
      if (audience.customers.length === 0) {
        throw new BadRequestException("Nenhum cliente com opt-in de ofertas neste segmento");
      }
      if (audience.customers.length > MAX_SEND) {
        throw new BadRequestException(`Limite de ${MAX_SEND} destinatários por campanha`);
      }

      const houseName = organization.displayName ?? organization.name;
      const queuedAt = new Date();

      await prisma.$transaction(async (tx) => {
        await tx.notification.createMany({
          data: audience.customers.map((customer) => ({
            channel: "EMAIL" as const,
            recipient: customer.email,
            template: "crm_reactivation",
            payload: {
              campaignId,
              organizationId,
              houseName,
              customerName: customer.name,
              subject: input.subject,
              message: input.message,
              ctaLabel: input.ctaLabel ?? null,
              ctaUrl: input.ctaUrl ?? null,
            } as Prisma.InputJsonValue,
          })),
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            organizationId,
            action: "crm.reactivation.send",
            entityType: "crm_campaign",
            entityId: campaignId,
            metadata: {
              segment: input.segment,
              queued: audience.customers.length,
              subject: input.subject,
              hasCta: Boolean(input.ctaUrl),
              queuedAt: queuedAt.toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
      });

      return {
        campaignId,
        queued: audience.customers.length,
        segment: input.segment,
        createdAt: queuedAt,
        replayed: false,
      };
    });
  }
}
