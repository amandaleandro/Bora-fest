import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createGuestListEntrySchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { GuestListService } from "./guest-list.service";

@Controller("v1/events/:eventId/guest-list")
@UseGuards(SessionGuard)
export class GuestListController {
  constructor(private readonly guestListService: GuestListService) {}

  @Post()
  create(
    @CurrentUserId() userId: string,
    @Param("eventId") eventId: string,
    @Body(ZodBody(createGuestListEntrySchema)) body: unknown,
  ) {
    return this.guestListService.create(userId, eventId, body as any);
  }

  @Get()
  list(@CurrentUserId() userId: string, @Param("eventId") eventId: string) {
    return this.guestListService.list(userId, eventId);
  }

  @Delete(":id")
  cancel(
    @CurrentUserId() userId: string,
    @Param("eventId") eventId: string,
    @Param("id") id: string,
  ) {
    return this.guestListService.cancel(userId, eventId, id);
  }
}
