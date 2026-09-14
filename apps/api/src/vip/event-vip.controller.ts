import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createVipInventorySchema } from "@borafest/contracts";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { ZodBody } from "../common/zod-body.decorator";
import { VipService } from "./vip.service";

@Controller("v1/events/:eventId/vip")
@UseGuards(SessionGuard)
export class EventVipController {
  constructor(private readonly vip: VipService) {}

  @Get("inventory")
  inventory(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.vip.listInventory(eventId, userId);
  }

  @Post("inventory")
  createInventory(
    @Param("eventId") eventId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(createVipInventorySchema)) body: unknown,
  ) {
    return this.vip.createInventory(eventId, userId, body as any);
  }

  @Get("reservations")
  reservations(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.vip.listReservations(eventId, userId);
  }
}
