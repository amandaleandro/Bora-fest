import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { prisma, Prisma } from "@borafest/database";
import {
  applyGatewayStatus,
  getGateway,
  UnknownGatewayError,
  WebhookVerificationError,
  type WebhookHeaders,
} from "@borafest/payments";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "payment-webhooks" });

@Injectable()
export class WebhooksService {
  /**
   * Regras obrigatórias (arquitetura §11):
   * - payload bruto SEMPRE armazenado (mesmo rejeitado) para auditoria;
   * - assinatura verificada antes de qualquer efeito;
   * - `payment_events` unique(provider, external_event_id) → processamento
   *   idempotente: webhook duplicado responde 200 sem efeito;
   * - eventos fora de ordem tratados pela máquina de estados do pagamento.
   */
  async handlePaymentWebhook(provider: string, headers: WebhookHeaders, rawBody: string) {
    let gateway;
    try {
      gateway = getGateway(provider);
    } catch (error) {
      if (error instanceof UnknownGatewayError) {
        throw new NotFoundException("Provedor de pagamento desconhecido");
      }
      throw error;
    }

    const delivery = await prisma.webhookDelivery.create({
      data: {
        provider,
        signatureValid: false,
        rawBody,
        headers: this.sanitizeHeaders(headers),
      },
    });

    let event;
    try {
      event = gateway.verifyWebhook(headers, rawBody);
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: "IGNORED", error: error.message },
        });
        throw new UnauthorizedException("Assinatura do webhook inválida");
      }
      throw error;
    }

    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        signatureValid: true,
        eventType: event.type,
        externalEventId: event.externalEventId,
      },
    });

    const payment = await prisma.payment.findUnique({
      where: {
        provider_externalId: { provider, externalId: event.externalPaymentId },
      },
    });

    if (!payment) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "IGNORED", error: "Pagamento não encontrado para o evento" },
      });
      log.warn(
        { provider, externalPaymentId: event.externalPaymentId },
        "webhook para pagamento desconhecido",
      );
      return { received: true, ignored: true };
    }

    try {
      await prisma.paymentEvent.create({
        data: {
          paymentId: payment.id,
          provider,
          externalEventId: event.externalEventId,
          type: event.type,
          payload: event.raw as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: "PROCESSED", processedAt: new Date(), error: "Evento duplicado" },
        });
        return { received: true, duplicate: true };
      }
      throw error;
    }

    try {
      const result = await applyGatewayStatus(payment.id, event.status, event.occurredAt);

      await prisma.paymentEvent.update({
        where: {
          provider_externalEventId: { provider, externalEventId: event.externalEventId },
        },
        data: { processedAt: new Date() },
      });
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "PROCESSED", processedAt: new Date() },
      });

      log.info(
        { paymentId: payment.id, status: event.status, ...result },
        "webhook de pagamento processado",
      );
      return { received: true };
    } catch (error) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", error: (error as Error).message },
      });
      throw error;
    }
  }

  /** Nunca persistir credenciais dos headers. */
  private sanitizeHeaders(headers: WebhookHeaders): Prisma.InputJsonValue {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === "authorization" || key.toLowerCase() === "cookie") continue;
      out[key] = Array.isArray(value) ? value.join(",") : (value ?? "");
    }
    return out;
  }
}
