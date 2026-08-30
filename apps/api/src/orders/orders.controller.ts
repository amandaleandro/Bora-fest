import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createOrderSchema, pdvOrderSchema, refundOrderSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { OptionalUserId } from "../common/optional-user.decorator";
import { RateLimit } from "../common/rate-limit.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { OrdersService } from "./orders.service";

@Controller("v1/orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post(":publicToken/correct-email")
  correctEmail(@Param("publicToken") publicToken: string, @Body() body: { email?: string }) {
    return this.ordersService.correctEmail(publicToken, body?.email ?? "");
  }

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

  /**
   * Reembolso protegido (self-service do comprador): quem comprou a proteção
   * pede o reembolso do ingresso até o início do evento — o prêmio fica.
   * Exige SESSÃO do comprador, não só a posse do link (auditoria 2026-08-30): o
   * token de leitura do pedido não pode disparar uma ação IRREVERSÍVEL de
   * dinheiro — senão qualquer um com o link cancelaria o ingresso alheio. Rate
   * limit por pedido para não virar alavanca de ataque.
   */
  @Post(":publicToken/protection-refund")
  @UseGuards(SessionGuard)
  @RateLimit({ limit: 4, windowSeconds: 3600, keyPrefix: "protection-refund", by: "params:publicToken" })
  protectionRefund(@Param("publicToken") publicToken: string, @CurrentUserId() userId: string) {
    return this.ordersService.requestProtectionRefund(publicToken, userId);
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

  @Post(":publicToken/correct-email")
  correctEmail(@Param("publicToken") publicToken: string, @Body() body: { email?: string }) {
    return this.ordersService.correctEmail(publicToken, body?.email ?? "");
  }

  @Post()
  create(
    @Param("eventId") eventId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(pdvOrderSchema)) body: unknown,
  ) {
    return this.ordersService.createManualSale(eventId, userId, body as any);
  }

  /**
   * Venda na porta modo PIX: cria o pedido PENDENTE (não pago) e devolve o
   * orderId — a portaria chama em seguida POST /orders/:id/payments/pix (público)
   * para gerar o QR, e faz o check-in automático quando o Pix aprovar.
   */
  @Post("pix")
  createPix(
    @Param("eventId") eventId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(pdvOrderSchema)) body: unknown,
  ) {
    return this.ordersService.createManualPixSale(eventId, userId, body as any);
  }
}
