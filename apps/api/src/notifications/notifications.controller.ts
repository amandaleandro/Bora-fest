import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { orderWhatsAppSchema, registerPushTokenSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { NotificationsService } from "./notifications.service";
import { RateLimit } from "../common/rate-limit.decorator";

@Controller("v1/orders")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post(":publicToken/resend")
  @HttpCode(202)
  resend(@Param("publicToken") publicToken: string) {
    return this.notificationsService.resendTickets(publicToken);
  }

  // teto por pedido+IP (auditoria 2026-08-30): fecha o uso como disparador de
  // WhatsApp pago em massa sem tirar o envio legítimo para outro número
  @Post(":publicToken/whatsapp")
  @RateLimit({ limit: 6, windowSeconds: 3600, keyPrefix: "order-whatsapp", by: "params:publicToken" })
  @HttpCode(200)
  sendWhatsApp(
    @Param("publicToken") publicToken: string,
    @Body(ZodBody(orderWhatsAppSchema)) body: unknown,
  ) {
    return this.notificationsService.sendTicketsToWhatsApp(publicToken, body as any);
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
