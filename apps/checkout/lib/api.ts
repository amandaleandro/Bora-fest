import { API_BASE_URL } from "./config";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  // Content-Type só com corpo: o Fastify rejeita (400) JSON declarado e vazio
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
    throw new ApiError(response.status, data?.message ?? "Erro ao falar com a API");
  }
  return data as T;
}

export interface PublicTicketLot {
  id: string;
  name: string;
  priceCents: number;
  feeCents: number;
  capacity: number;
  soldCount: number;
  reservedCount: number;
  status: string;
}

export interface PublicTicketType {
  id: string;
  name: string;
  description: string | null;
  lots: PublicTicketLot[];
}

export interface PublicEvent {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  bannerUrl: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venue: { name: string; address: string; city: string; state: string } | null;
  ticketTypes: PublicTicketType[];
}

export interface EventListItem {
  id: string;
  title: string;
  slug: string;
  bannerUrl: string | null;
  startsAt: string;
  timezone: string;
  venue: { name: string; city: string; state: string } | null;
  fromPriceCents: number | null;
}

export interface AvailabilityItem {
  ticketTypeId: string;
  ticketTypeName: string;
  lotId: string;
  lotName: string;
  priceCents: number;
  feeCents: number;
  available: number;
}

export interface Reservation {
  id: string;
  eventId: string;
  status: string;
  expiresAt: string;
  items: Array<{ ticketLotId: string; quantity: number; priceCents: number; feeCents: number; halfPrice?: boolean }>;
}

export interface Order {
  id: string;
  publicToken: string;
  eventId: string;
  contactEmail: string;
  contactName: string | null;
  status: string;
  totalCents: number;
  discountCents?: number;
  createdAt: string;
  paidAt: string | null;
  items: Array<{ ticketLotId: string; quantity: number; priceCents: number; feeCents: number }>;
  payments?: Array<{
    id: string;
    method: string;
    status: string;
    amountCents: number;
    pixQrCodeText: string | null;
    expiresAt: string | null;
  }>;
  tickets?: Array<{ id: string; code: string; status: string }>;
}

export interface PixPayment {
  id: string;
  status: string;
  pixQrCodeText: string | null;
  expiresAt: string | null;
}

export interface OrderTicket {
  id: string;
  code: string;
  qrToken: string;
  status: string;
  seq: number;
  attendeeName: string | null;
  issuedAt: string;
  lotName: string;
  typeName: string;
}

export interface OrderTicketsResponse {
  orderId: string;
  orderStatus: string;
  event: { title: string; slug: string; startsAt: string; endsAt: string };
  tickets: OrderTicket[];
}

export const api = {
  listPublicEvents: () =>
    request<{ total: number; events: EventListItem[] }>("/v1/public/events").then((r) => r.events),
  getPublicEvent: (slug: string) => request<PublicEvent>(`/v1/public/events/${slug}`),
  getAvailability: (slug: string) => request<AvailabilityItem[]>(`/v1/public/events/${slug}/availability`),

  createReservation: (
    eventId: string,
    items: Array<{ ticketLotId: string; quantity: number; halfPrice?: boolean }>,
  ) => request<Reservation>("/v1/reservations", { method: "POST", body: { eventId, items } }),

  getReservation: (id: string) => request<Reservation>(`/v1/reservations/${id}`),

  checkCoupon: (slug: string, code: string) =>
    request<{ valid: boolean; code: string; discountType: "PERCENT" | "FIXED"; discountValue: number }>(
      `/v1/public/events/${slug}/coupons/${encodeURIComponent(code)}`,
    ),

  createOrder: (input: {
    reservationId: string;
    contactEmail: string;
    contactName?: string;
    contactPhone?: string;
    couponCode?: string;
  }) => request<Order>("/v1/orders", { method: "POST", body: input }),

  getOrderStatus: (publicToken: string) => request<Order>(`/v1/orders/${publicToken}/status`),

  createPixPayment: (orderId: string, input: { payerDocument?: string; payerPhone?: string }) =>
    request<PixPayment>(`/v1/orders/${orderId}/payments/pix`, { method: "POST", body: input }),

  createCardPayment: (
    orderId: string,
    input: { cardToken: string; installments: number; payerDocument?: string },
  ) =>
    request<{ id: string; status: string; failReason: string | null }>(
      `/v1/orders/${orderId}/payments/card`,
      { method: "POST", body: input },
    ),

  getOrderTickets: (publicToken: string) =>
    request<OrderTicketsResponse>(`/v1/orders/${publicToken}/tickets`),

  resendTickets: (publicToken: string) =>
    request<{ queued: boolean; channels: string[] }>(`/v1/orders/${publicToken}/resend`, { method: "POST" }),

  transferTicket: (ticketId: string, input: { orderPublicToken: string; toName: string; toEmail: string }) =>
    request<OrderTicket>(`/v1/tickets/${ticketId}/transfer`, { method: "POST", body: input }),

  requestOtp: (destination: string) =>
    request<{ sent: boolean }>("/v1/identity/otp/request", {
      method: "POST",
      body: { destination, channel: "EMAIL" },
    }),

  verifyOtp: (destination: string, code: string) =>
    request<{ token: string; user: { id: string; email: string; name: string | null } }>(
      "/v1/identity/otp/verify",
      { method: "POST", body: { destination, code } },
    ),

  myTickets: (token: string) =>
    request<Array<OrderTicket & { event: { title: string; slug: string; startsAt: string } }>>(
      "/v1/me/tickets",
      { token },
    ),

  myProfile: (token: string) =>
    request<{ id: string; name: string | null; email: string | null; phone: string | null }>("/v1/me", { token }),

  myOrders: (token: string) =>
    request<Array<{
      id: string; publicToken: string; status: string; totalCents: number; discountCents: number;
      createdAt: string;
      event: { title: string; slug: string; startsAt: string; endsAt: string };
      items: Array<{ quantity: number; ticketLot: { name: string } }>;
    }>>("/v1/me/orders", { token }),

  myDataExport: (token: string) => request<unknown>("/v1/me/data-export", { token }),

  deleteAccount: (token: string) =>
    request<{ deleted: boolean }>("/v1/me", { method: "DELETE", token }),

  requestRefund: (publicToken: string, reason: string) =>
    request<{ id: string; status: string }>(`/v1/orders/${publicToken}/refund-requests`, {
      method: "POST",
      body: { reason },
    }),
};
