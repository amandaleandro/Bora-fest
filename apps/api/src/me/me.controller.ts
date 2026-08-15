import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { updateMeSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { MeService } from "./me.service";

@Controller("v1/me")
@UseGuards(SessionGuard)
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  profile(@CurrentUserId() userId: string) {
    return this.meService.profile(userId);
  }

  /** Verificação/edição da conta: CPF (uma vez), nome e preferências. */
  @Patch()
  updateMe(@CurrentUserId() userId: string, @Body(ZodBody(updateMeSchema)) body: unknown) {
    return this.meService.updateMe(userId, body as any);
  }

  /** Inscreve o navegador/PWA para receber push de venda (gamificação). */
  @Post("push-subscriptions")
  savePushSubscription(
    @CurrentUserId() userId: string,
    @Body() body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; userAgent?: string },
  ) {
    return this.meService.savePushSubscription(userId, body);
  }

  @Delete("push-subscriptions")
  removePushSubscription(@CurrentUserId() userId: string, @Body() body: { endpoint?: string }) {
    return this.meService.removePushSubscription(userId, body?.endpoint ?? "");
  }

  @Get("orders")
  orders(@CurrentUserId() userId: string) {
    return this.meService.orders(userId);
  }

  @Get("data-export")
  dataExport(@CurrentUserId() userId: string) {
    return this.meService.dataExport(userId);
  }

  @Delete()
  deleteAccount(@CurrentUserId() userId: string) {
    return this.meService.deleteAccount(userId);
  }
}
