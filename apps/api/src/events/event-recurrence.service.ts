import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PERMISSIONS } from "@borafest/auth";
import { prisma } from "@borafest/database";
import type { DuplicateEventInput, NextEventEditionInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";

function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const RESERVED_SLUGS = new Set([
  "acesso", "checkout", "evento", "explorar", "favoritos", "legal",
  "minhas-compras", "offline", "pedido", "perfil", "portaria",
  "api", "admin", "painel", "sitemap.xml", "robots.txt", "_next",
]);

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title) || "evento";
  for (let n = 0; n < 100; n += 1) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    if (RESERVED_SLUGS.has(candidate)) continue;
    const exists = await prisma.event.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function shiftDate(value: Date | null, deltaMs: number): Date | null {
  return value ? new Date(value.getTime() + deltaMs) : null;
}

@Injectable()
export class EventRecurrenceService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async duplicate(eventId: string, actorUserId: string, input: DuplicateEventInput) {
    const source = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        ticketTypes: {
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          include: { lots: { orderBy: { createdAt: "asc" } } },
        },
        addOns: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!source) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(source.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException("A nova edição precisa terminar depois do início");
    }

    const title = input.title?.trim() || source.title;
    const slug = await uniqueSlug(title);
    const deltaMs = startsAt.getTime() - source.startsAt.getTime();

    const created = await prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          organizationId: source.organizationId,
          venueId: source.venueId,
          title,
          slug,
          description: source.description,
          lineup: source.lineup,
          amenities: source.amenities,
          minAge: source.minAge,
          bannerUrl: source.bannerUrl,
          category: source.category,
          status: "DRAFT",
          startsAt,
          endsAt,
          timezone: source.timezone,
          waitingRoomEnabled: source.waitingRoomEnabled,
          waitingRoomConcurrency: source.waitingRoomConcurrency,
          pixelSettings: source.pixelSettings ?? undefined,
          // metaCapiToken deliberadamente NÃO é copiado: é segredo e deve ser
          // configurado explicitamente em cada edição se necessário.
        },
      });

      if (input.copyTicketCatalog) {
        for (const type of source.ticketTypes) {
          const newType = await tx.ticketType.create({
            data: {
              eventId: event.id,
              name: type.name,
              description: type.description,
              position: type.position,
            },
          });

          if (type.lots.length > 0) {
            await tx.ticketLot.createMany({
              data: type.lots.map((lot) => ({
                ticketTypeId: newType.id,
                name: lot.name,
                priceCents: lot.priceCents,
                feeCents: lot.feeCents,
                capacity: lot.capacity,
                maxPerOrder: lot.maxPerOrder,
                feeMode: lot.feeMode,
                nominal: lot.nominal,
                requiresCpf: lot.requiresCpf,
                halfPriceEnabled: lot.halfPriceEnabled,
                pdvOnly: lot.pdvOnly,
                promoterOnly: lot.promoterOnly,
                // N3: nova edição sempre nasce segura. Nunca herdamos SOLD_OUT,
                // ACTIVE ou CLOSED, e os contadores defaultam para zero.
                status: "DRAFT",
                startsAt: shiftDate(lot.startsAt, deltaMs),
                endsAt: shiftDate(lot.endsAt, deltaMs),
              })),
            });
          }
        }
      }

      if (source.addOns.length > 0) {
        await tx.eventAddOn.createMany({
          data: source.addOns.map((addOn) => ({
            eventId: event.id,
            name: addOn.name,
            description: addOn.description,
            priceCents: addOn.priceCents,
            active: addOn.active,
          })),
        });
      }

      return event;
    });

    return {
      ...created,
      copiedFromEventId: source.id,
      copiedTicketTypes: input.copyTicketCatalog ? source.ticketTypes.length : 0,
      copiedLots: input.copyTicketCatalog
        ? source.ticketTypes.reduce((sum, type) => sum + type.lots.length, 0)
        : 0,
      copiedAddOns: source.addOns.length,
    };
  }

  async nextEdition(eventId: string, actorUserId: string, input: NextEventEditionInput) {
    const source = await prisma.event.findUnique({
      where: { id: eventId },
      select: { startsAt: true, endsAt: true },
    });
    if (!source) throw new NotFoundException("Evento não encontrado");

    const deltaMs = input.cadenceDays * 24 * 60 * 60 * 1000;
    return this.duplicate(eventId, actorUserId, {
      title: input.title,
      copyTicketCatalog: input.copyTicketCatalog,
      startsAt: new Date(source.startsAt.getTime() + deltaMs).toISOString(),
      endsAt: new Date(source.endsAt.getTime() + deltaMs).toISOString(),
    });
  }
}
