import { Body, Controller, Headers, Ip, Param, Post } from "@nestjs/common";
import { createCardPaymentSchema, createPixPaymentSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { RateLimit } from "../common/rate-limit.decorator";
import { PaymentsService } from "./payments.service";

@Controller("v1/orders/:orderId/payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("pix")
  // por PEDIDO (2026-09-13): 20/300s por IP era 4 QRs por minuto para a porta
  // INTEIRA atrás do mesmo Wi-Fi. Por pedido é mais estrito contra abuso e
  // ilimitado para a fila — um pedido legítimo gera poucos Pix.
  @RateLimit({ limit: 6, windowSeconds: 300, keyPrefix: "pay-pix", by: "params:orderId" })
  createPix(
    @Param("orderId") orderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(ZodBody(createPixPaymentSchema)) body: unknown,
  ) {
    return this.paymentsService.createPix(orderId, body as any, idempotencyKey);
  }

  /**
   * Checagem ATIVA no gateway (2026-08-14): o polling do checkout lia só o
   * banco e dependia do webhook — se o webhook atrasasse, a tela do Pix não
   * avançava e o comprador precisava clicar "Já fiz o pagamento". Este sync
   * consulta o gateway na hora e aplica o status (idempotente vs webhook).
   */
  @Post("sync")
  @RateLimit({ limit: 30, windowSeconds: 300, keyPrefix: "pay-sync" })
  sync(@Param("orderId") orderId: string) {
    return this.paymentsService.syncPendingPayment(orderId);
  }

  @Post("card")
  // tentativa de cartão é o vetor clássico de teste de cartão roubado
  @RateLimit({ limit: 10, windowSeconds: 300, keyPrefix: "pay-card" })
  createCard(
    @Param("orderId") orderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Ip() remoteIp: string,
    @Body(ZodBody(createCardPaymentSchema)) body: unknown,
  ) {
    return this.paymentsService.createCard(orderId, body as any, idempotencyKey, remoteIp);
  }
}
