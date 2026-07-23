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
  const headers: Record<string, string> = { "Content-Type": "application/json" };
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
  slug: string;
  kind: string;
  status: string;
  document?: string;
}

export const organizationsApi = {
  list: (token: string) => request<Array<Organization & { roleKey: string }>>("/v1/organizations", { token }),
  create: (token: string, input: { name: string; kind: "INDIVIDUAL" | "COMPANY"; document: string }) =>
    request<Organization & { members: unknown[] }>("/v1/organizations", { method: "POST", body: input, token }),
  inviteMember: (token: string, organizationId: string, email: string, roleKey: string) =>
    request(`/v1/organizations/${organizationId}/members`, {
      method: "POST",
      body: { email, roleKey },
      token,
    }),
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EventSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  startsAt: string;
  endsAt: string;
  organizationId: string;
}

export const eventsApi = {
  list: (token: string, organizationId: string) =>
    request<EventSummary[]>(`/v1/organizations/${organizationId}/events`, { token }),
  create: (
    token: string,
    organizationId: string,
    input: { title: string; startsAt: string; endsAt: string; description?: string },
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
// Catalog
// ---------------------------------------------------------------------------

export interface TicketType {
  id: string;
  name: string;
  description: string | null;
}

export interface TicketLot {
  id: string;
  name: string;
  priceCents: number;
  feeCents: number;
  capacity: number;
  soldCount: number;
  reservedCount: number;
  status: string;
}

export const catalogApi = {
  createTicketType: (token: string, eventId: string, input: { name: string; position?: number }) =>
    request<TicketType>(`/v1/events/${eventId}/ticket-types`, { method: "POST", body: input, token }),
  createLot: (
    token: string,
    ticketTypeId: string,
    input: { name: string; priceCents: number; feeCents: number; capacity: number; maxPerOrder?: number },
  ) => request<TicketLot>(`/v1/ticket-types/${ticketTypeId}/lots`, { method: "POST", body: input, token }),
  activateLot: (token: string, lotId: string) =>
    request<TicketLot>(`/v1/ticket-lots/${lotId}/activate`, { method: "POST", token }),
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface Dashboard {
  event: { id: string; title: string; slug: string; status: string };
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

export const dashboardApi = {
  get: (token: string, eventId: string) => request<Dashboard>(`/v1/events/${eventId}/dashboard`, { token }),
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
};

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export interface Balance {
  organizationId: string;
  balanceCents: number;
  availableForPayoutCents: number;
}

export interface LedgerEntry {
  id: string;
  type: string;
  amountCents: number;
  referenceType: string;
  referenceId: string;
  createdAt: string;
}

export const financeApi = {
  getBalance: (token: string, organizationId: string) =>
    request<Balance>(`/v1/organizations/${organizationId}/balance`, { token }),
  getLedger: (token: string, organizationId: string) =>
    request<LedgerEntry[]>(`/v1/organizations/${organizationId}/ledger`, { token }),
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
