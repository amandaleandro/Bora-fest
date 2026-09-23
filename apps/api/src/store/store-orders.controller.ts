import { Body, Controller, Get, Ip, Param, Post, UseGuards } from "@nestjs/common";
import {
  createStoreOrderSchema,
  createStorePixPaymentSchema,
  fulfillStoreOrderSchema,
  rejectStoreRefundSchema,
  requestStoreRefundSchema,
  createCardPaymentSchema,
} from "@borafest/contracts";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { ZodBody } from "../common/zod-body.decorator";
import { StoreOrdersService } from "./store-orders.service";
import { StorePaymentsService } from "./store-payments.service";
import { StoreRefundsService } from "./store-refunds.service";

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
    private readonly refunds: StoreRefundsService,
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

  @Post(":publicToken/payments/card")
  createCard(
    @Param("publicToken") publicToken: string,
    @Ip() ip: string,
    @Body(ZodBody(createCardPaymentSchema)) body: unknown,
  ) {
    return this.payments.createCard(publicToken, body as any, ip);
  }

  @Post(":publicToken/payments/sync")
  sync(@Param("publicToken") publicToken: string) {
    return this.payments.sync(publicToken);
  }

  @Post(":publicToken/refund-requests")
  @UseGuards(SessionGuard)
  requestRefund(
    @Param("publicToken") publicToken: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(requestStoreRefundSchema)) body: unknown,
  ) {
    return this.refunds.request(publicToken, userId, body as any);
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

  @Get("analytics")
  analytics(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.orders.analytics(organizationId, userId);
  }
}

@Controller("v1/store/orders")
@UseGuards(SessionGuard)
export class StoreOrderManageController {
  constructor(private readonly orders: StoreOrdersService) {}

  @Post(":orderId/ready")
  ready(
    @Param("orderId") orderId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.orders.markReady(orderId, userId);
  }

  @Post(":orderId/fulfill")
  fulfill(
    @Param("orderId") orderId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(fulfillStoreOrderSchema)) body: unknown,
  ) {
    return this.orders.fulfill(orderId, userId, body as any);
  }
}


@Controller("v1/organizations/:organizationId/store/refund-requests")
@UseGuards(SessionGuard)
export class StoreRefundRequestsController {
  constructor(private readonly refunds: StoreRefundsService) {}

  @Get()
  list(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.refunds.listForOrganization(organizationId, userId);
  }

  @Post(":requestId/returned")
  returned(
    @Param("organizationId") organizationId: string,
    @Param("requestId") requestId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.refunds.markReturned(requestId, organizationId, userId);
  }

  @Post(":requestId/approve")
  approve(
    @Param("organizationId") organizationId: string,
    @Param("requestId") requestId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.refunds.approve(requestId, organizationId, userId);
  }

  @Post(":requestId/reject")
  reject(
    @Param("organizationId") organizationId: string,
    @Param("requestId") requestId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(rejectStoreRefundSchema)) body: unknown,
  ) {
    return this.refunds.reject(requestId, organizationId, userId, body as any);
  }
}
