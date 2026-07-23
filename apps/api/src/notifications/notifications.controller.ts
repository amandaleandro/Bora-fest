import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { registerPushTokenSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { NotificationsService } from "./notifications.service";

@Controller("v1/orders")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post(":publicToken/resend")
  @HttpCode(202)
  resend(@Param("publicToken") publicToken: string) {
    return this.notificationsService.resendTickets(publicToken);
  }

  @Post(":publicToken/push-token")
  @HttpCode(201)
  registerPushToken(
    @Param("publicToken") publicToken: string,
    @Body(ZodBody(registerPushTokenSchema)) body: unknown,
  ) {
    return this.notificationsService.registerPushToken(publicToken, body as any);
  }
}
