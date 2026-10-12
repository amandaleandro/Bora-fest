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
  | "CHARGEBACK"
  /**
   * Contestação do cartão decidida A FAVOR da plataforma (2026-10-12) — ex.:
   * Asaas AWAITING_CHARGEBACK_REVERSAL ("disputa vencida"). Só nasce de sinal
   * explícito do provedor ou da revisão periódica dos chargebacks (status
   * ATUAL no gateway), nunca de um "pago" atrasado: um PAYMENT_CONFIRMED
   * velho chegando depois do chargeback não pode devolver o dinheiro ao
   * produtor.
   */
  | "CHARGEBACK_REVERSED";

/**
 * Foto de uma cobrança no gateway (2026-10-12): o status e, quando o
 * provedor informa, o valor REALMENTE pago — é o que permite conferir se
 * entrou menos do que o cobrado antes de marcar o pedido como pago.
 */
export interface GatewayPaymentSnapshot {
  status: GatewayPaymentStatus;
  /**
   * Valor pago em centavos. Só vem quando a cobrança está paga E o provedor
   * informa o total da compra (ex.: no Asaas, cartão parcelado traz o valor de
   * UMA parcela — aí fica ausente). Ausente = sem conferência.
   */
  paidAmountCents?: number;
}

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
  /** texto que o pagador vê no comprovante (ex.: "Ingresso {evento} · BoraFest") */
  description?: string;
}

export interface PixCharge {
  externalId: string;
  /** Pix copia-e-cola (BR Code) */
  qrCodeText: string;
  expiresAt: Date;
}

/**
 * Dados crus do cartão — usados APENAS por gateways cujo modelo oficial é
 * server-side (Asaas): trafegam do checkout à API por HTTPS, vão direto ao
 * PSP e NUNCA são logados nem persistidos.
 */
export interface RawCard {
  number: string;
  holderName: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
  holderInfo: {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    phone?: string;
  };
}

export interface CreateCardPaymentInput {
  paymentId: string;
  orderId: string;
  amountCents: number;
  /** token do provedor (Pagar.me/mock) — OU rawCard para gateways server-side */
  cardToken?: string;
  rawCard?: RawCard;
  /** IP do comprador (antifraude do PSP — obrigatório no Asaas) */
  remoteIp?: string;
  installments: number;
  customer: GatewayCustomer;
  /** texto que o pagador vê na fatura/comprovante */
  description?: string;
  idempotencyKey: string;
}

export interface CardPaymentResult {
  externalId: string;
  status: Extract<GatewayPaymentStatus, "AUTHORIZED" | "PAID" | "FAILED">;
  failReason?: string;
  /** valor pago informado pelo gateway na própria resposta (ver GatewayPaymentSnapshot) */
  paidAmountCents?: number;
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
  /**
   * O corpo do webhook NÃO traz o status definitivo (ex.: Mercado Pago só manda
   * o id) — quem resolve é `getStatus` no processador. Sem isso, o `status`
   * acima é um placeholder "PENDING" e um estorno/chargeback do MP jamais seria
   * aplicado (auditoria 2026-08-12).
   */
  resolveViaGetStatus?: boolean;
  /**
   * Valor pago informado no CORPO do webhook, em centavos (2026-10-12) — só
   * quando o evento é de pagamento e o provedor manda o total. Ausente = o
   * processador consulta o gateway (getPaymentSnapshot) ou segue sem conferir.
   */
  paidAmountCents?: number;
}

export class WebhookVerificationError extends Error {}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface PixTransferInput {
  amountCents: number;
  pixKey: string;
  description: string;
  /** referência idempotente nossa (id do Payout) — auditoria e anti-duplicidade */
  externalReference: string;
}

export interface PixTransferResult {
  externalId: string;
  status: "DONE" | "PENDING" | "FAILED";
  failReason?: string;
}

export interface PaymentGateway {
  readonly provider: string;
  /**
   * O provedor EXIGE o CPF/CNPJ do pagador para emitir a cobrança Pix?
   *
   * Isto é característica do GATEWAY, não do Pix (2026-09-11). O Asaas recusa
   * a cobrança sem cpfCnpj do customer — foi o que derrubou o Pix da porta no
   * Hello World. O Mercado Pago emite sem documento nenhum. A regra estava
   * escrita na venda do balcão como se valesse para todo Pix, e por isso o
   * operador era obrigado a digitar o CPF de um terceiro na fila.
   *
   * Ausente = não exige.
   */
  readonly pixRequiresPayerDocument?: boolean;
  createPixCharge(input: CreatePixChargeInput): Promise<PixCharge>;
  createCardPayment(input: CreateCardPaymentInput): Promise<CardPaymentResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  getStatus(externalId: string): Promise<GatewayPaymentStatus>;
  /**
   * Mesma consulta do getStatus, devolvendo também o valor pago (2026-10-12).
   * Opcional: gateway sem ela segue sem conferência de valor.
   */
  getPaymentSnapshot?(externalId: string): Promise<GatewayPaymentSnapshot>;
  /** Verifica assinatura e normaliza o evento; lança WebhookVerificationError se inválido. */
  verifyWebhook(headers: WebhookHeaders, rawBody: string): VerifiedWebhookEvent;
  /** Pix de SAÍDA (repasse ao produtor). Opcional: nem todo provedor suporta. */
  transferPix?(input: PixTransferInput): Promise<PixTransferResult>;
  /** Status de uma transferência já criada (conciliação do repasse). */
  getTransferStatus?(externalId: string): Promise<PixTransferResult>;
}
