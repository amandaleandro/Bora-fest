import { timingSafeEqual } from "crypto";
import {
  CardPaymentResult,
  PixTransferInput,
  PixTransferResult,
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
import { CircuitBreaker, fetchWithTimeout } from "./resilience";

export const ASAAS_PROVIDER = "asaas";

// produção: https://api.asaas.com/v3 · sandbox: https://api-sandbox.asaas.com/v3
const DEFAULT_API_URL = "https://api.asaas.com/v3";
const REQUEST_TIMEOUT_MS = 8_000;

const circuitBreaker = new CircuitBreaker({
  provider: ASAAS_PROVIDER,
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
});

export class AsaasApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Asaas respondeu ${status}`);
  }
}

interface AsaasPayment {
  id: string;
  status: string;
  externalReference?: string;
  value?: number;
}

interface AsaasErrorBody {
  errors?: Array<{ code?: string; description?: string }>;
}

/**
 * Adapter Asaas (decisão 2026-07-28, ver PESQUISA-GATEWAYS-RODADA2-CUSTO.md):
 * cartão online 2,99% + R$0,49 (D+32), Pix R$1,99 fixo, Conta Escrow com
 * liberação controlada pela plataforma e KYC das subcontas pelo PSP.
 *
 * Cobranças via /payments (valores em REAIS decimais — conversão de centavos
 * aqui dentro, nunca fora). Cada cobrança cria/reaproveita um customer Asaas.
 * O Asaas não tem header de idempotência: usamos externalReference =
 * Payment.id interno e o applyGatewayStatus idempotente como defesa.
 *
 * Webhook: token fixo configurado no painel Asaas, enviado no header
 * `asaas-access-token` — comparação em tempo constante, fail closed.
 *
 * Env: ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN, ASAAS_API_URL (opcional).
 */
export class AsaasGateway implements PaymentGateway {
  readonly provider = ASAAS_PROVIDER;

  async createPixCharge(input: CreatePixChargeInput): Promise<PixCharge> {
    const customerId = await this.ensureCustomer(input.customer, input.orderId);

    const payment = await this.request<AsaasPayment>("POST", "/payments", {
      customer: customerId,
      billingType: "PIX",
      value: toReais(input.amountCents),
      dueDate: isoDate(new Date()),
      description: input.description ?? "Ingressos BoraFest",
      externalReference: input.paymentId,
    });

    const qr = await this.request<{ payload?: string; expirationDate?: string }>(
      "GET",
      `/payments/${payment.id}/pixQrCode`,
    );
    if (!qr.payload) {
      throw new AsaasApiError(502, qr, "Resposta do Asaas sem QR Code Pix");
    }

    return {
      externalId: payment.id,
      qrCodeText: qr.payload,
      // o vencimento local do pedido (30 min) governa a expiração; a data do
      // Asaas é o teto — usamos a menor das duas
      expiresAt: qr.expirationDate
        ? new Date(
            Math.min(
              new Date(qr.expirationDate).getTime(),
              Date.now() + input.expiresInSeconds * 1000,
            ),
          )
        : new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async createCardPayment(input: CreateCardPaymentInput): Promise<CardPaymentResult> {
    const customerId = await this.ensureCustomer(input.customer, input.orderId);

    let payment: AsaasPayment;
    try {
      payment = await this.request<AsaasPayment>("POST", "/payments", {
        customer: customerId,
        billingType: "CREDIT_CARD",
        value: toReais(input.amountCents),
        dueDate: isoDate(new Date()),
        description: input.description ?? "Ingressos BoraFest",
        externalReference: input.paymentId,
        installmentCount: input.installments > 1 ? input.installments : undefined,
        installmentValue:
          input.installments > 1
            ? toReais(Math.round(input.amountCents / input.installments))
            : undefined,
        ...(input.rawCard
          ? {
              creditCard: {
                holderName: input.rawCard.holderName,
                number: input.rawCard.number.replace(/\D/g, ""),
                expiryMonth: input.rawCard.expiryMonth,
                expiryYear: input.rawCard.expiryYear,
                ccv: input.rawCard.ccv,
              },
              creditCardHolderInfo: {
                name: input.rawCard.holderInfo.name,
                email: input.rawCard.holderInfo.email,
                cpfCnpj: input.rawCard.holderInfo.cpfCnpj.replace(/\D/g, ""),
                postalCode: input.rawCard.holderInfo.postalCode.replace(/\D/g, ""),
                addressNumber: input.rawCard.holderInfo.addressNumber,
                ...(input.rawCard.holderInfo.phone
                  ? { phone: input.rawCard.holderInfo.phone.replace(/\D/g, "") }
                  : {}),
              },
              ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
            }
          : { creditCardToken: input.cardToken }),
      });
    } catch (error) {
      // cartão recusado volta como 400 com lista de erros — não é falha nossa
      if (error instanceof AsaasApiError && error.status === 400) {
        const body = error.body as AsaasErrorBody;
        return {
          externalId: `asaas_recusado_${input.paymentId}`,
          status: "FAILED",
          failReason: body.errors?.[0]?.description ?? "Cartão recusado",
        };
      }
      throw error;
    }

    const status = mapAsaasStatus(payment.status);
    if (status === "PAID") return { externalId: payment.id, status: "PAID" };
    if (status === "AUTHORIZED") return { externalId: payment.id, status: "AUTHORIZED" };
    if (status === "PENDING") {
      // análise de risco do Asaas — o webhook resolve; reportamos AUTHORIZED
      // para o pedido aguardar em vez de reprovar
      return { externalId: payment.id, status: "AUTHORIZED" };
    }
    return {
      externalId: payment.id,
      status: "FAILED",
      failReason: `Cobrança ${payment.status}`,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const payment = await this.request<AsaasPayment>(
      "POST",
      `/payments/${input.externalId}/refund`,
      input.amountCents !== undefined ? { value: toReais(input.amountCents) } : {},
    );

    const status = mapAsaasStatus(payment.status);
    return {
      externalId: input.externalId,
      status: status === "REFUNDED" ? "REFUNDED" : status === "FAILED" ? "FAILED" : "PENDING",
    };
  }

  async getStatus(externalId: string): Promise<GatewayPaymentStatus> {
    const payment = await this.request<AsaasPayment>("GET", `/payments/${externalId}`);
    return mapAsaasStatus(payment.status);
  }

  verifyWebhook(headers: WebhookHeaders, rawBody: string): VerifiedWebhookEvent {
    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    if (!expected) {
      // fail closed: sem token configurado, nenhum webhook é aceito
      throw new WebhookVerificationError(
        "Verificação do webhook Asaas não configurada (defina ASAAS_WEBHOOK_TOKEN)",
      );
    }
    const raw = headers["asaas-access-token"];
    const received = Array.isArray(raw) ? raw[0] : raw;
    if (!received) throw new WebhookVerificationError("Webhook Asaas sem asaas-access-token");
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new WebhookVerificationError("Token do webhook Asaas inválido");
    }

    let body: { id?: string; event?: string; payment?: { id?: string; status?: string } };
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new WebhookVerificationError("Payload do webhook Asaas ilegível");
    }
    if (!body.event || !body.payment?.id) {
      throw new WebhookVerificationError("Payload do webhook Asaas incompleto");
    }

    return {
      // nem todo evento traz id próprio — o par (evento, cobrança) é único o
      // suficiente para o dedupe de payment_events
      externalEventId: body.id ?? `${body.event}:${body.payment.id}`,
      externalPaymentId: body.payment.id,
      type: body.event,
      status: mapAsaasWebhookEvent(body.event, body.payment.status),
      raw: body,
    };
  }

  /**
   * Pix de SAÍDA (repasse automático ao produtor). externalReference = id do
   * Payout — auditável no extrato do Asaas. Tipo da chave é detectado.
   */
  async transferPix(input: PixTransferInput): Promise<PixTransferResult> {
    const transfer = await this.request<{ id: string; status: string; failReason?: string }>(
      "POST",
      "/transfers",
      {
        value: toReais(input.amountCents),
        operationType: "PIX",
        pixAddressKey: input.pixKey.trim(),
        pixAddressKeyType: detectPixKeyType(input.pixKey),
        description: input.description,
        externalReference: input.externalReference,
      },
    );
    return {
      externalId: transfer.id,
      status: mapTransferStatus(transfer.status),
      failReason: transfer.failReason,
    };
  }

  async getTransferStatus(externalId: string): Promise<PixTransferResult> {
    const transfer = await this.request<{ id: string; status: string; failReason?: string }>(
      "GET",
      `/transfers/${externalId}`,
    );
    return {
      externalId: transfer.id,
      status: mapTransferStatus(transfer.status),
      failReason: transfer.failReason,
    };
  }

  // -------------------------------------------------------------------------

  /** Cria o customer da cobrança (Asaas exige um id de customer por payment). */
  private async ensureCustomer(
    customer: { name?: string; email: string; document?: string; phone?: string },
    orderId: string,
  ): Promise<string> {
    const cpfCnpj = customer.document?.replace(/\D/g, "");
    let phone = customer.phone?.replace(/\D/g, "");
    if (phone && phone.length > 11 && phone.startsWith("55")) phone = phone.slice(2);

    const created = await this.request<{ id: string }>("POST", "/customers", {
      name: customer.name ?? customer.email,
      email: customer.email,
      ...(cpfCnpj ? { cpfCnpj } : {}),
      ...(phone && phone.length >= 10 ? { mobilePhone: phone } : {}),
      externalReference: orderId,
      notificationDisabled: true, // quem fala com o comprador somos nós
    });
    return created.id;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const apiKey = process.env.ASAAS_API_KEY;
    if (!apiKey) throw new Error("ASAAS_API_KEY is not set");
    const apiUrl = process.env.ASAAS_API_URL ?? DEFAULT_API_URL;

    const response = await circuitBreaker.execute(() =>
      fetchWithTimeout(
        `${apiUrl}${path}`,
        {
          method,
          headers: {
            access_token: apiKey,
            "content-type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        REQUEST_TIMEOUT_MS,
      ),
    );

    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!response.ok) {
      throw new AsaasApiError(response.status, json);
    }
    return json as T;
  }
}

function toReais(amountCents: number): number {
  return Math.round(amountCents) / 100;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function mapAsaasStatus(status: string): GatewayPaymentStatus {
  switch (status) {
    case "RECEIVED":
    case "CONFIRMED": // cartão aprovado (liquidação D+32 é problema do caixa, não do pedido)
    case "RECEIVED_IN_CASH":
      return "PAID";
    case "PENDING":
    case "AWAITING_RISK_ANALYSIS":
      return "PENDING";
    case "OVERDUE":
      return "EXPIRED";
    case "REFUNDED":
      return "REFUNDED";
    case "REFUND_REQUESTED":
    case "REFUND_IN_PROGRESS":
      // ainda não devolvido — o webhook PAYMENT_REFUNDED conclui
      return "PAID";
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
    case "AWAITING_CHARGEBACK_REVERSAL":
      return "CHARGEBACK";
    default:
      return "PENDING";
  }
}

export function mapAsaasWebhookEvent(event: string, paymentStatus?: string): GatewayPaymentStatus {
  switch (event) {
    case "PAYMENT_RECEIVED":
    case "PAYMENT_CONFIRMED":
      return "PAID";
    case "PAYMENT_REFUNDED":
      return "REFUNDED";
    case "PAYMENT_CHARGEBACK_REQUESTED":
    case "PAYMENT_CHARGEBACK_DISPUTE":
      return "CHARGEBACK";
    case "PAYMENT_OVERDUE":
      return "EXPIRED";
    case "PAYMENT_DELETED":
      return "CANCELED";
    default:
      // eventos informativos (PAYMENT_CREATED, PAYMENT_UPDATED etc.)
      return paymentStatus ? mapAsaasStatus(paymentStatus) : "PENDING";
  }
}

/** DONE/CANCELLED/FAILED do Asaas → nosso trinário de repasse. */
export function mapTransferStatus(status: string): "DONE" | "PENDING" | "FAILED" {
  switch (status) {
    case "DONE":
      return "DONE";
    case "CANCELLED":
    case "FAILED":
      return "FAILED";
    default:
      // PENDING / BANK_PROCESSING — concilia depois
      return "PENDING";
  }
}

/** Detecta o tipo da chave Pix (o Asaas exige o tipo junto da chave). */
export function detectPixKeyType(key: string): "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP" {
  const raw = key.trim();
  if (raw.includes("@")) return "EMAIL";
  const digits = raw.replace(/\D/g, "");
  if (/^\+?55\d{10,11}$/.test(raw.replace(/[\s()-]/g, "")) || (raw.startsWith("+") && digits.length >= 12)) {
    return "PHONE";
  }
  if (digits.length === 11 && digits === raw.replace(/[.\-]/g, "")) return "CPF";
  if (digits.length === 14 && digits === raw.replace(/[.\-\/]/g, "")) return "CNPJ";
  return "EVP"; // chave aleatória (uuid)
}
