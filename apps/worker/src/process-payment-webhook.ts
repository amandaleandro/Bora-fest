import { prisma, Prisma } from "@borafest/database";
import {
  applyGatewayStatus,
  getGateway,
  WebhookVerificationError,
  type WebhookHeaders,
} from "@borafest/payments";
import type { PaymentWebhookProcessingJobData } from "@borafest/queues";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "payment-webhook-worker" });

/**
 * Regras obrigatórias (arquitetura §11), agora executadas fora da requisição
 * do gateway:
 * - payload bruto SEMPRE armazenado (mesmo rejeitado) para auditoria;
 * - assinatura verificada antes de qualquer efeito;
 * - `payment_events` unique(provider, external_event_id) → processamento
 *   idempotente: evento duplicado é no-op;
 * - eventos fora de ordem tratados pela máquina de estados do pagamento.
 */
export async function processPaymentWebhookJob(data: PaymentWebhookProcessingJobData): Promise<void> {
  const { provider, rawBody } = data;
  const headers = data.headers as WebhookHeaders;
  const gateway = getGateway(provider);

  const delivery = await prisma.webhookDelivery.create({
    data: { provider, signatureValid: false, rawBody, headers },
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
      log.warn({ provider, error: error.message }, "assinatura de webhook inválida");
      return;
    }
    throw error;
  }

  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: { signatureValid: true, eventType: event.type, externalEventId: event.externalEventId },
  });

  const payment = await prisma.payment.findUnique({
    where: { provider_externalId: { provider, externalId: event.externalPaymentId } },
  });

  if (!payment) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "IGNORED", error: "Pagamento não encontrado para o evento" },
    });
    log.warn({ provider, externalPaymentId: event.externalPaymentId }, "webhook para pagamento desconhecido");
    return;
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
      return;
    }
    throw error;
  }

  try {
    const result = await applyGatewayStatus(payment.id, event.status, event.occurredAt);

    await prisma.paymentEvent.update({
      where: { provider_externalEventId: { provider, externalEventId: event.externalEventId } },
      data: { processedAt: new Date() },
    });
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });

    log.info({ paymentId: payment.id, status: event.status, ...result }, "webhook de pagamento processado");
  } catch (error) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", error: (error as Error).message },
    });
    throw error;
  }
}
