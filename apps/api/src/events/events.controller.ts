import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { createEventSchema, updateEventSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { EventsService } from "./events.service";

@Controller()
@UseGuards(SessionGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post("v1/organizations/:organizationId/events")
  create(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(createEventSchema)) body: unknown,
  ) {
    return this.eventsService.create(organizationId, userId, body as any);
  }

  @Get("v1/organizations/:organizationId/events")
  list(@Param("organizationId") organizationId: string, @CurrentUserId() userId: string) {
    return this.eventsService.listForOrganization(organizationId, userId);
  }

  @Patch("v1/events/:id")
  update(
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(updateEventSchema)) body: unknown,
  ) {
    return this.eventsService.update(id, userId, body as any);
  }

  @Post("v1/events/:id/publish")
  publish(@Param("id") id: string, @CurrentUserId() userId: string) {
    return this.eventsService.publish(id, userId);
  }
}
