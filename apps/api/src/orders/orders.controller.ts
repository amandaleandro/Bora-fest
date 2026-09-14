import { Body, Controller, Get, Headers, Param, Post, UseGuards } from "@nestjs/common";
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

  /**
   * "Este pedido é meu": traz para a conta logada um pedido preso em conta-
   * fantasma (e-mail digitado errado no checkout). Exige SESSÃO — a posse do
   * link sozinha não pode mover pedido entre contas.
   */
  @Post(":publicToken/claim")
  @UseGuards(SessionGuard)
  @RateLimit({ limit: 5, windowSeconds: 3600, keyPrefix: "order-claim", by: "params:publicToken" })
  claim(@Param("publicToken") publicToken: string, @CurrentUserId() userId: string) {
    return this.ordersService.claimOrder(publicToken, userId);
  }

  @Post()
  create(
    @OptionalUserId() userId: string | undefined,
    @Body(ZodBody(createOrderSchema)) body: unknown,
  ) {
    return this.ordersService.createFromReservation(userId, body as any);
  }

  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "order-status", by: "params:publicToken" })
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

  /**
   * Lotes que o BALCÃO pode vender (2026-08-31): inclui os "só balcão"
   * (cortesia de novatos), que a availability pública esconde de propósito.
   * Exige SALES_PERFORM — mesmo portão da venda.
   */
  @RateLimit({ limit: 240, windowSeconds: 60, keyPrefix: "pdv-read", by: "session" })
  @Get("lots")
  listLots(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.ordersService.listPdvLots(eventId, userId);
  }

  /**
   * O que a tela da porta precisa saber ANTES de vender (2026-09-11). Hoje:
   * se o provedor de Pix exige CPF do pagador — decide se o campo aparece.
   * Uma chamada por sessão, não por venda.
   */
  @RateLimit({ limit: 240, windowSeconds: 60, keyPrefix: "pdv-read", by: "session" })
  @Get("config")
  config(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.ordersService.getPdvConfig(eventId, userId);
  }

  /**
   * Fechamento de caixa da porta: quanto cada vendedor tem EM DINHEIRO para
   * acertar com a produção. Vendedor vê o próprio; finance:view vê todos.
   */
  @RateLimit({ limit: 240, windowSeconds: 60, keyPrefix: "pdv-read", by: "session" })
  @Get("fechamento")
  fechamento(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.ordersService.getPdvFechamento(eventId, userId);
  }

  /** ingressos de um pedido do balcão, pro check-in automático do vendedor */
  @RateLimit({ limit: 240, windowSeconds: 60, keyPrefix: "pdv-read", by: "session" })
  @Get(":orderId/tickets")
  orderTickets(
    @Param("eventId") eventId: string,
    @Param("orderId") orderId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.ordersService.getPdvOrderTickets(eventId, orderId, userId);
  }

  @Post(":publicToken/correct-email")
  correctEmail(@Param("publicToken") publicToken: string, @Body() body: { email?: string }) {
    return this.ordersService.correctEmail(publicToken, body?.email ?? "");
  }

  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "pdv-sale", by: "session" })
  @Post()
  create(
    @Param("eventId") eventId: string,
    @CurrentUserId() userId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(ZodBody(pdvOrderSchema)) body: unknown,
  ) {
    return this.ordersService.createManualSale(eventId, userId, body as any, idempotencyKey);
  }

  /** cancela um Pix da porta ainda pendente: devolve a vaga e fecha a cobrança */
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "pdv-sale", by: "session" })
  @Post(":orderId/cancel")
  cancelPending(
    @Param("eventId") eventId: string,
    @Param("orderId") orderId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.ordersService.cancelPdvPendingSale(eventId, userId, orderId);
  }

  /**
   * Venda na porta modo PIX: cria o pedido PENDENTE (não pago) e devolve o
   * orderId — a portaria chama em seguida POST /orders/:id/payments/pix (público)
   * para gerar o QR, e faz o check-in automático quando o Pix aprovar.
   */
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "pdv-sale", by: "session" })
  @Post("pix")
  createPix(
    @Param("eventId") eventId: string,
    @CurrentUserId() userId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(ZodBody(pdvOrderSchema)) body: unknown,
  ) {
    return this.ordersService.createManualPixSale(eventId, userId, body as any, idempotencyKey);
  }
}
