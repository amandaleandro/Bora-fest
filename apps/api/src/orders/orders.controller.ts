import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createOrderSchema, pdvOrderSchema, refundOrderSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { OptionalUserId } from "../common/optional-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
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

  @Get(":orderId/detail")
  @UseGuards(SessionGuard)
  getDetail(@Param("orderId") orderId: string, @CurrentUserId() userId: string) {
    return this.ordersService.getOrderDetailForProducer(orderId, userId);
  }

  @Post(":orderId/refund")
  @UseGuards(SessionGuard)
  refund(
    @Param("orderId") orderId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(refundOrderSchema)) body: unknown,
  ) {
    return this.ordersService.refundOrder(orderId, userId, body as any);
  }
}

@Controller("v1/events/:eventId/pdv-orders")
@UseGuards(SessionGuard)
export class PdvController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(
    @Param("eventId") eventId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(pdvOrderSchema)) body: unknown,
  ) {
    return this.ordersService.createManualSale(eventId, userId, body as any);
  }
}
