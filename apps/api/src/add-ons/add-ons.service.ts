import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateAddOnInput, UpdateAddOnInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";

@Injectable()
export class AddOnsService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  private async assertEventAccess(eventId: string, actorUserId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    await this.orgAccess.assertPermission(event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);
    return event;
  }

  async create(eventId: string, actorUserId: string, input: CreateAddOnInput) {
    await this.assertEventAccess(eventId, actorUserId);
    return prisma.eventAddOn.create({
      data: { eventId, name: input.name, description: input.description, priceCents: input.priceCents },
    });
  }

  async listForEvent(eventId: string, actorUserId: string) {
    await this.assertEventAccess(eventId, actorUserId);
    return prisma.eventAddOn.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } });
  }

  async update(addOnId: string, actorUserId: string, input: UpdateAddOnInput) {
    const addOn = await prisma.eventAddOn.findUnique({ where: { id: addOnId }, include: { event: true } });
    if (!addOn) throw new NotFoundException("Item adicional não encontrado");
    await this.orgAccess.assertPermission(addOn.event.organizationId, actorUserId, PERMISSIONS.EVENT_CREATE);
    return prisma.eventAddOn.update({
      where: { id: addOnId },
      data: {
        name: input.name,
        description: input.description,
        priceCents: input.priceCents,
        active: input.active,
      },
    });
  }
}
