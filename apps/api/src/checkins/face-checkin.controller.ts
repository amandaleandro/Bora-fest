import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { faceEnrollmentSchema, faceVerificationSchema } from "@borafest/contracts";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { ZodBody } from "../common/zod-body.decorator";
import { RateLimit } from "../common/rate-limit.decorator";
import { ValidatorDeviceGuard } from "../validator/validator-device.guard";
import { FaceCheckinService } from "./face-checkin.service";

@Controller("v1")
export class FaceCheckinController {
  constructor(private readonly faceCheckinService: FaceCheckinService) {}

  @Get("face-checkin/capabilities")
  capabilities() {
    return this.faceCheckinService.capabilities();
  }

  @Get("tickets/:ticketId/face-enrollment")
  @UseGuards(SessionGuard)
  status(@CurrentUserId() userId: string, @Param("ticketId") ticketId: string) {
    return this.faceCheckinService.status(userId, ticketId);
  }

  @Post("tickets/:ticketId/face-enrollment")
  @UseGuards(SessionGuard)
  enroll(
    @CurrentUserId() userId: string,
    @Param("ticketId") ticketId: string,
    @Body(ZodBody(faceEnrollmentSchema)) body: unknown,
  ) {
    return this.faceCheckinService.enroll(userId, ticketId, body as any);
  }

  @Delete("tickets/:ticketId/face-enrollment")
  @UseGuards(SessionGuard)
  revoke(@CurrentUserId() userId: string, @Param("ticketId") ticketId: string) {
    return this.faceCheckinService.revoke(userId, ticketId);
  }

  @Post("checkins/face")
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "face-checkin" })
  @UseGuards(ValidatorDeviceGuard)
  verify(@Req() req: any, @Body(ZodBody(faceVerificationSchema)) body: unknown) {
    return this.faceCheckinService.verifyAndCheckin(req.validatorDevice, body as any);
  }
}
