import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  createCheckinPointSchema,
  createValidatorCredentialSchema,
  registerValidatorDeviceSchema,
  validatorSessionSchema,
} from "@borafest/contracts";
import { z } from "zod";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { ValidatorDeviceGuard } from "./validator-device.guard";
import { ValidatorService } from "./validator.service";

const sessionWithDeviceSchema = z.object({
  session: validatorSessionSchema,
  device: registerValidatorDeviceSchema,
});

// --- painel do produtor -----------------------------------------------------

@Controller("v1/events/:eventId")
@UseGuards(SessionGuard)
export class ValidatorConfigController {
  constructor(private readonly validatorService: ValidatorService) {}

  @Post("checkin-points")
  createPoint(
    @CurrentUserId() userId: string,
    @Param("eventId") eventId: string,
    @Body(ZodBody(createCheckinPointSchema)) body: unknown,
  ) {
    return this.validatorService.createCheckinPoint(userId, eventId, body as any);
  }

  @Get("checkin-points")
  listPoints(@CurrentUserId() userId: string, @Param("eventId") eventId: string) {
    return this.validatorService.listCheckinPoints(userId, eventId);
  }

  @Post("validator-credentials")
  createCredential(
    @CurrentUserId() userId: string,
    @Param("eventId") eventId: string,
    @Body(ZodBody(createValidatorCredentialSchema)) body: unknown,
  ) {
    return this.validatorService.createCredential(userId, eventId, body as any);
  }

  @Get("validator-devices")
  listDevices(@CurrentUserId() userId: string, @Param("eventId") eventId: string) {
    return this.validatorService.listDevices(userId, eventId);
  }

  @Post("validator-devices/:deviceId/block")
  blockDevice(
    @CurrentUserId() userId: string,
    @Param("eventId") eventId: string,
    @Param("deviceId") deviceId: string,
  ) {
    return this.validatorService.blockDevice(userId, eventId, deviceId);
  }
}

// --- app de check-in --------------------------------------------------------

@Controller("v1/validator")
export class ValidatorController {
  constructor(private readonly validatorService: ValidatorService) {}

  /** login por PIN + registro do aparelho em uma chamada */
  @Post("sessions")
  createSession(@Body(ZodBody(sessionWithDeviceSchema)) body: unknown) {
    const input = body as z.infer<typeof sessionWithDeviceSchema>;
    return this.validatorService.createSessionAndRegisterDevice(input.session, input.device);
  }

  @Post("devices/:deviceId/refresh")
  @UseGuards(ValidatorDeviceGuard)
  refresh(@Req() req: any, @Param("deviceId") deviceId: string) {
    return this.validatorService.refreshDeviceToken(req.validatorDevice, deviceId);
  }

  @Get("events/:eventId/manifest")
  @UseGuards(ValidatorDeviceGuard)
  manifest(@Req() req: any) {
    return this.validatorService.getManifest(req.validatorDevice);
  }

  @Get("events/:eventId/manifest/delta")
  @UseGuards(ValidatorDeviceGuard)
  manifestDelta(@Req() req: any, @Query("since") since: string) {
    const parsed = since ? new Date(since) : undefined;
    return this.validatorService.getManifest(
      req.validatorDevice,
      parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined,
    );
  }
}
