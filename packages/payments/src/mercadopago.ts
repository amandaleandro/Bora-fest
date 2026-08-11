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
import { CircuitBreaker, fetchWithTimeout } from "./resilience";

export const MERCADOPAGO_PROVIDER = "mercadopago";

const DEFAULT_API_URL = "https://api.mercadopago.com";
const REQUEST_TIMEOUT_MS = 8_000;

const circuitBreaker = new CircuitBreaker({
  provider: MERCADOPAGO_PROVIDER,
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
});

export class MercadoPagoApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Mercado Pago respondeu ${status}`);
  }
}

interface MpPayment {
  id: number | string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  date_of_expiration?: string;
  point_of_interaction?: {
    transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string };
  };
}

/**
 * Adapter Mercado Pago (decisão 2026-08-11): Pix em PERCENTUAL (~0,99%) em vez
 * da tarifa fixa do Asaas — é o que viabiliza a taxa de R$ 1 prometida pelo
 * Arthur sem prejuízo. O cartão segue no Asaas (tarifa melhor); o roteamento
 * por método vive no registry.
 *
 * Escala: 1 chamada por compra (o status do comprador é lido do NOSSO banco,
 * nunca do MP) — a 1.000 compras/min isso é ~17 req/s, muito abaixo do limite
 * do MP. O incidente do projeto antigo ("gateway recusando por volume") vinha
 * de polling do navegador batendo direto no MP, o que aqui não existe.
 *
 * Idempotência: X-Idempotency-Key nativo do MP — retry nunca cobra duas vezes.
 *
 * Env: MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_WEBHOOK_SECRET, MERCADOPAGO_API_URL (opcional).
 */
export class MercadoPagoGateway implements PaymentGateway {
  readonly provider = MERCADOPAGO_PROVIDER;

  async createPixCharge(input: CreatePixChargeInput): Promise<PixCharge> {
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
    const documento = input.customer.document?.replace(/\D/g, "");

    const payment = await this.request<MpPayment>(
      "POST",
      "/v1/payments",
      {
        transaction_amount: toReais(input.amountCents),
        description: "Ingressos BoraFest",
        payment_method_id: "pix",
        external_reference: input.paymentId,
        date_of_expiration: toMpDate(expiresAt),
        payer: {
          email: input.customer.email,
          first_name: input.customer.name?.split(" ")[0],
          ...(documento
            ? {
                identification: {
                  type: documento.length > 11 ? "CNPJ" : "CPF",
                  number: documento,
                },
              }
            : {}),
        },
      },
      // idempotência nativa: mesma chave = mesma cobrança, sem duplicar
      input.paymentId,
    );

    const qrCode = payment.point_of_interaction?.transaction_data?.qr_code;
    if (!qrCode) {
      throw new MercadoPagoApiError(502, payment, "Resposta do Mercado Pago sem QR Code Pix");
    }

    return {
      externalId: String(payment.id),
      qrCodeText: qrCode,
      expiresAt: payment.date_of_expiration ? new Date(payment.date_of_expiration) : expiresAt,
    };
  }

  /**
   * Cartão no MP exige token gerado no navegador (SDK deles). O cartão da
   * plataforma roda no Asaas; este caminho existe para failover e só aceita
   * `cardToken`.
   */
  async createCardPayment(input: CreateCardPaymentInput): Promise<CardPaymentResult> {
    if (!input.cardToken) {
      throw new MercadoPagoApiError(
        400,
        null,
        "Cartão no Mercado Pago exige token do SDK — use o provedor de cartão configurado",
      );
    }
    let payment: MpPayment;
    try {
      payment = await this.request<MpPayment>(
        "POST",
        "/v1/payments",
        {
          transaction_amount: toReais(input.amountCents),
          token: input.cardToken,
          description: "Ingressos BoraFest",
          installments: input.installments > 1 ? input.installments : 1,
          external_reference: input.paymentId,
          payer: { email: input.customer.email },
        },
        input.paymentId,
      );
    } catch (error) {
      if (error instanceof MercadoPagoApiError && error.status === 400) {
        const body = error.body as { message?: string };
        return {
          externalId: `mp_recusado_${input.paymentId}`,
          status: "FAILED",
          failReason: body?.message ?? "Cartão recusado",
        };
      }
      throw error;
    }

    const status = mapMercadoPagoStatus(payment.status ?? "pending");
    if (status === "PAID") return { externalId: String(payment.id), status: "PAID" };
    if (status === "PENDING") return { externalId: String(payment.id), status: "AUTHORIZED" };
    return {
      externalId: String(payment.id),
      status: "FAILED",
      failReason: payment.status_detail ?? `Cobrança ${payment.status}`,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const refund = await this.request<{ status?: string }>(
      "POST",
      `/v1/payments/${input.externalId}/refunds`,
      input.amountCents !== undefined ? { amount: toReais(input.amountCents) } : {},
      input.idempotencyKey,
    );
    const aprovado = !refund.status || refund.status === "approved";
    return {
      externalId: input.externalId,
      status: aprovado ? "REFUNDED" : refund.status === "rejected" ? "FAILED" : "PENDING",
    };
  }

  async getStatus(externalId: string): Promise<GatewayPaymentStatus> {
    const payment = await this.request<MpPayment>("GET", `/v1/payments/${externalId}`);
    return mapMercadoPagoStatus(payment.status ?? "pending");
  }

  /**
   * Webhook do MP: assinatura HMAC-SHA256 no header `x-signature`
   * (`ts=...,v1=...`) sobre o manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
   * Fail closed — sem segredo configurado, nenhum webhook é aceito.
   */
  verifyWebhook(headers: WebhookHeaders, rawBody: string): VerifiedWebhookEvent {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!secret) {
      throw new WebhookVerificationError(
        "Verificação do webhook Mercado Pago não configurada (defina MERCADOPAGO_WEBHOOK_SECRET)",
      );
    }

    let body: { type?: string; action?: string; data?: { id?: string | number } };
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new WebhookVerificationError("Payload do webhook Mercado Pago ilegível");
    }
    const dataId = body.data?.id;
    if (!dataId) throw new WebhookVerificationError("Webhook Mercado Pago sem data.id");

    const signature = first(headers["x-signature"]);
    const requestId = first(headers["x-request-id"]) ?? "";
    if (!signature) throw new WebhookVerificationError("Webhook Mercado Pago sem x-signature");

    const partes = Object.fromEntries(
      signature.split(",").map((p) => {
        const [k, ...v] = p.trim().split("=");
        return [k, v.join("=")];
      }),
    );
    const ts = partes.ts;
    const v1 = partes.v1;
    if (!ts || !v1) throw new WebhookVerificationError("Assinatura do webhook Mercado Pago inválida");

    // o id vai em minúsculas no manifesto, conforme a doc do MP
    const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
    const esperado = createHmac("sha256", secret).update(manifest).digest("hex");
    const a = Buffer.from(esperado);
    const b = Buffer.from(v1);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new WebhookVerificationError("Assinatura do webhook Mercado Pago não confere");
    }

    const tipo = body.type ?? body.action ?? "payment";
    return {
      // o MP reenvia o mesmo (tipo, id) — o par serve de dedupe
      externalEventId: `${tipo}:${dataId}`,
      externalPaymentId: String(dataId),
      type: tipo,
      // o corpo não traz o status: quem resolve é a reconciliação por getStatus
      status: "PENDING",
      raw: body,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN is not set");
    const apiUrl = process.env.MERCADOPAGO_API_URL ?? DEFAULT_API_URL;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

    const response = await circuitBreaker.execute(() =>
      fetchWithTimeout(
        `${apiUrl}${path}`,
        {
          method,
          headers,
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
      throw new MercadoPagoApiError(response.status, json);
    }
    return json as T;
  }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toReais(amountCents: number): number {
  return Math.round(amountCents) / 100;
}

/** ISO com offset, formato que o MP exige em date_of_expiration. */
function toMpDate(date: Date): string {
  const iso = date.toISOString().replace("Z", "");
  return `${iso}-00:00`;
}

export function mapMercadoPagoStatus(status: string): GatewayPaymentStatus {
  switch (status) {
    case "approved":
    case "authorized":
      return "PAID";
    case "pending":
    case "in_process":
    case "in_mediation":
      return "PENDING";
    case "rejected":
      return "FAILED";
    case "cancelled":
      return "CANCELED";
    case "refunded":
      return "REFUNDED";
    case "charged_back":
      return "CHARGEBACK";
    default:
      return "PENDING";
  }
}
