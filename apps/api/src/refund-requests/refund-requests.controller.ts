import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { createRefundRequestSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { RefundRequestsService } from "./refund-requests.service";

@Controller("v1/orders")
export class RefundRequestsController {
  constructor(private readonly refundRequestsService: RefundRequestsService) {}

  @Post(":publicToken/refund-requests")
  @HttpCode(201)
  create(
    @Param("publicToken") publicToken: string,
    @Body(ZodBody(createRefundRequestSchema)) body: unknown,
  ) {
    return this.refundRequestsService.create(publicToken, body as any);
  }
}
