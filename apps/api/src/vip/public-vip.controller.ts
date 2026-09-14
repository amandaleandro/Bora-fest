import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { createVipReservationSchema } from "@borafest/contracts";
import { IdempotencyService } from "../common/idempotency.service";
import { RateLimit } from "../common/rate-limit.decorator";
import { ZodBody } from "../common/zod-body.decorator";
import { VipService } from "./vip.service";

@Controller("v1/public/events/:slug/vip")
export class PublicVipController {
  constructor(
    private readonly vip: VipService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  list(@Param("slug") slug: string) {
    return this.vip.publicInventory(slug);
  }

  @Post("reservations")
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "vip-reservations-create" })
  reserve(
    @Param("slug") slug: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(ZodBody(createVipReservationSchema)) body: unknown,
  ) {
    const payload = body as any;
    return this.idempotency.run(
      idempotencyKey,
      `vip-reservation:${slug}`,
      payload,
      () => this.vip.requestReservation(slug, payload),
    );
  }
}
