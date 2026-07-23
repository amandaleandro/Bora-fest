import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateEventInput, UpdateEventInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";

function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

@Injectable()
export class EventsService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async create(organizationId: string, actorUserId: string, input: CreateEventInput) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    const slug = `${slugify(input.title)}-${Math.random().toString(36).slice(2, 7)}`;

    return prisma.event.create({
      data: {
        organizationId,
        venueId: input.venueId,
        title: input.title,
        slug,
        description: input.description,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        timezone: input.timezone,
      },
    });
  }

  async listForOrganization(organizationId: string, actorUserId: string) {
    await this.orgAccess.assertPermission(organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    return prisma.event.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(eventId: string, actorUserId: string, input: UpdateEventInput) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);

    return prisma.event.update({
      where: { id: eventId },
      data: {
        title: input.title,
        description: input.description,
        bannerUrl: input.bannerUrl,
        venueId: input.venueId,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
        timezone: input.timezone,
      },
    });
  }

  async publish(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");

    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_PUBLISH);

    if (event.status !== "DRAFT") {
      return event;
    }

    return prisma.event.update({
      where: { id: eventId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
  }
}
