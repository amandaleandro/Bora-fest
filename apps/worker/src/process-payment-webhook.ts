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

  // Idempotência POR EFEITO (auditoria 2026-08-12): o paymentEvent é o marcador
  // de dedupe, mas gravá-lo ANTES do efeito e tratar todo P2002 como "duplicado"
  // transformava entrega at-least-once em at-most-once — uma falha transitória
  // no efeito (deadlock/blip) marcava PROCESSED sem aplicar e o evento se perdia.
  // Regra correta: só é duplicado de verdade se já foi PROCESSADO (processedAt
  // preenchido). Se foi apenas VISTO (processedAt nulo, tentativa anterior que
  // falhou no efeito, ou o retry desta reordenação), REAPLICA.
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
      const existente = await prisma.paymentEvent.findUnique({
        where: { provider_externalEventId: { provider, externalEventId: event.externalEventId } },
        select: { processedAt: true },
      });
      if (existente?.processedAt) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: "PROCESSED", processedAt: new Date(), error: "Evento duplicado" },
        });
        return;
      }
      // visto mas não concluído → cai fora do catch e reaplica o efeito
    } else {
      throw error;
    }
  }

  try {
    // Status AUTORITATIVO: alguns provedores (Mercado Pago) só mandam o id no
    // webhook — o `status` vem como placeholder e o real é lido por getStatus.
    // Sem isto, estorno/chargeback do MP nunca era aplicado (a reconciliação só
    // reconsulta pagamentos abertos, jamais um PAID). Auditoria 2026-08-12.
    let statusEfetivo = event.status;
    if (event.resolveViaGetStatus && gateway.getStatus) {
      statusEfetivo = await gateway.getStatus(event.externalPaymentId);
    }

    const result = await applyGatewayStatus(payment.id, statusEfetivo, event.occurredAt);

    // WEBHOOK FORA DE ORDEM (auditoria 2026-08-12): um estorno/chargeback só
    // existe para um pagamento que FOI pago no gateway. Se chega REFUNDED/
    // CHARGEBACK mas o pagamento local ainda está aberto (o PAID não foi
    // processado — reordenação da fila / redelivery pós-deploy), aplicar seria
    // no-op silencioso e depois o PAID confirmaria o pedido com o dinheiro já
    // devolvido. Em vez disso, RELANÇA para retry: o PAID chega e é processado
    // primeiro, e no retry a reversão aplica sobre o PAID corretamente.
    const ehReversao = statusEfetivo === "REFUNDED" || statusEfetivo === "CHARGEBACK";
    if (ehReversao && !result.paymentChanged) {
      const atual = await prisma.payment.findUnique({
        where: { id: payment.id },
        select: { status: true },
      });
      if (atual && (atual.status === "PENDING" || atual.status === "AUTHORIZED")) {
        throw new Error(
          `Reversão (${statusEfetivo}) chegou antes do PAID do pagamento ${payment.id} — retry até o PAID processar`,
        );
      }
    }

    await prisma.paymentEvent.update({
      where: { provider_externalEventId: { provider, externalEventId: event.externalEventId } },
      data: { processedAt: new Date() },
    });
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });

    log.info({ paymentId: payment.id, status: statusEfetivo, ...result }, "webhook de pagamento processado");
  } catch (error) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", error: (error as Error).message },
    });
    // deixa o retry da fila re-tentar (idempotente: o paymentEvent já existe,
    // mas o efeito não foi aplicado). Sobe o erro para o BullMQ reenfileirar.
    throw error;
  }
}
