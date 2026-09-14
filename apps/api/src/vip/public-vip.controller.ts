import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { createVipReservationSchema } from "@borafest/contracts";
import { RateLimit } from "../common/rate-limit.decorator";
import { ZodBody } from "../common/zod-body.decorator";
import { VipService } from "./vip.service";

@Controller("v1/public/events/:slug/vip")
export class PublicVipController {
  constructor(private readonly vip: VipService) {}

  @Get()
  list(@Param("slug") slug: string) {
    return this.vip.publicInventory(slug);
  }

  @Post("reservations")
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "vip-reservations-create" })
  reserve(
    @Param("slug") slug: string,
    @Body(ZodBody(createVipReservationSchema)) body: unknown,
  ) {
    return this.vip.requestReservation(slug, body as any);
  }
}
