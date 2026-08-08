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
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  // Content-Type só com corpo: o Fastify rejeita (400) JSON declarado e vazio
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
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

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
}

export const identityApi = {
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
};

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export interface Organization {
  id: string;
  name: string;
  /** nome comercial mostrado ao público; null = usa `name` */
  displayName?: string | null;
  slug: string;
  kind: string;
  status: string;
  document?: string;
}

export const organizationsApi = {
  list: (token: string) => request<Array<Organization & { roleKey: string }>>("/v1/organizations", { token }),
  create: (token: string, input: { name: string; kind: "INDIVIDUAL" | "COMPANY"; document: string }) =>
    request<Organization & { members: unknown[] }>("/v1/organizations", { method: "POST", body: input, token }),
  update: (token: string, organizationId: string, input: { displayName?: string | null }) =>
    request<Organization>(`/v1/organizations/${organizationId}`, { method: "PATCH", body: input, token }),
  inviteMember: (token: string, organizationId: string, email: string, roleKey: MemberRoleKey, partnerId?: string) =>
    request(`/v1/organizations/${organizationId}/members`, {
      method: "POST",
      body: { email, roleKey, partnerId },
      token,
    }),
  createSalesPartner: (token: string, organizationId: string, input: { name: string; commissionBps: number }) =>
    request<SalesPartner>(`/v1/organizations/${organizationId}/sales-partners`, { method: "POST", body: input, token }),
  listSalesPartners: (token: string, organizationId: string) =>
    request<SalesPartner[]>(`/v1/organizations/${organizationId}/sales-partners`, { token }),
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Local do evento — `state` é a UF com 2 letras maiúsculas (ex.: "SP"). Endereço e link do mapa são independentes e opcionais. */
export interface EventVenue {
  name: string;
  address?: string;
  mapsUrl?: string;
  city: string;
  state: string;
}

/** As 27 UFs aceitas em `EventVenue.state` (valores exatos do contrato da API). */
export const UF_LIST = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export type EventCategory = "SHOWS" | "FESTAS" | "ESPORTES" | "TEATRO";

/** Categoria alimenta os chips de busca da home pública — sem ela o evento só some do filtro, não da listagem. */
export const EVENT_CATEGORIES: Array<{ value: EventCategory; label: string }> = [
  { value: "SHOWS", label: "Shows" },
  { value: "FESTAS", label: "Festas" },
  { value: "ESPORTES", label: "Esportes" },
  { value: "TEATRO", label: "Teatro" },
];

export interface EventSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  startsAt: string;
  endsAt: string;
  organizationId: string;
  description?: string | null;
  bannerUrl?: string | null;
  category?: EventCategory | null;
  venue?: EventVenue | null;
}

/**
 * Rótulos do handoff → roleKey do inviteMemberSchema (owner|admin|operator|finance).
 * "Gestor do evento" cai em `finance` porque é a única role não-admin com acesso a
 * pedidos/participantes (finance:view + order:refund); `operator` só tem checkin:perform.
 */
export const MEMBER_ROLES = [
  { key: "admin", label: "Administrador", description: "Tudo, inclusive financeiro e saques" },
  { key: "finance", label: "Gestor do evento", description: "Ingressos, vendas e participantes" },
  { key: "operator", label: "Check-in", description: "Só o app de validação e o painel ao vivo" },
  { key: "seller", label: "Vendedor", description: "Pode registrar vendas no PDV da atlética/parceiro" },
] as const;

export interface SalesPartner {
  id: string;
  name: string;
  slug: string;
  commissionBps: number;
  members: Array<{ user: { id: string; name?: string | null; email?: string | null } }>;
}

export type MemberRoleKey = (typeof MEMBER_ROLES)[number]["key"];

export const eventsApi = {
  list: (token: string, organizationId: string) =>
    request<EventSummary[]>(`/v1/organizations/${organizationId}/events`, { token }),
  create: (
    token: string,
    organizationId: string,
    input: {
      title: string;
      startsAt: string;
      endsAt: string;
      description?: string;
      lineup?: string;
      amenities?: string;
      minAge?: number;
      venue?: EventVenue;
      category: EventCategory;
    },
  ) =>
    request<EventSummary>(`/v1/organizations/${organizationId}/events`, {
      method: "POST",
      body: input,
      token,
    }),
  publish: (token: string, eventId: string) =>
    request<EventSummary>(`/v1/events/${eventId}/publish`, { method: "POST", token }),
};

