import { Controller, HttpCode, Param, Post } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";

@Controller("v1/orders")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post(":publicToken/resend")
  @HttpCode(202)
  resend(@Param("publicToken") publicToken: string) {
    return this.notificationsService.resendTickets(publicToken);
  }
}
