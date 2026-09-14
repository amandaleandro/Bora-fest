import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { createVipPixPaymentSchema } from "@borafest/contracts";
import { RateLimit } from "../common/rate-limit.decorator";
import { ZodBody } from "../common/zod-body.decorator";
import { PublicVipStatusService } from "./public-vip-status.service";
import { VipPaymentsService } from "./vip-payments.service";

const uuidPipe = new ParseUUIDPipe({ version: "4" });

@Controller("v1/public/vip/reservations")
export class PublicVipReservationController {
  constructor(
    private readonly statusService: PublicVipStatusService,
    private readonly payments: VipPaymentsService,
  ) {}

  @Get(":publicToken")
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "vip-reservation-status" })
  status(@Param("publicToken", uuidPipe) publicToken: string) {
    return this.statusService.get(publicToken);
  }

  @Post(":publicToken/payments/pix")
  @RateLimit({ limit: 10, windowSeconds: 300, keyPrefix: "vip-payment-pix", by: "params:publicToken" })
  createPix(
    @Param("publicToken", uuidPipe) publicToken: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(ZodBody(createVipPixPaymentSchema)) body: unknown,
  ) {
    return this.payments.createPix(publicToken, body as any, idempotencyKey);
  }

  @Post(":publicToken/payments/sync")
  @RateLimit({ limit: 12, windowSeconds: 60, keyPrefix: "vip-payment-sync", by: "params:publicToken" })
  sync(@Param("publicToken", uuidPipe) publicToken: string) {
    return this.payments.sync(publicToken);
  }
}
