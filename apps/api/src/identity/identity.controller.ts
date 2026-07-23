import { Body, Controller, Post } from "@nestjs/common";
import { requestOtpSchema, verifyOtpSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { IdentityService } from "./identity.service";

@Controller("v1/identity")
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post("otp/request")
  requestOtp(@Body(ZodBody(requestOtpSchema)) body: unknown) {
    return this.identityService.requestOtp(body as any);
  }

  @Post("otp/verify")
  verifyOtp(@Body(ZodBody(verifyOtpSchema)) body: unknown) {
    return this.identityService.verifyOtp(body as any);
  }
}
