import { randomUUID } from "node:crypto";
import { prisma, Prisma, type VipPaymentRow } from "@borafest/database";
import {
  applyGatewayStatus,
  applyVipGatewayStatus,
  applyStoreGatewayStatus,
  getGateway,
  stripSecretHeaders,
  WebhookVerificationError,
  type GatewayPaymentStatus,
  type WebhookHeaders,
} from "@borafest/payments";
import type { PaymentWebhookProcessingJobData } from "@borafest/queues";
import { withContext } from "@borafest/observability";

const log = withContext({ module: "payment-webhook-worker" });

type VipStatusRow = { status: string };
type VipEventRow = { processedAt: Date | null };

async function findVipPayment(provider: string, externalId: string): Promise<VipPaymentRow | null> {
  const rows = await prisma.$queryRaw<VipPaymentRow[]>`
    SELECT
      id,
      vip_reservation_id AS "vipReservationId",
      provider,
      method,
      status,
      amount_cents AS "amountCents",
      external_id AS "externalId",
      pix_qr_code_text AS "pixQrCodeText",
      fail_reason AS "failReason",
      expires_at AS "expiresAt",
      paid_at AS "paidAt",
      metadata,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM vip_payments
    WHERE provider = ${provider} AND external_id = ${externalId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function recordVipEvent(
  paymentId: string,
  provider: string,
  externalEventId: string,
  type: string,
  raw: unknown,
): Promise<"NEW" | "RETRY" | "DUPLICATE"> {
  const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO vip_payment_events (
      id, vip_payment_id, provider, external_event_id, type, payload, created_at
    ) VALUES (
      ${randomUUID()}::uuid,
      ${paymentId}::uuid,
      ${provider},
      ${externalEventId},
      ${type},
      ${JSON.stringify(raw ?? {})}::jsonb,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (provider, external_event_id) DO NOTHING
    RETURNING id
  `;
  if (inserted.length > 0) return "NEW";

  const existing = await prisma.$queryRaw<VipEventRow[]>`
    SELECT processed_at AS "processedAt"
    FROM vip_payment_events
    WHERE provider = ${provider} AND external_event_id = ${externalEventId}
    LIMIT 1
  `;
  return existing[0]?.processedAt ? "DUPLICATE" : "RETRY";
}

