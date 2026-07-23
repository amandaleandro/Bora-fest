import { API_BASE_URL } from "../config";
import { ApiError } from "./types";
import type {
  AvailabilityItem,
  CardPayment,
  EventListResponse,
  MyTicket,
  Order,
  OrderTicketsResponse,
  PixPayment,
  PublicEvent,
  Reservation,
  SessionUser,
} from "./types";

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new ApiError(response.status, data?.message ?? "Erro ao falar com a API");
  }
  return data as T;
}

export const api = {
  listEvents: (page = 1) => request<EventListResponse>(`/v1/public/events?page=${page}&pageSize=20`),

  getEvent: (slug: string) => request<PublicEvent>(`/v1/public/events/${slug}`),
  getAvailability: (slug: string) => request<AvailabilityItem[]>(`/v1/public/events/${slug}/availability`),

  createReservation: (eventId: string, items: Array<{ ticketLotId: string; quantity: number }>) =>
    request<Reservation>("/v1/reservations", { method: "POST", body: { eventId, items } }),

  getReservation: (id: string) => request<Reservation>(`/v1/reservations/${id}`),

  createOrder: (input: {
    reservationId: string;
    contactEmail: string;
    contactName?: string;
    contactPhone?: string;
  }) => request<Order>("/v1/orders", { method: "POST", body: input }),

  getOrderStatus: (publicToken: string) => request<Order>(`/v1/orders/${publicToken}/status`),

  createPixPayment: (orderId: string, input: { payerDocument?: string; payerPhone?: string }) =>
    request<PixPayment>(`/v1/orders/${orderId}/payments/pix`, { method: "POST", body: input }),

  createCardPayment: (
    orderId: string,
    input: { cardToken: string; installments: number; payerDocument?: string },
    idempotencyKey: string,
  ) =>
    request<CardPayment>(`/v1/orders/${orderId}/payments/card`, {
      method: "POST",
      body: input,
      idempotencyKey,
    }),

  getOrderTickets: (publicToken: string) =>
    request<OrderTicketsResponse>(`/v1/orders/${publicToken}/tickets`),

  resendTickets: (publicToken: string) =>
    request<{ queued: boolean; channels: string[] }>(`/v1/orders/${publicToken}/resend`, { method: "POST" }),

  registerPushToken: (publicToken: string, token: string, platform: "ios" | "android") =>
    request<{ registered: boolean }>(`/v1/orders/${publicToken}/push-token`, {
      method: "POST",
      body: { token, platform },
    }),

  requestOtp: (destination: string) =>
    request<{ sent: boolean }>("/v1/identity/otp/request", {
      method: "POST",
      body: { destination, channel: "EMAIL" },
    }),

  verifyOtp: (destination: string, code: string) =>
    request<{ token: string; user: SessionUser }>("/v1/identity/otp/verify", {
      method: "POST",
      body: { destination, code },
    }),

  getMyTickets: (token: string) => request<MyTicket[]>("/v1/me/tickets", { token }),
};
