import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { createCardPaymentSchema, createPixPaymentSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { RateLimit } from "../common/rate-limit.decorator";
import { PaymentsService } from "./payments.service";

@Controller("v1/orders/:orderId/payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("pix")
  @RateLimit({ limit: 20, windowSeconds: 300, keyPrefix: "pay-pix" })
  createPix(
    @Param("orderId") orderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(ZodBody(createPixPaymentSchema)) body: unknown,
  ) {
    return this.paymentsService.createPix(orderId, body as any, idempotencyKey);
  }

  @Post("card")
  // tentativa de cartão é o vetor clássico de teste de cartão roubado
  @RateLimit({ limit: 10, windowSeconds: 300, keyPrefix: "pay-card" })
  createCard(
    @Param("orderId") orderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(ZodBody(createCardPaymentSchema)) body: unknown,
  ) {
    return this.paymentsService.createCard(orderId, body as any, idempotencyKey);
  }
}