async function markVipEventProcessed(provider: string, externalEventId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE vip_payment_events
    SET processed_at = CURRENT_TIMESTAMP
    WHERE provider = ${provider} AND external_event_id = ${externalEventId}
  `;
}

async function vipPaymentStatus(paymentId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<VipStatusRow[]>`
    SELECT status::text AS status FROM vip_payments WHERE id = ${paymentId}::uuid LIMIT 1
  `;
  return rows[0]?.status ?? null;
}

function isReversal(status: GatewayPaymentStatus): boolean {
  return status === "REFUNDED" || status === "CHARGEBACK";
}

/**
 * Entrada única de webhook para pagamentos de ingresso e VIP.
 * A entrega é autenticada/auditada uma única vez; depois o pagamento é
 * localizado no domínio correto e a respectiva máquina de estados aplica o efeito.
 */
export async function processPaymentWebhookJob(data: PaymentWebhookProcessingJobData): Promise<void> {
  const { provider, rawBody } = data;
  const headers = data.headers as WebhookHeaders;
  const gateway = getGateway(provider);

  const delivery = await prisma.webhookDelivery.create({
    data: { provider, signatureValid: false, rawBody, headers: stripSecretHeaders(headers) },
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
  const vipPayment = payment ? null : await findVipPayment(provider, event.externalPaymentId);
  const storePayment =
    payment || vipPayment
      ? null
      : await prisma.storePayment.findUnique({
          where: {
            provider_externalId: { provider, externalId: event.externalPaymentId },
          },
        });

  if (!payment && !vipPayment && !storePayment) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "IGNORED", error: "Pagamento não encontrado para o evento" },
    });
    log.warn({ provider, externalPaymentId: event.externalPaymentId }, "webhook para pagamento desconhecido");
    return;
  }

  if (vipPayment) {
    const eventState = await recordVipEvent(
      vipPayment.id,
      provider,
      event.externalEventId,
      event.type,
      event.raw,
    );
    if (eventState === "DUPLICATE") {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "PROCESSED", processedAt: new Date(), error: "Evento VIP duplicado" },
      });
      return;
    }

    try {
      let effectiveStatus = event.status;
      if (event.resolveViaGetStatus) {
        effectiveStatus = await gateway.getStatus(event.externalPaymentId);
      }

      const result = await applyVipGatewayStatus(vipPayment.id, effectiveStatus, event.occurredAt);
      if (isReversal(effectiveStatus) && !result.paymentChanged) {
        const current = await vipPaymentStatus(vipPayment.id);
        if (current === "PENDING" || current === "AUTHORIZED") {
          throw new Error(
            `Reversão VIP (${effectiveStatus}) chegou antes do PAID do pagamento ${vipPayment.id}`,
          );
        }
      }

      await markVipEventProcessed(provider, event.externalEventId);
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "PROCESSED", processedAt: new Date() },
      });
      log.info(
        { vipPaymentId: vipPayment.id, status: effectiveStatus, ...result },
        "webhook de pagamento VIP processado",
      );
      return;
    } catch (error) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", error: (error as Error).message },
      });
      throw error;
    }
  }

  if (storePayment) {
    try {
      const existing = await prisma.storePaymentEvent.findUnique({
        where: {
          provider_externalEventId: {
            provider,
            externalEventId: event.externalEventId,
          },
        },
        select: { processedAt: true },
      });
      if (existing?.processedAt) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "PROCESSED",
            processedAt: new Date(),
            error: "Evento da Loja duplicado",
          },
        });
        return;
      }

      if (!existing) {
        await prisma.storePaymentEvent.create({
          data: {
            storePaymentId: storePayment.id,
            provider,
            externalEventId: event.externalEventId,
            type: event.type,
            payload: event.raw as Prisma.InputJsonValue,
          },
        });
      }

      let effectiveStatus = event.status;
      if (event.resolveViaGetStatus) {
        effectiveStatus = await gateway.getStatus(event.externalPaymentId);
      }

      const result = await applyStoreGatewayStatus(
        storePayment.id,
        effectiveStatus,
        event.occurredAt,
      );

      if (isReversal(effectiveStatus) && !result.paymentChanged) {
        const current = await prisma.storePayment.findUnique({
          where: { id: storePayment.id },
          select: { status: true },
        });
        if (current && (current.status === "PENDING" || current.status === "AUTHORIZED")) {
          throw new Error(
            `Reversão da Loja (${effectiveStatus}) chegou antes do PAID do pagamento ${storePayment.id}`,
          );
        }
      }

      await prisma.storePaymentEvent.update({
        where: {
          provider_externalEventId: {
            provider,
            externalEventId: event.externalEventId,
          },
        },
        data: { processedAt: new Date() },
      });
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "PROCESSED", processedAt: new Date() },
      });
      log.info(
        { storePaymentId: storePayment.id, status: effectiveStatus, ...result },
        "webhook de pagamento da Loja processado",
      );
      return;
    } catch (error) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", error: (error as Error).message },
      });
      throw error;
    }
  }

  // Ticketing mantém exatamente a semântica já auditada: marcador de evento
  // pode existir sem processedAt após falha e, nesse caso, o retry reaplica o efeito.
  try {
    await prisma.paymentEvent.create({
      data: {
        paymentId: payment!.id,
        provider,
        externalEventId: event.externalEventId,
        type: event.type,
        payload: event.raw as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.paymentEvent.findUnique({
        where: { provider_externalEventId: { provider, externalEventId: event.externalEventId } },
        select: { processedAt: true },
      });
      if (existing?.processedAt) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: "PROCESSED", processedAt: new Date(), error: "Evento duplicado" },
        });
        return;
      }
    } else {
      throw error;
    }
  }

  try {
    let effectiveStatus = event.status;
    if (event.resolveViaGetStatus) {
      effectiveStatus = await gateway.getStatus(event.externalPaymentId);
    }

    const result = await applyGatewayStatus(payment!.id, effectiveStatus, event.occurredAt);
    if (isReversal(effectiveStatus) && !result.paymentChanged) {
      const current = await prisma.payment.findUnique({
        where: { id: payment!.id },
        select: { status: true },
      });
      if (current && (current.status === "PENDING" || current.status === "AUTHORIZED")) {
        throw new Error(
          `Reversão (${effectiveStatus}) chegou antes do PAID do pagamento ${payment!.id} — retry até o PAID processar`,
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
    log.info({ paymentId: payment!.id, status: effectiveStatus, ...result }, "webhook de pagamento processado");
  } catch (error) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", error: (error as Error).message },
    });
    throw error;
  }
}