// ---------------------------------------------------------------------------
// Itens adicionais (upsell no checkout)
// ---------------------------------------------------------------------------

export interface EventAddOn {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  active: boolean;
}

export const addOnsApi = {
  list: (token: string, eventId: string) =>
    request<EventAddOn[]>(`/v1/events/${eventId}/add-ons`, { token }),
  create: (token: string, eventId: string, input: { name: string; description?: string; priceCents: number }) =>
    request<EventAddOn>(`/v1/events/${eventId}/add-ons`, { method: "POST", body: input, token }),
  update: (token: string, addOnId: string, input: Partial<{ name: string; description: string; priceCents: number; active: boolean }>) =>
    request<EventAddOn>(`/v1/add-ons/${addOnId}`, { method: "PATCH", body: input, token }),
};

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface TicketType {
  id: string;
  name: string;
  description: string | null;
}

export type FeeMode = "BUYER" | "PRODUCER";

export interface TicketLot {
  id: string;
  name: string;
  priceCents: number;
  feeCents: number;
  capacity: number;
  soldCount: number;
  reservedCount: number;
  status: string;
  feeMode?: FeeMode;
  nominal?: boolean;
  requiresCpf?: boolean;
}

export interface CreateLotInput {
  name: string;
  priceCents: number;
  feeCents: number;
  capacity: number;
  maxPerOrder?: number;
  /** BUYER: preço + taxa no checkout · PRODUCER: produtor absorve a taxa */
  feeMode?: FeeMode;
  nominal?: boolean;
  requiresCpf?: boolean;
}

