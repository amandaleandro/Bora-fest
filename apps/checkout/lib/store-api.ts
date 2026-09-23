import { API_BASE_URL } from "./config";
import type { HouseStoreResponse } from "./houses-api";

export interface StoreOrderPublic {
  id: string;
  publicToken: string;
  status: "CREATED" | "PAYMENT_PENDING" | "PAID" | "READY" | "FULFILLED" | "CANCELED" | "REFUNDED" | "CHARGEBACK";
  house: { slug: string; name: string; logoUrl?: string | null };
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  fulfillmentMethod: "PICKUP" | "DELIVERY";
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  shippingAddress?: {
    postalCode: string;
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
  } | null;
  expiresAt: string;
  paidAt: string | null;
  fulfilledAt?: string | null;
  pickupCode: string | null;
  items: Array<{
    id: string;
    variantId: string;
    productName: string;
    variantName: string;
    quantity: number;
    priceCents: number;
  }>;
  payments?: Array<{
    id: string;
    method: string;
    status: string;
    amountCents: number;
    pixQrCodeText: string | null;
    expiresAt: string | null;
    paidAt: string | null;
  }>;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: Object.keys(headers).length ? headers : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(data?.message ?? "Não foi possível concluir a operação da Loja");
  }
  return data as T;
}

export const storeApi = {
  createOrder: (
    houseSlug: string,
    body: {
      items: Array<{ variantId: string; quantity: number }>;
      contactName: string;
      contactEmail: string;
      contactPhone?: string;
      fulfillmentMethod: "PICKUP" | "DELIVERY";
      shippingAddress?: {
        postalCode: string;
        street: string;
        number: string;
        complement?: string;
        neighborhood: string;
        city: string;
        state: string;
      };
    },
  ) =>
    request<StoreOrderPublic>(`/v1/public/casas/${encodeURIComponent(houseSlug)}/store/orders`, {
      method: "POST",
      body,
    }),

  getOrder: (publicToken: string) =>
    request<StoreOrderPublic>(`/v1/public/store/orders/${publicToken}`),

  createPix: (publicToken: string, body: { payerDocument?: string; payerPhone?: string }) =>
    request<{
      id: string;
      status: string;
      amountCents: number;
      pixQrCodeText: string | null;
      expiresAt: string | null;
      paidAt: string | null;
    }>(`/v1/public/store/orders/${publicToken}/payments/pix`, {
      method: "POST",
      body,
    }),

  createCard: (
    publicToken: string,
    body: {
      cardToken?: string;
      card?: {
        number: string;
        holderName: string;
        expiryMonth: string;
        expiryYear: string;
        ccv: string;
        holderCpf: string;
        postalCode: string;
        addressNumber: string;
      };
      installments: number;
      payerDocument?: string;
    },
  ) =>
    request<{
      id: string;
      status: string;
      amountCents: number;
      pixQrCodeText: string | null;
      expiresAt: string | null;
      paidAt: string | null;
    }>(`/v1/public/store/orders/${publicToken}/payments/card`, {
      method: "POST",
      body,
    }),

  syncPayment: (publicToken: string) =>
    request<{ synced: boolean; status?: string }>(
      `/v1/public/store/orders/${publicToken}/payments/sync`,
      { method: "POST" },
    ),

  store: (slug: string) =>
    request<HouseStoreResponse>(`/v1/public/casas/${encodeURIComponent(slug)}/store`),
};
