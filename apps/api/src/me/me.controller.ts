import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { pushSubscriptionSchema, removePushSubscriptionSchema, updateMeSchema } from "@borafest/contracts";
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
    @Body(ZodBody(pushSubscriptionSchema)) body: unknown,
  ) {
    return this.meService.savePushSubscription(userId, body as any);
  }

  @Delete("push-subscriptions")
  removePushSubscription(
    @CurrentUserId() userId: string,
    @Body(ZodBody(removePushSubscriptionSchema)) body: unknown,
  ) {
    return this.meService.removePushSubscription(userId, (body as any).endpoint);
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
