import { createHmac, timingSafeEqual } from "crypto";
import {
  CardPaymentResult,
  CreateCardPaymentInput,
  CreatePixChargeInput,
  GatewayPaymentStatus,
  PaymentGateway,
  PixCharge,
  RefundInput,
  RefundResult,
  VerifiedWebhookEvent,
  WebhookHeaders,
  WebhookVerificationError,
} from "./types";

export const MOCK_PROVIDER = "mock";
export const MOCK_SIGNATURE_HEADER = "x-mock-signature";

function secret(): string {
  return process.env.MOCK_WEBHOOK_SECRET ?? "mock-webhook-secret-dev";
}

export function mockSignWebhookBody(rawBody: string, webhookSecret = secret()): string {
  return createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
}

interface MockWebhookBody {
  id: string;
  paymentExternalId: string;
  type: string;
  status: GatewayPaymentStatus;
  occurredAt?: string;
}

/**
 * Gateway simulado para desenvolvimento e testes.
 *
 * - `createPixCharge` gera um BR Code falso; a "aprovação" chega por webhook
 *   assinado com HMAC-SHA256 (header `x-mock-signature`), reproduzindo o fluxo
 *   real: criação de cobrança → webhook idempotente → emissão.
 * - Cartão: token terminado em `_fail` recusa; qualquer outro aprova na hora.
 */
export class MockGateway implements PaymentGateway {
  readonly provider = MOCK_PROVIDER;

  private readonly statuses = new Map<string, GatewayPaymentStatus>();

  async createPixCharge(input: CreatePixChargeInput): Promise<PixCharge> {
    const externalId = `mock_pix_${input.paymentId}`;
    this.statuses.set(externalId, "PENDING");
    return {
      externalId,
      qrCodeText: `00020126MOCKBR.GOV.BCB.PIX${input.paymentId}5204000053039865802BR6009BORA FEST`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async createCardPayment(input: CreateCardPaymentInput): Promise<CardPaymentResult> {
    const externalId = `mock_card_${input.paymentId}`;
    if (input.cardToken.endsWith("_fail")) {
      this.statuses.set(externalId, "FAILED");
      return { externalId, status: "FAILED", failReason: "Cartão recusado (simulado)" };
    }
    this.statuses.set(externalId, "PAID");
    return { externalId, status: "PAID" };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.statuses.set(input.externalId, "REFUNDED");
    return { externalId: input.externalId, status: "REFUNDED" };
  }

  async getStatus(externalId: string): Promise<GatewayPaymentStatus> {
    return this.statuses.get(externalId) ?? "PENDING";
  }

  verifyWebhook(headers: WebhookHeaders, rawBody: string): VerifiedWebhookEvent {
    const received = headers[MOCK_SIGNATURE_HEADER];
    const signature = Array.isArray(received) ? received[0] : received;
    if (!signature) {
      throw new WebhookVerificationError("Assinatura do webhook ausente");
    }

    const expected = mockSignWebhookBody(rawBody);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new WebhookVerificationError("Assinatura do webhook inválida");
    }

    let body: MockWebhookBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new WebhookVerificationError("Payload do webhook ilegível");
    }
    if (!body.id || !body.paymentExternalId || !body.status) {
      throw new WebhookVerificationError("Payload do webhook incompleto");
    }

    return {
      externalEventId: body.id,
      externalPaymentId: body.paymentExternalId,
      type: body.type ?? `payment.${body.status.toLowerCase()}`,
      status: body.status,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
      raw: body,
    };
  }
}
