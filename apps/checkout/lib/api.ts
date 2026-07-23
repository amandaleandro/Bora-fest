import { API_BASE_URL } from "./config";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    // Content-Type só com corpo: o Fastify rejeita (400) JSON declarado e vazio
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
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
  items: Array<{ ticketLotId: string; quantity: number; priceCents: number; feeCents: number }>;
}

export interface Order {
  id: string;
  publicToken: string;
  eventId: string;
  contactEmail: string;
  contactName: string | null;
  status: string;
  totalCents: number;
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
  getPublicEvent: (slug: string) => request<PublicEvent>(`/v1/public/events/${slug}`),
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

  getOrderTickets: (publicToken: string) =>
    request<OrderTicketsResponse>(`/v1/orders/${publicToken}/tickets`),

  resendTickets: (publicToken: string) =>
    request<{ queued: boolean; channels: string[] }>(`/v1/orders/${publicToken}/resend`, { method: "POST" }),
};
