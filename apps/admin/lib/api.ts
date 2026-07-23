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
  platformRole: string | null;
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
// Admin
// ---------------------------------------------------------------------------

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  pixFeeBps: number | null;
  pixFeeFloorCents: number | null;
  cardFeeBps: number | null;
  createdAt: string;
  _count: { events: number; members: number };
}

export interface AdminEvent {
  id: string;
  title: string;
  slug: string;
  status: string;
  startsAt: string;
  organization: { id: string; name: string };
}

export interface AdminOrder {
  id: string;
  publicToken: string;
  contactName: string | null;
  contactEmail: string;
  status: string;
  totalCents: number;
  createdAt: string;
  event: { id: string; title: string; organization: { id: string; name: string } };
  payments: Array<{ id: string; provider: string; method: string; status: string; externalId: string | null }>;
}

export interface WebhookDelivery {
  id: string;
  provider: string;
  eventType: string | null;
  status: string;
  signatureValid: boolean;
  error: string | null;
  receivedAt: string;
}

export interface QueuesHealth {
  queues: Record<string, { active: number; completed: number; delayed: number; failed: number; waiting: number }>;
  outboxEvents: Record<string, number>;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  organizationId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: string;
}

export interface Payout {
  id: string;
  organizationId: string;
  amountCents: number;
  status: string;
  requestedAt: string;
  paidAt: string | null;
  notes: string | null;
}

export const adminApi = {
  listOrganizations: (token: string) => request<AdminOrganization[]>("/v1/admin/organizations", { token }),

  getOrganization: (token: string, id: string) =>
    request<AdminOrganization & { events: AdminEvent[] }>(`/v1/admin/organizations/${id}`, { token }),

  setFee: (
    token: string,
    id: string,
    input: { pixFeeBps?: number | null; pixFeeFloorCents?: number | null; cardFeeBps?: number | null },
  ) => request(`/v1/admin/organizations/${id}/fee`, { method: "POST", body: input, token }),

  blockOrganization: (token: string, id: string, reason: string) =>
    request(`/v1/admin/organizations/${id}/block`, { method: "POST", body: { reason }, token }),

  unblockOrganization: (token: string, id: string) =>
    request(`/v1/admin/organizations/${id}/unblock`, { method: "POST", token }),

  listEvents: (token: string, filters: { organizationId?: string; status?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.organizationId) params.set("organizationId", filters.organizationId);
    if (filters.status) params.set("status", filters.status);
    const query = params.toString();
    return request<AdminEvent[]>(`/v1/admin/events${query ? `?${query}` : ""}`, { token });
  },

  blockEvent: (token: string, id: string, reason: string) =>
    request(`/v1/admin/events/${id}/block`, { method: "POST", body: { reason }, token }),

  searchOrders: (token: string, filters: { publicToken?: string; email?: string; eventId?: string }) => {
    const params = new URLSearchParams();
    if (filters.publicToken) params.set("publicToken", filters.publicToken);
    if (filters.email) params.set("email", filters.email);
    if (filters.eventId) params.set("eventId", filters.eventId);
    return request<AdminOrder[]>(`/v1/admin/orders?${params.toString()}`, { token });
  },

  resendOrder: (token: string, publicToken: string) =>
    request<{ queued: boolean; channels: string[] }>(`/v1/admin/orders/${publicToken}/resend`, {
      method: "POST",
      token,
    }),

  refundOrder: (token: string, publicToken: string, input: { amountCents?: number; reason: string }) =>
    request(`/v1/admin/orders/${publicToken}/refund`, { method: "POST", body: input, token }),

  listWebhooks: (token: string, filters: { provider?: string; status?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.provider) params.set("provider", filters.provider);
    if (filters.status) params.set("status", filters.status);
    const query = params.toString();
    return request<WebhookDelivery[]>(`/v1/admin/webhooks${query ? `?${query}` : ""}`, { token });
  },

  getQueuesHealth: (token: string) => request<QueuesHealth>("/v1/admin/queues", { token }),

  blockTicket: (token: string, id: string, reason: string) =>
    request(`/v1/admin/tickets/${id}/block`, { method: "POST", body: { reason }, token }),

  listAuditLogs: (
    token: string,
    filters: { entityType?: string; entityId?: string; organizationId?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (filters.entityType) params.set("entityType", filters.entityType);
    if (filters.entityId) params.set("entityId", filters.entityId);
    if (filters.organizationId) params.set("organizationId", filters.organizationId);
    const query = params.toString();
    return request<AuditLogEntry[]>(`/v1/admin/audit-logs${query ? `?${query}` : ""}`, { token });
  },

  getOrganizationLedger: (token: string, id: string) =>
    request<{ balanceCents: number; availableForPayoutCents: number; entries: unknown[] }>(
      `/v1/admin/organizations/${id}/ledger`,
      { token },
    ),

  listPayouts: (token: string, filters: { organizationId?: string; status?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.organizationId) params.set("organizationId", filters.organizationId);
    if (filters.status) params.set("status", filters.status);
    const query = params.toString();
    return request<Payout[]>(`/v1/admin/payouts${query ? `?${query}` : ""}`, { token });
  },

  createPayout: (token: string, organizationId: string) =>
    request<Payout>(`/v1/admin/organizations/${organizationId}/payouts`, { method: "POST", token }),

  markPayoutPaid: (token: string, id: string, notes?: string) =>
    request<Payout>(`/v1/admin/payouts/${id}/mark-paid`, { method: "POST", body: { notes }, token }),
};
