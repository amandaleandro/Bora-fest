import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { createOrderSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { OptionalUserId } from "../common/optional-user.decorator";
import { OrdersService } from "./orders.service";

@Controller("v1/orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(
    @OptionalUserId() userId: string | undefined,
    @Body(ZodBody(createOrderSchema)) body: unknown,
  ) {
    return this.ordersService.createFromReservation(userId, body as any);
  }

  @Get(":publicToken/status")
  status(@Param("publicToken") publicToken: string) {
    return this.ordersService.findByPublicToken(publicToken);
  }
}
