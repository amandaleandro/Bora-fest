import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { createCardPaymentSchema, createPixPaymentSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { PaymentsService } from "./payments.service";

@Controller("v1/orders/:orderId/payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("pix")
  createPix(
    @Param("orderId") orderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(ZodBody(createPixPaymentSchema)) body: unknown,
  ) {
    return this.paymentsService.createPix(orderId, body as any, idempotencyKey);
  }

  @Post("card")
  createCard(
    @Param("orderId") orderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(ZodBody(createCardPaymentSchema)) body: unknown,
  ) {
    return this.paymentsService.createCard(orderId, body as any, idempotencyKey);
  }
}
