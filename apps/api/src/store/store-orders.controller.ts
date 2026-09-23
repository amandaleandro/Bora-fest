import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  createStoreOrderSchema,
  createStorePixPaymentSchema,
  fulfillStoreOrderSchema,
} from "@borafest/contracts";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { ZodBody } from "../common/zod-body.decorator";
import { StoreOrdersService } from "./store-orders.service";
import { StorePaymentsService } from "./store-payments.service";

@Controller("v1/public/casas/:slug/store")
export class PublicStoreOrdersController {
  constructor(
    private readonly orders: StoreOrdersService,
    private readonly payments: StorePaymentsService,
  ) {}

  @Post("orders")
  createOrder(
    @Param("slug") slug: string,
    @Body(ZodBody(createStoreOrderSchema)) body: unknown,
  ) {
    return this.orders.createPublic(slug, body as any);
  }
}

@Controller("v1/public/store/orders")
export class PublicStoreOrderController {
  constructor(
    private readonly orders: StoreOrdersService,
    private readonly payments: StorePaymentsService,
  ) {}

  @Get(":publicToken")
  get(@Param("publicToken") publicToken: string) {
    return this.orders.findPublic(publicToken);
  }

  @Post(":publicToken/payments/pix")
  createPix(
    @Param("publicToken") publicToken: string,
    @Body(ZodBody(createStorePixPaymentSchema)) body: unknown,
  ) {
    return this.payments.createPix(publicToken, body as any);
  }

  @Post(":publicToken/payments/sync")
  sync(@Param("publicToken") publicToken: string) {
    return this.payments.sync(publicToken);
  }
}

@Controller("v1/organizations/:organizationId/store/orders")
@UseGuards(SessionGuard)
export class StoreOrdersManageController {
  constructor(private readonly orders: StoreOrdersService) {}

  @Get()
  list(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.orders.listManage(organizationId, userId);
  }
}

@Controller("v1/store/orders")
@UseGuards(SessionGuard)
export class StoreOrderManageController {
  constructor(private readonly orders: StoreOrdersService) {}

  @Post(":orderId/fulfill")
  fulfill(
    @Param("orderId") orderId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(fulfillStoreOrderSchema)) body: unknown,
  ) {
    return this.orders.fulfill(orderId, userId, body as any);
  }
}
