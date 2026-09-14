import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { createVipReservationSchema } from "@borafest/contracts";
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
  reserve(
    @Param("slug") slug: string,
    @Body(ZodBody(createVipReservationSchema)) body: unknown,
  ) {
    return this.vip.requestReservation(slug, body as any);
  }
}
