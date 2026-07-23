import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateTicketLotInput, CreateTicketTypeInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";
import { InventoryService } from "../inventory/inventory.service";

@Injectable()
export class CatalogService {
  constructor(
    private readonly orgAccess: OrgAccessService,
    private readonly inventory: InventoryService,
  ) {}

  private async assertEventAccess(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);
    return event;
  }

  async createTicketType(eventId: string, actorUserId: string, input: CreateTicketTypeInput) {
    await this.assertEventAccess(eventId, actorUserId);

    return prisma.ticketType.create({
      data: {
        eventId,
        name: input.name,
        description: input.description,
        position: input.position,
      },
    });
  }

  async createLot(ticketTypeId: string, actorUserId: string, input: CreateTicketLotInput) {
    const ticketType = await prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
      include: { event: true },
    });
    if (!ticketType) throw new NotFoundException("Tipo de ingresso não encontrado");
    await this.orgAccess.assertPermission(ticketType.event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    return prisma.ticketLot.create({
      data: {
        ticketTypeId,
        name: input.name,
        priceCents: input.priceCents,
        feeCents: input.feeCents,
        capacity: input.capacity,
        maxPerOrder: input.maxPerOrder,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
      },
    });
  }

  async activateLot(lotId: string, actorUserId: string) {
    const lot = await prisma.ticketLot.findUnique({
      where: { id: lotId },
      include: { ticketType: { include: { event: true } } },
    });
    if (!lot) throw new NotFoundException("Lote não encontrado");
    await this.orgAccess.assertPermission(
      lot.ticketType.event.organizationId,
      actorUserId,
      PERMISSIONS.EVENT_CREATE,
    );

    if (lot.status !== "DRAFT" && lot.status !== "SCHEDULED") {
      throw new BadRequestException("Lote não pode ser ativado a partir do estado atual");
    }

    return prisma.ticketLot.update({ where: { id: lotId }, data: { status: "ACTIVE" } });
  }

  /** Descoberta de eventos (Fase 12): lista eventos publicados, futuros primeiro. */
  async listPublicEvents(options: { page: number; pageSize: number }) {
    const where = { status: "PUBLISHED" as const, endsAt: { gt: new Date() } };

    const [total, events] = await Promise.all([
      prisma.event.count({ where }),
      prisma.event.findMany({
        where,
        orderBy: { startsAt: "asc" },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
        select: {
          id: true,
          title: true,
          slug: true,
          bannerUrl: true,
          startsAt: true,
          timezone: true,
          venue: { select: { name: true, city: true, state: true } },
          ticketTypes: {
            select: { lots: { where: { status: "ACTIVE" }, select: { priceCents: true } } },
          },
        },
      }),
    ]);

    return {
      total,
      page: options.page,
      pageSize: options.pageSize,
      events: events.map((event) => {
        const prices = event.ticketTypes.flatMap((type) => type.lots.map((lot) => lot.priceCents));
        return {
          id: event.id,
          title: event.title,
          slug: event.slug,
          bannerUrl: event.bannerUrl,
          startsAt: event.startsAt,
          timezone: event.timezone,
          venue: event.venue,
          fromPriceCents: prices.length > 0 ? Math.min(...prices) : null,
        };
      }),
    };
  }

  async getPublicEvent(slug: string) {
    const event = await prisma.event.findFirst({
      where: { slug, status: "PUBLISHED" },
      include: {
        venue: true,
        ticketTypes: {
          orderBy: { position: "asc" },
          include: {
            lots: {
              where: { status: "ACTIVE" },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });

    if (!event) throw new NotFoundException("Evento não encontrado");
    return event;
  }

  async getPublicAvailability(slug: string) {
    const event = await this.getPublicEvent(slug);

    return Promise.all(
      event.ticketTypes.flatMap((type) =>
        type.lots.map(async (lot) => {
          const availability = await this.inventory.getAvailability(lot.id);
          return {
            ticketTypeId: type.id,
            ticketTypeName: type.name,
            lotId: lot.id,
            lotName: lot.name,
            priceCents: lot.priceCents,
            feeCents: lot.feeCents,
            available: availability?.available ?? 0,
          };
        }),
      ),
    );
  }
}
