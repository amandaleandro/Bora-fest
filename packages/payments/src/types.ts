/**
 * Interface de gateway de pagamento (arquitetura §11).
 *
 * Toda comunicação com adquirentes/gateways passa por aqui, permitindo trocar
 * ou combinar provedores (primário + fallback) sem tocar em pedidos, reservas
 * ou emissão de ingressos.
 */

export type GatewayPaymentStatus =
  | "PENDING"
  | "AUTHORIZED"
  | "PAID"
  | "FAILED"
  | "CANCELED"
  | "EXPIRED"
  | "REFUNDED"
  | "CHARGEBACK";

export interface GatewayCustomer {
  name?: string;
  email: string;
  document?: string;
  /** celular com DDD, só dígitos (ex.: 11999998888) — exigido p/ Pix em alguns PSPs */
  phone?: string;
}

export interface CreatePixChargeInput {
  /** id interno do pagamento (Payment.id) — vira referência no gateway */
  paymentId: string;
  orderId: string;
  amountCents: number;
  customer: GatewayCustomer;
  expiresInSeconds: number;
  /** repassada ao gateway para criação idempotente */
  idempotencyKey: string;
}

export interface PixCharge {
  externalId: string;
  /** Pix copia-e-cola (BR Code) */
  qrCodeText: string;
  expiresAt: Date;
}

export interface CreateCardPaymentInput {
  paymentId: string;
  orderId: string;
  amountCents: number;
  /** cartão SEMPRE tokenizado pelo provedor — nunca PAN cru (escopo PCI) */
  cardToken: string;
  installments: number;
  customer: GatewayCustomer;
  idempotencyKey: string;
}

export interface CardPaymentResult {
  externalId: string;
  status: Extract<GatewayPaymentStatus, "AUTHORIZED" | "PAID" | "FAILED">;
  failReason?: string;
}

export interface RefundInput {
  externalId: string;
  /** ausente = estorno total */
  amountCents?: number;
  idempotencyKey: string;
}

export interface RefundResult {
  externalId: string;
  status: Extract<GatewayPaymentStatus, "REFUNDED" | "PENDING" | "FAILED">;
}

/** Evento já verificado (assinatura conferida) e normalizado de um webhook. */
export interface VerifiedWebhookEvent {
  externalEventId: string;
  externalPaymentId: string;
  type: string;
  status: GatewayPaymentStatus;
  occurredAt?: Date;
  raw: unknown;
}

export class WebhookVerificationError extends Error {}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface PaymentGateway {
  readonly provider: string;
  createPixCharge(input: CreatePixChargeInput): Promise<PixCharge>;
  createCardPayment(input: CreateCardPaymentInput): Promise<CardPaymentResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  getStatus(externalId: string): Promise<GatewayPaymentStatus>;
  /** Verifica assinatura e normaliza o evento; lança WebhookVerificationError se inválido. */
  verifyWebhook(headers: WebhookHeaders, rawBody: string): VerifiedWebhookEvent;
}