export const catalogApi = {
  createTicketType: (token: string, eventId: string, input: { name: string; position?: number }) =>
    request<TicketType>(`/v1/events/${eventId}/ticket-types`, { method: "POST", body: input, token }),
  createLot: (token: string, ticketTypeId: string, input: CreateLotInput) =>
    request<TicketLot>(`/v1/ticket-types/${ticketTypeId}/lots`, { method: "POST", body: input, token }),
  activateLot: (token: string, lotId: string) =>
    request<TicketLot>(`/v1/ticket-lots/${lotId}/activate`, { method: "POST", token }),
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface PixelSettings {
  metaPixelId?: string;
  ga4MeasurementId?: string;
  tiktokPixelId?: string;
}

export interface Dashboard {
  event: {
    id: string;
    organizationId: string;
    title: string;
    slug: string;
    status: string;
    category?: EventCategory | null;
    bannerUrl?: string | null;
    waitingRoomEnabled: boolean;
    waitingRoomConcurrency: number;
    pixelSettings?: PixelSettings | null;
    venue?: EventVenue | null;
  };
  revenueCents: number;
  orders: { total: number; byStatus: Record<string, number> };
  tickets: { total: number; byStatus: Record<string, number> };
  lots: Array<{
    id: string;
    name: string;
    ticketTypeId: string;
    typeName: string;
    priceCents: number;
    feeCents: number;
    capacity: number;
    sold: number;
    reserved: number;
    available: number;
    status: string;
  }>;
  reviews: { average: number | null; count: number };
}

export interface Participant {
  id: string;
  code: string;
  status: string;
  attendeeName: string | null;
  attendeeEmail: string | null;
  checkedInAt: string | null;
  typeName: string;
  lotName: string;
}

export interface CheckinLive {
  eventId: string;
  totalTickets: number;
  checkedIn: number;
  remaining: number;
  perMinute: number;
  byCheckinPoint: Array<{ checkinPointId: string | null; count: number }>;
  curve: Array<{
    bucketStart: string;
    total: number;
    byCheckinPoint: Array<{ checkinPointId: string | null; count: number }>;
  }>;
  generatedAt: string;
}

export interface SalesBySeller {
  sellerId: string;
  sellerName: string | null;
  sellerEmail: string | null;
  partnerId: string | null;
  partnerName: string | null;
  ordersOk: number;
  ordersFailed: number;
  ticketsSold: number;
  revenueCents: number;
  commissionCents: number;
}

export const dashboardApi = {
  get: (token: string, eventId: string) => request<Dashboard>(`/v1/events/${eventId}/dashboard`, { token }),
  checkinLive: (token: string, eventId: string) =>
    request<CheckinLive>(`/v1/events/${eventId}/checkin-live`, { token }),
  salesBySeller: (token: string, eventId: string) =>
    request<SalesBySeller[]>(`/v1/events/${eventId}/sales-by-seller`, { token }),
  participants: (token: string, eventId: string) =>
    request<Participant[]>(`/v1/events/${eventId}/participants`, { token }),
  /**
   * O export exige sessão (SessionGuard) — um <a href> puro não manda o
   * Authorization header, então baixamos via fetch e disparamos o download
   * a partir de um blob.
   */
  downloadParticipantsCsv: async (token: string, eventId: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/v1/events/${eventId}/participants/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new ApiError(response.status, "Não foi possível exportar");

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "participantes.csv";
    link.click();
    URL.revokeObjectURL(url);
  },
  downloadOrdersCsv: async (token: string, eventId: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/v1/events/${eventId}/orders/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new ApiError(response.status, "Não foi possível exportar");

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pedidos.csv";
    link.click();
    URL.revokeObjectURL(url);
  },
};

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export interface Balance {
  organizationId: string;
  balanceCents: number;
  availableForPayoutCents: number;
  heldCents?: number;
  anticipationFeeCents?: number;
  settlementMode?: "STANDARD" | "INSTANT";
}

export interface LedgerEntry {
  id: string;
  type: string;
  amountCents: number;
  referenceType: string;
  referenceId: string;
  createdAt: string;
}

export interface OrgRefundRequest {
  id: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt: string;
  resolutionNote: string | null;
  order: {
    publicToken: string;
    contactName: string | null;
    contactEmail: string;
    totalCents: number;
    status: string;
    event: { title: string };
  };
}

export const financeApi = {
  getBalance: (token: string, organizationId: string) =>
    request<Balance>(`/v1/organizations/${organizationId}/balance`, { token }),
  getLedger: (token: string, organizationId: string) =>
    request<LedgerEntry[]>(`/v1/organizations/${organizationId}/ledger`, { token }),
  listRefundRequests: (token: string, organizationId: string) =>
    request<OrgRefundRequest[]>(`/v1/organizations/${organizationId}/refund-requests`, { token }),
  approveRefundRequest: (token: string, organizationId: string, id: string) =>
    request(`/v1/organizations/${organizationId}/refund-requests/${id}/approve`, {
      method: "POST",
      body: {},
      token,
    }),
  rejectRefundRequest: (token: string, organizationId: string, id: string, note: string) =>
    request(`/v1/organizations/${organizationId}/refund-requests/${id}/reject`, {
      method: "POST",
      body: { note },
      token,
    }),
};

// ---------------------------------------------------------------------------
// Validador (configuração pelo produtor)
// ---------------------------------------------------------------------------

export interface CheckinPoint {
  id: string;
  name: string;
  active: boolean;
}

export interface ValidatorDevice {
  id: string;
  name: string;
  status: string;
  registeredAt: string;
  lastSeenAt: string | null;
}

export const validatorConfigApi = {
  listCheckinPoints: (token: string, eventId: string) =>
    request<CheckinPoint[]>(`/v1/events/${eventId}/checkin-points`, { token }),
  createCheckinPoint: (token: string, eventId: string, name: string) =>
    request<CheckinPoint>(`/v1/events/${eventId}/checkin-points`, { method: "POST", body: { name }, token }),
  createCredential: (token: string, eventId: string, label: string) =>
    request<{ id: string; label: string; expiresAt: string; pin: string }>(
      `/v1/events/${eventId}/validator-credentials`,
      { method: "POST", body: { label }, token },
    ),
  listDevices: (token: string, eventId: string) =>
    request<ValidatorDevice[]>(`/v1/events/${eventId}/validator-devices`, { token }),
  blockDevice: (token: string, eventId: string, deviceId: string) =>
    request(`/v1/events/${eventId}/validator-devices/${deviceId}/block`, { method: "POST", token }),
};

export const passwordAuth = {
  register: (input: { name: string; email: string; password: string }) =>
    request<{ token: string; user: SessionUser }>("/v1/identity/register", {
      method: "POST",
      body: { ...input, acceptTerms: true },
    }),
  login: (email: string, password: string) =>
    request<{ token: string; user: SessionUser }>("/v1/identity/login", {
      method: "POST",
      body: { email, password },
    }),
  recover: (email: string) =>
    request<{ sent: boolean }>("/v1/identity/recover", { method: "POST", body: { email } }),
  reset: (token: string, password: string) =>
    request<{ token: string; user: SessionUser }>("/v1/identity/reset-password", {
      method: "POST",
      body: { token, password },
    }),
};

export interface UpdateEventInput {
  title?: string;
  description?: string;
  /** atrações, uma por linha */
  lineup?: string;
  /** o que está incluso, um item por linha */
  amenities?: string;
  /** idade mínima em anos */
  minAge?: number;
  category?: EventCategory;
  startsAt?: string;
  endsAt?: string;
  /** updateEventSchema valida `z.string().url().optional()` — null derruba a request. */
  bannerUrl?: string;
  waitingRoomEnabled?: boolean;
  waitingRoomConcurrency?: number;
  pixelSettings?: PixelSettings;
  /** A API cria/atualiza o local e vincula ao evento. */
  venue?: EventVenue;
}

export const eventControls = {
  unpublish: (eventId: string, token: string) =>
    request(`/v1/events/${eventId}/unpublish`, { method: "POST", token }),
  republish: (eventId: string, token: string) =>
    request(`/v1/events/${eventId}/republish`, { method: "POST", token }),
  update: (eventId: string, body: UpdateEventInput, token: string) =>
    request<EventSummary>(`/v1/events/${eventId}`, { method: "PATCH", body, token }),
  /**
   * Upload do banner (multipart, campo "file") — fora do `request` porque lá o
   * corpo vira JSON; aqui o browser define o Content-Type com boundary sozinho.
   */
  uploadBanner: async (eventId: string, file: File, token: string): Promise<{ bannerUrl: string }> => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API_BASE_URL}/v1/events/${eventId}/banner`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) throw new ApiError(response.status, data?.message ?? "Falha ao enviar o banner");
    return data as { bannerUrl: string };
  },
};

export const couponsApi = {
  list: (eventId: string, token: string) =>
    request<Array<{ id: string; code: string; discountType: string; discountValue: number; redeemedCount: number; maxRedemptions: number | null; active: boolean }>>(
      `/v1/events/${eventId}/coupons`, { token }),
  create: (eventId: string, body: Record<string, unknown>, token: string) =>
    request(`/v1/events/${eventId}/coupons`, { method: "POST", body, token }),
  deactivate: (couponId: string, token: string) =>
    request(`/v1/coupons/${couponId}/deactivate`, { method: "POST", token }),
};

export const complimentaryApi = {
  list: (eventId: string, token: string) =>
    request<Array<{ id: string; publicToken: string; contactName: string | null; contactEmail: string; status: string; createdAt: string; items: Array<{ quantity: number; ticketLot: { name: string } }> }>>(
      `/v1/events/${eventId}/complimentary-tickets`, { token }),
  issue: (eventId: string, body: Record<string, unknown>, token: string) =>
    request(`/v1/events/${eventId}/complimentary-tickets`, { method: "POST", body, token }),
};

export interface BankAccount {
  id: string;
  bankCode: string;
  agency: string;
  account: string;
  accountType: string;
  holderName: string;
  holderDocument: string;
  pixKey?: string | null;
  isDefault: boolean;
}

/** createBankAccountSchema exige holderDocument e accountType — sem eles a API devolve 400. */
export interface CreateBankAccountInput {
  holderName: string;
  holderDocument: string;
  bankCode: string;
  agency: string;
  account: string;
  accountType: "corrente" | "poupanca";
  pixKey?: string;
}

export const bankAccountsApi = {
  add: (organizationId: string, body: CreateBankAccountInput, token: string) =>
    request<BankAccount>(`/v1/organizations/${organizationId}/bank-accounts`, { method: "POST", body, token }),
  list: (organizationId: string, token: string) =>
    request<BankAccount[]>(`/v1/organizations/${organizationId}/bank-accounts`, { token }),
};

// ---------------------------------------------------------------------------
// Vendas (pedidos + PDV + reembolso) — painel > evento > Vendas
// ---------------------------------------------------------------------------

export interface OrderSummary {
  id: string;
  publicToken: string;
  contactName: string | null;
  contactEmail: string;
  status: string;
  totalCents: number;
  createdAt: string;
  paidAt: string | null;
  _count: { tickets: number };
}

export interface OrderDetail {
  id: string;
  publicToken: string;
  contactName: string | null;
  contactEmail: string;
  status: string;
  totalCents: number;
  discountCents: number;
  createdAt: string;
  paidAt: string | null;
  event: { id: string; title: string };
  items: Array<{
    id: string;
    quantity: number;
    priceCents: number;
    feeCents: number;
    ticketLot: { name: string; ticketType: { name: string } };
  }>;
  payments: Array<{ id: string; method: string; status: string; amountCents: number; provider: string; paidAt: string | null }>;
  tickets: Array<{ id: string; code: string; status: string; attendeeName: string | null }>;
}

export const ordersApi = {
  list: (eventId: string, token: string, params?: { status?: string; page?: number; pageSize?: number }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.page) query.set("page", String(params.page));
    if (params?.pageSize) query.set("pageSize", String(params.pageSize));
    const qs = query.toString();
    return request<{ total: number; page: number; pageSize: number; orders: OrderSummary[] }>(
      `/v1/events/${eventId}/orders${qs ? `?${qs}` : ""}`, { token },
    );
  },
  detail: (orderId: string, token: string) => request<OrderDetail>(`/v1/orders/${orderId}/detail`, { token }),
  refund: (orderId: string, body: { amountCents?: number; reason: string }, token: string) =>
    request(`/v1/orders/${orderId}/refund`, { method: "POST", body, token }),
  createPdvSale: (
    eventId: string,
    body: { ticketLotId: string; quantity: number; buyerName: string; buyerDocument?: string; buyerEmail?: string },
    token: string,
  ) => request<{ orderId: string; publicToken: string }>(`/v1/events/${eventId}/pdv-orders`, { method: "POST", body, token }),
};

// ---------------------------------------------------------------------------
// Repasses (payouts) — leitura, painel > Financeiro (criação é exclusiva do backoffice admin)
// ---------------------------------------------------------------------------

export interface Payout {
  id: string;
  amountCents: number;
  status: string;
  requestedAt: string;
  paidAt: string | null;
  notes: string | null;
}

/** Solicitação de saque feita pelo produtor (fila que o backoffice aprova). */
export interface PayoutRequest {
  id: string;
  amountCents: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PAID" | string;
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

// ---------------------------------------------------------------------------
// Lista de convidados
// ---------------------------------------------------------------------------

export type GuestListStatus = "CONFIRMED" | "CHECKED_IN" | "CANCELED";

export interface GuestListEntry {
  id: string;
  eventId: string;
  ticketLotId: string;
  salesPartnerId: string | null;
  addedByUserId: string;
  orderId: string | null;
  guestName: string;
  guestDocument: string | null;
  guestPhone: string | null;
  status: GuestListStatus;
  ticketId: string | null;
  createdAt: string;
  ticketLot: { name: string };
  salesPartner: { id: string; name: string } | null;
  ticket: { id: string; status: string; code: string; checkedInAt: string | null } | null;
}

export interface CreateGuestListEntryInput {
  ticketLotId: string;
  guestName: string;
  guestDocument?: string;
  guestPhone?: string;
  salesPartnerId?: string;
}

export const guestListApi = {
  list: (token: string, eventId: string) =>
    request<GuestListEntry[]>(`/v1/events/${eventId}/guest-list`, { token }),
  create: (token: string, eventId: string, input: CreateGuestListEntryInput) =>
    request<GuestListEntry>(`/v1/events/${eventId}/guest-list`, { method: "POST", body: input, token }),
  cancel: (token: string, eventId: string, id: string) =>
    request<GuestListEntry>(`/v1/events/${eventId}/guest-list/${id}`, { method: "DELETE", token }),
};

export const payoutsApi = {
  list: (organizationId: string, token: string) =>
    request<Payout[]>(`/v1/organizations/${organizationId}/payouts`, { token }),
  listRequests: (organizationId: string, token: string) =>
    request<PayoutRequest[]>(`/v1/organizations/${organizationId}/payout-requests`, { token }),
  requestPayout: (organizationId: string, amountCents: number, token: string) =>
    request<PayoutRequest>(`/v1/organizations/${organizationId}/payout-requests`, {
      method: "POST",
      body: { amountCents },
      token,
    }),
};
