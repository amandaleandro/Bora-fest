import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createCouponSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { RateLimit } from "../common/rate-limit.decorator";
import { CurrentUserId } from "../common/current-user.decorator";
import { CouponsService } from "./coupons.service";

@Controller("v1")
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  // --- produtor -------------------------------------------------------------

  @Post("events/:eventId/coupons")
  @UseGuards(SessionGuard)
  create(
    @CurrentUserId() userId: string,
    @Param("eventId") eventId: string,
    @Body(ZodBody(createCouponSchema)) body: unknown,
  ) {
    return this.couponsService.create(userId, eventId, body as any);
  }

  @Get("events/:eventId/coupons")
  @UseGuards(SessionGuard)
  list(@CurrentUserId() userId: string, @Param("eventId") eventId: string) {
    return this.couponsService.list(userId, eventId);
  }

  @Post("coupons/:id/deactivate")
  @UseGuards(SessionGuard)
  deactivate(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.couponsService.deactivate(userId, id);
  }

  // --- público (preview no checkout) ---------------------------------------

  // força-bruta de cupom (auditoria 2026-08-29): sem limite próprio, dava pra
  // varrer códigos. Por IP, e keado pelo slug+código para não travar preços
  // legítimos de eventos diferentes.
  @Get("public/events/:slug/coupons/:code")
  @RateLimit({ limit: 20, windowSeconds: 300, keyPrefix: "coupon-check" })
  check(@Param("slug") slug: string, @Param("code") code: string) {
    return this.couponsService.check(slug, code);
  }
}
