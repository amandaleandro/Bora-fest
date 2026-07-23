import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { createCheckinSchema, syncCheckinsSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { ValidatorDeviceGuard } from "../validator/validator-device.guard";
import { CheckinsService } from "./checkins.service";

@Controller("v1")
export class CheckinsController {
  constructor(private readonly checkinsService: CheckinsService) {}

  @Post("checkins")
  @UseGuards(ValidatorDeviceGuard)
  create(@Req() req: any, @Body(ZodBody(createCheckinSchema)) body: unknown) {
    return this.checkinsService.create(req.validatorDevice, body as any);
  }

  @Post("checkins/sync")
  @UseGuards(ValidatorDeviceGuard)
  sync(@Req() req: any, @Body(ZodBody(syncCheckinsSchema)) body: unknown) {
    return this.checkinsService.sync(req.validatorDevice, body as any);
  }

  @Post("checkins/:id/reverse")
  @UseGuards(SessionGuard)
  reverse(@CurrentUserId() userId: string, @Param("id") checkinId: string) {
    return this.checkinsService.reverse(userId, checkinId);
  }

  @Get("events/:eventId/checkin-live")
  @UseGuards(SessionGuard)
  live(@CurrentUserId() userId: string, @Param("eventId") eventId: string) {
    return this.checkinsService.live(userId, eventId);
  }
}
