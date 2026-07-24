import { Body, Controller, Post } from "@nestjs/common";
import {
  passwordLoginSchema,
  recoverPasswordSchema,
  registerSchema,
  requestOtpSchema,
  resetPasswordSchema,
  verifyOtpSchema,
} from "@borafest/contracts";
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

  // --- auth por senha (painel do produtor — protótipo docs/design) ---------

  @Post("register")
  @RateLimit({ limit: 10, windowSeconds: 900, keyPrefix: "register" })
  register(@Body(ZodBody(registerSchema)) body: unknown) {
    return this.identityService.registerWithPassword(body as any);
  }

  @Post("login")
  @RateLimit({ limit: 10, windowSeconds: 900, keyPrefix: "pwd-login" })
  login(@Body(ZodBody(passwordLoginSchema)) body: unknown) {
    return this.identityService.loginWithPassword(body as any);
  }

  @Post("recover")
  @RateLimit({ limit: 5, windowSeconds: 900, keyPrefix: "pwd-recover", by: "body:email" })
  recover(@Body(ZodBody(recoverPasswordSchema)) body: unknown) {
    return this.identityService.recoverPassword(body as any);
  }

  @Post("reset-password")
  @RateLimit({ limit: 10, windowSeconds: 900, keyPrefix: "pwd-reset" })
  reset(@Body(ZodBody(resetPasswordSchema)) body: unknown) {
    return this.identityService.resetPassword(body as any);
  }
}
