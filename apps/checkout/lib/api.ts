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
  /** BUYER: comprador paga a taxa. PRODUCER: o produtor absorve (total = preço). */
  feeMode: "BUYER" | "PRODUCER";
  /** exige nome (e CPF quando requiresCpf) de cada participante no checkout */
  nominal: boolean;
  requiresCpf: boolean;
  /** quando o lote fecha (vira o próximo lote) — usado pro contador de urgência */
  endsAt: string | null;
}

export interface PublicTicketType {
  id: string;
  name: string;
  description: string | null;
  lots: PublicTicketLot[];
}

export interface PixelSettings {
  metaPixelId?: string;
  ga4MeasurementId?: string;
  tiktokPixelId?: string;
}

export interface PublicEventAddOn {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
}

export interface PublicEvent {
  id: string;
  organizationId: string;
  organization: { id: string; name: string; slug: string };
  title: string;
  slug: string;
  description: string | null;
  /** atrações, uma por linha */
  lineup: string | null;
  /** o que está incluso, um item por linha */
  amenities: string | null;
  /** idade mínima em anos; null = livre */
  minAge: number | null;
  bannerUrl: string | null;
  category: EventCategory | null;
  status: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venue: { name: string; address: string | null; mapsUrl: string | null; city: string; state: string } | null;
  ticketTypes: PublicTicketType[];
  addOns: PublicEventAddOn[];
  waitingRoomEnabled: boolean;
  pixelSettings: PixelSettings | null;
}

export interface ReviewSummary {
  average: number | null;
  count: number;
  recent: Array<{ rating: number; comment: string | null; createdAt: string; user: { name: string | null } }>;
}

export type WaitingRoomJoinResult =
  | { status: "ADMITTED"; ticketId: string }
  | { status: "QUEUED"; ticketId: string; position: number };

export type WaitingRoomStatusResult =
  | { status: "ADMITTED" }
  | { status: "QUEUED"; position: number }
  | { status: "EXPIRED" };

export type EventCategory = "SHOWS" | "FESTAS" | "ESPORTES" | "TEATRO";

