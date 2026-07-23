import { Body, Controller, Post } from "@nestjs/common";
import { requestOtpSchema, verifyOtpSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { RateLimit } from "../common/rate-limit.decorator";
import { IdentityService } from "./identity.service";

@Controller("v1/identity")
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post("otp/request")
  @RateLimit({ limit: 5, windowSeconds: 900, keyPrefix: "otp-request", by: "body:destination" })
  requestOtp(@Body(ZodBody(requestOtpSchema)) body: unknown) {
    return this.identityService.requestOtp(body as any);
  }

  @Post("otp/verify")
  @RateLimit({ limit: 10, windowSeconds: 900, keyPrefix: "otp-verify" })
  verifyOtp(@Body(ZodBody(verifyOtpSchema)) body: unknown) {
    return this.identityService.verifyOtp(body as any);
  }
}
