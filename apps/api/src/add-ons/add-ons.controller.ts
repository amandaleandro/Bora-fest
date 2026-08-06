import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { createAddOnSchema, updateAddOnSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { AddOnsService } from "./add-ons.service";

@Controller("v1/events/:eventId/add-ons")
@UseGuards(SessionGuard)
export class AddOnsController {
  constructor(private readonly addOnsService: AddOnsService) {}

  @Post()
  create(
    @Param("eventId") eventId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(createAddOnSchema)) body: unknown,
  ) {
    return this.addOnsService.create(eventId, userId, body as any);
  }

  @Get()
  list(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.addOnsService.listForEvent(eventId, userId);
  }
}

@Controller("v1/add-ons/:id")
@UseGuards(SessionGuard)
export class AddOnController {
  constructor(private readonly addOnsService: AddOnsService) {}

  @Patch()
  update(
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(updateAddOnSchema)) body: unknown,
  ) {
    return this.addOnsService.update(id, userId, body as any);
  }
}