export interface EventListItem {
  id: string;
  title: string;
  slug: string;
  bannerUrl: string | null;
  category: EventCategory | null;
  startsAt: string;
  timezone: string;
  venue: { name: string; city: string; state: string } | null;
  fromPriceCents: number | null;
  /** fim do lote ativo mais próximo (urgência honesta na vitrine) */
  currentLotEndsAt: string | null;
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
  /** celular do contato (só dígitos, pode vir com 55) — pré-preenche o envio por WhatsApp */
  contactPhone?: string | null;
  status: string;
  totalCents: number;
  discountCents?: number;
  createdAt: string;
  /** janela de pagamento do pedido — mantém o cronômetro vivo depois da reserva */
  expiresAt?: string | null;
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

export interface OrderAttendeeInput {
  ticketLotId: string;
  name: string;
  cpf?: string;
}

/** Aceite versionado de Termos e Privacidade (LGPD) — obrigatório para pagar. */
export interface ConsentInput {
  version: string;
  terms: true;
  privacy: true;
}

export const api = {
  listPublicEvents: () =>
    request<{ total: number; events: EventListItem[] }>("/v1/public/events").then((r) => r.events),
  listPublicEventsByCity: (city?: string, category?: EventCategory) => {
    const params = new URLSearchParams();
    if (city) params.set("city", city);
    if (category) params.set("category", category);
    const qs = params.toString();
    return request<{ total: number; events: EventListItem[] }>(
      `/v1/public/events${qs ? `?${qs}` : ""}`,
    ).then((r) => r.events);
  },
  getHomeSections: (city?: string) => {
    const params = city ? `?city=${encodeURIComponent(city)}` : "";
    return request<{
      highlights: EventListItem[];
      shelves: Array<{ category: EventCategory; events: EventListItem[] }>;
      upcoming: EventListItem[];
    }>(`/v1/public/events/home/sections${params}`);
  },
  listPublicCities: () =>
    request<Array<{ city: string; state: string }>>("/v1/public/events/cities/list"),
  getPublicEvent: (slug: string) => request<PublicEvent>(`/v1/public/events/${slug}`),
  getAvailability: (slug: string) => request<AvailabilityItem[]>(`/v1/public/events/${slug}/availability`),

  joinWaitingRoom: (slug: string) =>
    request<WaitingRoomJoinResult>(`/v1/public/events/${slug}/waiting-room/join`, { method: "POST" }),
  waitingRoomStatus: (slug: string, ticketId: string) =>
    request<WaitingRoomStatusResult>(
      `/v1/public/events/${slug}/waiting-room/status?ticketId=${encodeURIComponent(ticketId)}`,
    ),

  /** A reserva só guarda o eventId; o checkout precisa do slug para reler o catálogo. */
  resolveEventSlug: (eventId: string) =>
    request<{ total: number; events: EventListItem[] }>("/v1/public/events").then(
      (r) => r.events.find((e) => e.id === eventId)?.slug ?? null,
    ),

  createReservation: (
    eventId: string,
    items: Array<{ ticketLotId: string; quantity: number; halfPrice?: boolean }>,
    token?: string,
    waitingRoomTicketId?: string,
  ) =>
    request<Reservation>("/v1/reservations", {
      method: "POST",
      body: { eventId, items, waitingRoomTicketId: waitingRoomTicketId || undefined },
      token,
    }),

  getReservation: (id: string) => request<Reservation>(`/v1/reservations/${id}`),

  checkCoupon: (slug: string, code: string) =>
    request<{ valid: boolean; code: string; discountType: "PERCENT" | "FIXED"; discountValue: number }>(
      `/v1/public/events/${slug}/coupons/${encodeURIComponent(code)}`,
    ),

  getReviews: (slug: string) => request<ReviewSummary>(`/v1/public/events/${slug}/reviews`),

  isFollowing: (organizationId: string, token: string) =>
    request<{ following: boolean }>(`/v1/organizations/${organizationId}/follow`, { token }),
  follow: (organizationId: string, token: string) =>
    request<{ following: boolean }>(`/v1/organizations/${organizationId}/follow`, { method: "POST", token }),
  unfollow: (organizationId: string, token: string) =>
    request<{ following: boolean }>(`/v1/organizations/${organizationId}/follow`, { method: "DELETE", token }),

  getMyReview: (eventId: string, token: string) =>
    request<{ rating: number; comment: string | null } | null>(`/v1/events/${eventId}/reviews/mine`, { token }),
  submitReview: (eventId: string, input: { rating: number; comment?: string }, token: string) =>
    request(`/v1/events/${eventId}/reviews`, { method: "POST", body: input, token }),

  createOrder: (
    input: {
      reservationId: string;
      contactEmail: string;
      contactName?: string;
      contactPhone?: string;
      couponCode?: string;
      partnerSlug?: string;
      promoterSlug?: string;
      addOns?: Array<{ addOnId: string; quantity: number }>;
      attendees?: OrderAttendeeInput[];
      consent?: ConsentInput;
    },
    token?: string,
  ) => request<Order>("/v1/orders", { method: "POST", body: input, token }),

  getOrderStatus: (publicToken: string) => request<Order>(`/v1/orders/${publicToken}/status`),

  createPixPayment: (orderId: string, input: { payerDocument?: string; payerPhone?: string }) =>
    request<PixPayment>(`/v1/orders/${orderId}/payments/pix`, { method: "POST", body: input }),

  createCardPayment: (
    orderId: string,
    input: {
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
    request<{ id: string; status: string; failReason: string | null }>(
      `/v1/orders/${orderId}/payments/card`,
      { method: "POST", body: input },
    ),

  getOrderTickets: (publicToken: string) =>
    request<OrderTicketsResponse>(`/v1/orders/${publicToken}/tickets`),

  resendTickets: (publicToken: string) =>
    request<{ queued: boolean; channels: string[] }>(`/v1/orders/${publicToken}/resend`, { method: "POST" }),

  /** Envia cada ingresso (texto + QR) para o WhatsApp; sem phone usa o contato do pedido. */
  sendTicketsWhatsApp: (publicToken: string, phone?: string) =>
    request<{ sent: boolean; tickets: number; phone: string }>(`/v1/orders/${publicToken}/whatsapp`, {
      method: "POST",
      body: phone ? { phone } : {},
    }),

  /** Transfere para a CONTA do e-mail destino (o nome vem da conta no servidor; toName é legado). */
  transferTicket: (ticketId: string, input: { orderPublicToken: string; toEmail: string; toName?: string }) =>
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
    request<Array<OrderTicket & {
      event: { title: string; slug: string; startsAt: string };
      orderPublicToken: string;
      /** só ACTIVE/ISSUED de evento não-encerrado podem ser transferidos */
      transferable: boolean;
    }>>("/v1/me/tickets", { token }),

  myProfile: (token: string) =>
    request<{
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      // preferências de notificação são de CONTA (handoff §8); enquanto a API
      // não as devolver, a UI cai no espelho em localStorage
      notifyWhatsapp?: boolean;
      notifyEmailOffers?: boolean;
    }>("/v1/me", { token }),

  /** Grava as preferências de notificação na conta. Rota ainda opcional: 404 = usar só o localStorage. */
  updatePreferences: (token: string, prefs: { notifyWhatsapp: boolean; notifyEmailOffers: boolean }) =>
    request<{ notifyWhatsapp?: boolean; notifyEmailOffers?: boolean }>("/v1/me", {
      method: "PATCH",
      body: prefs,
      token,
    }),

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
    request<{ id: string; status: string; reviewedBy: string }>(`/v1/orders/${publicToken}/refund-requests`, {
      method: "POST",
      body: { reason },
    }),
};
