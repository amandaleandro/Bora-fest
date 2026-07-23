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

export const PAGARME_PROVIDER = "pagarme";

const DEFAULT_API_URL = "https://api.pagar.me/core/v5";

export class PagarmeApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Pagar.me respondeu ${status}`);
  }
}

interface PagarmeCharge {
  id: string;
  status: string;
  last_transaction?: {
    qr_code?: string;
    qr_code_url?: string;
    expires_at?: string;
    acquirer_message?: string;
    gateway_response?: { errors?: Array<{ message?: string }> };
  };
}

interface PagarmeOrderResponse {
  id: string;
  status: string;
  charges?: PagarmeCharge[];
}

/**
 * Adapter do gateway primário (decisão 2026-07-23, ver REGISTRO.md).
 *
 * Cobranças via Orders API v5. O split para produtores (recebedores) entra na
 * Fase 9 (ledger/repasses) — por ora as cobranças liquidam 100% na conta da
 * plataforma, e o hold-até-KYC é aplicado no momento do repasse.
 *
 * Env: PAGARME_SECRET_KEY (sk_...), PAGARME_WEBHOOK_SECRET e/ou
 * PAGARME_WEBHOOK_BASIC_USER/PASSWORD, PAGARME_API_URL (opcional).
 */
export class PagarmeGateway implements PaymentGateway {
  readonly provider = PAGARME_PROVIDER;

  async createPixCharge(input: CreatePixChargeInput): Promise<PixCharge> {
    const order = await this.request<PagarmeOrderResponse>("POST", "/orders", {
      code: input.orderId,
      customer: this.toCustomer(input.customer),
      items: [
        {
          code: input.orderId,
          description: "Ingressos BoraFest",
          amount: input.amountCents,
          quantity: 1,
        },
      ],
      payments: [
        {
          payment_method: "pix",
          pix: { expires_in: input.expiresInSeconds },
        },
      ],
      metadata: { borafest_payment_id: input.paymentId },
    }, input.idempotencyKey);

    const charge = order.charges?.[0];
    const qrCodeText = charge?.last_transaction?.qr_code;
    if (!charge || !qrCodeText) {
      throw new PagarmeApiError(502, order, "Resposta do Pagar.me sem QR Code Pix");
    }

    return {
      externalId: charge.id,
      qrCodeText,
      expiresAt: charge.last_transaction?.expires_at
        ? new Date(charge.last_transaction.expires_at)
        : new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async createCardPayment(input: CreateCardPaymentInput): Promise<CardPaymentResult> {
    const order = await this.request<PagarmeOrderResponse>("POST", "/orders", {
      code: input.orderId,
      customer: this.toCustomer(input.customer),
      items: [
        {
          code: input.orderId,
          description: "Ingressos BoraFest",
          amount: input.amountCents,
          quantity: 1,
        },
      ],
      payments: [
        {
          payment_method: "credit_card",
          credit_card: {
            installments: input.installments,
            statement_descriptor: "BORAFEST",
            card_token: input.cardToken,
          },
        },
      ],
      metadata: { borafest_payment_id: input.paymentId },
    }, input.idempotencyKey);

    const charge = order.charges?.[0];
    if (!charge) {
      throw new PagarmeApiError(502, order, "Resposta do Pagar.me sem charge");
    }

    const status = mapChargeStatus(charge.status);
    if (status === "PAID") return { externalId: charge.id, status: "PAID" };
    if (status === "AUTHORIZED") return { externalId: charge.id, status: "AUTHORIZED" };

    return {
      externalId: charge.id,
      status: "FAILED",
      failReason:
        charge.last_transaction?.acquirer_message ??
        charge.last_transaction?.gateway_response?.errors?.[0]?.message ??
        `Cobrança ${charge.status}`,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const charge = await this.request<PagarmeCharge>(
      "DELETE",
      `/charges/${input.externalId}`,
      input.amountCents ? { amount: input.amountCents } : undefined,
      input.idempotencyKey,
    );

    const status = charge.status === "canceled" || charge.status === "refunded"
      ? "REFUNDED"
      : charge.status === "failed"
        ? "FAILED"
        : "PENDING";
    return { externalId: input.externalId, status };
  }

  async getStatus(externalId: string): Promise<GatewayPaymentStatus> {
    const charge = await this.request<PagarmeCharge>("GET", `/charges/${externalId}`);
    return mapChargeStatus(charge.status);
  }

  verifyWebhook(headers: WebhookHeaders, rawBody: string): VerifiedWebhookEvent {
    this.assertWebhookAuthentic(headers, rawBody);

    let body: {
      id?: string;
      type?: string;
      data?: { id?: string; status?: string; charges?: Array<{ id?: string; status?: string }> };
    };
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new WebhookVerificationError("Payload do webhook Pagar.me ilegível");
    }
    if (!body.id || !body.type || !body.data) {
      throw new WebhookVerificationError("Payload do webhook Pagar.me incompleto");
    }

    // charge.* → data.id é a charge; order.* → primeira charge do pedido;
    // chargeback.* → referência à charge dentro do objeto de chargeback
    const chargeLike = body.type.startsWith("charge.")
      ? body.data
      : (body.data.charges?.[0] ?? (body.data as { charge?: { id?: string; status?: string } }).charge);
    const externalPaymentId = chargeLike?.id;
    if (!externalPaymentId) {
      throw new WebhookVerificationError("Webhook Pagar.me sem id de cobrança");
    }

    return {
      externalEventId: body.id,
      externalPaymentId,
      type: body.type,
      status: mapWebhookType(body.type, chargeLike?.status),
      raw: body,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * Verificado na doc oficial (2026-07-23): a v5 NÃO tem assinatura HMAC de
   * webhook (X-Hub-Signature era da v4). O mecanismo oficial é autenticação
   * opcional configurada no endpoint do webhook no dashboard — usamos Basic.
   * O HMAC fica como caminho alternativo caso um proxy/versão futura assine.
   * Defesa extra: a reconciliação periódica consulta GET /charges/{id} e o
   * applyGatewayStatus é idempotente — webhook forjado não emite duas vezes.
   */
  private assertWebhookAuthentic(headers: WebhookHeaders, rawBody: string): void {
    const basicUser = process.env.PAGARME_WEBHOOK_BASIC_USER;
    const basicPassword = process.env.PAGARME_WEBHOOK_BASIC_PASSWORD;
    const hmacSecret = process.env.PAGARME_WEBHOOK_SECRET;

    if (basicUser && basicPassword) {
      const raw = headers.authorization;
      const header = Array.isArray(raw) ? raw[0] : raw;
      const expected = `Basic ${Buffer.from(`${basicUser}:${basicPassword}`).toString("base64")}`;
      if (!header) throw new WebhookVerificationError("Webhook Pagar.me sem Authorization");
      const a = Buffer.from(header);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new WebhookVerificationError("Credencial Basic do webhook inválida");
      }
      return;
    }

    if (hmacSecret) {
      const raw = headers["x-hub-signature"];
      const header = Array.isArray(raw) ? raw[0] : raw;
      if (!header) throw new WebhookVerificationError("Webhook Pagar.me sem X-Hub-Signature");

      const received = header.replace(/^sha(1|256)=/, "");
      const algorithm = header.startsWith("sha1=") ? "sha1" : "sha256";
      const expected = createHmac(algorithm, hmacSecret).update(rawBody).digest("hex");
      const a = Buffer.from(received.toLowerCase());
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new WebhookVerificationError("Assinatura X-Hub-Signature inválida");
      }
      return;
    }

    // fail closed: sem verificação configurada, nenhum webhook é aceito
    throw new WebhookVerificationError(
      "Verificação do webhook Pagar.me não configurada (defina PAGARME_WEBHOOK_BASIC_USER/PASSWORD ou PAGARME_WEBHOOK_SECRET)",
    );
  }

  private toCustomer(customer: {
    name?: string;
    email: string;
    document?: string;
    phone?: string;
  }) {
    const document = customer.document?.replace(/\D/g, "");
    let digits = customer.phone?.replace(/\D/g, "");
    if (digits && digits.length > 11 && digits.startsWith("55")) {
      digits = digits.slice(2);
    }
    return {
      name: customer.name ?? customer.email,
      email: customer.email,
      ...(document
        ? { document, type: document.length > 11 ? "company" : "individual" }
        : {}),
      ...(digits && digits.length >= 10
        ? {
            phones: {
              mobile_phone: {
                country_code: "55",
                area_code: digits.slice(0, 2),
                number: digits.slice(2),
              },
            },
          }
        : {}),
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const secretKey = process.env.PAGARME_SECRET_KEY;
    if (!secretKey) throw new Error("PAGARME_SECRET_KEY is not set");
    const apiUrl = process.env.PAGARME_API_URL ?? DEFAULT_API_URL;

    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "content-type": "application/json",
        // grafia literal da doc (case-sensitive); dedupe de 24h em produção
        ...(idempotencyKey ? { "Idempotency-key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!response.ok) {
      throw new PagarmeApiError(response.status, json);
    }
    return json as T;
  }
}

export function mapChargeStatus(status: string): GatewayPaymentStatus {
  switch (status) {
    case "paid":
    case "overpaid":
    case "underpaid":
      return "PAID";
    case "authorized":
      return "AUTHORIZED";
    case "pending":
    case "processing":
      return "PENDING";
    case "failed":
      return "FAILED";
    case "canceled":
      return "CANCELED";
    case "refunded":
      return "REFUNDED";
    case "chargedback":
      return "CHARGEBACK";
    default:
      return "PENDING";
  }
}

export function mapWebhookType(type: string, chargeStatus?: string): GatewayPaymentStatus {
  switch (type) {
    case "charge.paid":
    case "order.paid":
      return "PAID";
    case "charge.payment_failed":
      return "FAILED";
    case "charge.refunded":
      return "REFUNDED";
    // charge.chargedback será descontinuado em favor de chargeback.received
    // (migração Pagar.me até 30/09/2026) — suportamos os dois
    case "charge.chargedback":
    case "chargeback.received":
      return "CHARGEBACK";
    case "order.canceled":
      return "CANCELED";
    default:
      // tipos informativos (charge.pending, charge.processing, antifraude etc.):
      // usa o status corrente da cobrança quando presente
      return chargeStatus ? mapChargeStatus(chargeStatus) : "PENDING";
  }
}
