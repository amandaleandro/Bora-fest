import { API_BASE_URL } from "./config";
import { lerConfirmacao2fa, limparConfirmacao2fa, pedirConfirmacao2fa } from "./confirmacao-2fa";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** código de máquina da API, quando houver (ex.: 2FA_NAO_ATIVADO) — 2026-10-12 */
    public code?: string,
  ) {
    super(message);
  }
}

/**
 * SESSÃO VENCIDA (2026-10-12): o backoffice nunca tratava 401 — com o token
 * expirado as telas ficavam vazias até clicar em Sair. Um 401 numa chamada COM
 * token avisa o AuthProvider (lib/auth.tsx), que faz o mesmo que o Sair e manda
 * ao login com aviso. O 401 do login (código errado) vai sem token: segue erro.
 */
export const SESSION_EXPIRED_EVENT = "bf:session-expired";
export const SESSION_EXPIRED_MESSAGE = "Sua sessão expirou — entre de novo";

// exportada (2026-10-12): a tela de banners faz fetch próprio (upload) e usa
// esta mesma regra de 401 em vez de repetir o disparo do evento
export function avisarSessaoVencida(status: number, token: string | null | undefined): boolean {
  if (status !== 401 || !token) return false;
  if (typeof window !== "undefined") {
    // o token vai junto: só derruba se ainda for o guardado (lib/auth.tsx)
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { token } }));
  }
  return true;
}

type RequestOptions = { method?: string; body?: unknown; token?: string | null; confirmacao2fa?: string | null };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Content-Type só com corpo: o Fastify rejeita (400) JSON declarado e vazio
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.confirmacao2fa) headers[CONFIRMACAO_2FA_HEADER] = options.confirmacao2fa;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    if (avisarSessaoVencida(response.status, options.token)) {
      throw new ApiError(401, SESSION_EXPIRED_MESSAGE);
    }
    throw new ApiError(response.status, data?.message ?? "Erro ao falar com a API", data?.code);
  }
  return data as T;
}

/**
 * SEGUNDO FATOR (2026-10-12): aprovar saque, gerar/marcar repasse, estornar,
 * aprovar reembolso, mudar taxa ou modo de repasse e aprovar/desbloquear casa
 * pedem a confirmação do app autenticador (cabeçalho abaixo). Manda a
 * confirmação guardada; se a API disser que falta (ou venceu), abre o modal do
 * código uma vez e repete a chamada. A 1ª chamada recusada não executa nada: a
 * API barra no guard, antes da ação. Sem 2FA ativo, o erro da API ("Ative em
 * Segurança") chega à tela como qualquer outro.
 */
export const CONFIRMACAO_2FA_HEADER = "X-Confirmacao-2FA";
export const ERRO_2FA_NAO_ATIVADO = "2FA_NAO_ATIVADO";
export const ERRO_2FA_CONFIRMACAO_NECESSARIA = "2FA_CONFIRMACAO_NECESSARIA";

async function requestComConfirmacao<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await request<T>(path, { ...options, confirmacao2fa: lerConfirmacao2fa() });
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== ERRO_2FA_CONFIRMACAO_NECESSARIA || !options.token) throw err;
  }
  const sessionToken = options.token;
  if (!sessionToken) throw new ApiError(401, SESSION_EXPIRED_MESSAGE);
  limparConfirmacao2fa();
  const confirmacao = await pedirConfirmacao2fa(sessionToken);
  if (!confirmacao) {
    throw new ApiError(
      403,
      "Ação não feita: ela só acontece com o código do aplicativo autenticador.",
      ERRO_2FA_CONFIRMACAO_NECESSARIA,
    );
  }
  return request<T>(path, { ...options, confirmacao2fa: confirmacao });
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
  settlementMode?: "STANDARD" | "INSTANT";
  refundHoldDays?: number;
  autoPayout?: boolean;
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

export interface AdminRefundRequest {
  id: string;
  reason: string;
  status: string;
  requestedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  order: {
    id: string;
    publicToken: string;
    contactEmail: string;
    contactName: string | null;
    totalCents: number;
    status: string;
  };
}

export const adminApi = {
  listOrganizations: (token: string) => request<AdminOrganization[]>("/v1/admin/organizations", { token }),

  getOrganization: (token: string, id: string) =>
    request<AdminOrganization & { events: AdminEvent[] }>(`/v1/admin/organizations/${id}`, { token }),

  setFee: (
    token: string,
    id: string,
    input: { pixFeeBps?: number | null; pixFeeFloorCents?: number | null; cardFeeBps?: number | null },
  ) => requestComConfirmacao(`/v1/admin/organizations/${id}/fee`, { method: "POST", body: input, token }),

  updateSettlement: (
    token: string,
    id: string,
    input: { settlementMode?: "STANDARD" | "INSTANT"; autoPayout?: boolean; refundHoldDays?: number },
  ) =>
    requestComConfirmacao<{ settlementMode: "STANDARD" | "INSTANT"; autoPayout: boolean; refundHoldDays: number }>(
      `/v1/admin/organizations/${id}/settlement`,
      { method: "POST", body: input, token },
    ),

  blockOrganization: (token: string, id: string, reason: string) =>
    request(`/v1/admin/organizations/${id}/block`, { method: "POST", body: { reason }, token }),

  unblockOrganization: (token: string, id: string) =>
    requestComConfirmacao(`/v1/admin/organizations/${id}/unblock`, { method: "POST", token }),

  approveOrganization: (token: string, id: string) =>
    requestComConfirmacao(`/v1/admin/organizations/${id}/approve`, { method: "POST", token }),

  /** etapa 1 da exclusão: manda o código de confirmação pro e-mail do admin */
  requestOrgDeleteCode: (token: string, id: string) =>
    request<{ sent: boolean; ttlMinutes: number }>(`/v1/admin/organizations/${id}/delete-code`, { method: "POST", token }),

  /** etapa 2: exclui a conta com o código (só org sem histórico financeiro) */
  deleteOrganization: (token: string, id: string, code: string) =>
    request<{ deleted: boolean }>(`/v1/admin/organizations/${id}`, { method: "DELETE", body: { code }, token }),

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
    requestComConfirmacao(`/v1/admin/orders/${publicToken}/refund`, { method: "POST", body: input, token }),

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
    requestComConfirmacao<Payout>(`/v1/admin/organizations/${organizationId}/payouts`, { method: "POST", token }),

  listPayoutRequests: (token: string, status = "PENDING") =>
    request<
      Array<{
        id: string;
        amountCents: number;
        status: string;
        anticipation: boolean;
        anticipationFeeCents: number;
        createdAt: string;
        organization: { id: string; name: string; settlementMode: string };
      }>
    >(`/v1/admin/payout-requests?status=${status}`, { token }),
  approvePayoutRequest: (token: string, id: string) =>
    requestComConfirmacao(`/v1/admin/payout-requests/${id}/approve`, { method: "POST", token }),
  rejectPayoutRequest: (token: string, id: string, note?: string) =>
    request(`/v1/admin/payout-requests/${id}/reject`, { method: "POST", body: { note }, token }),
  markPayoutPaid: (token: string, id: string, notes?: string) =>
    requestComConfirmacao<Payout>(`/v1/admin/payouts/${id}/mark-paid`, { method: "POST", body: { notes }, token }),

  // Fila de reembolsos do comprador (refund-requests). Nos eventos de casas no
  // repasse PADRÃO quem analisa é a BoraFest — sem esta tela a fila fica PENDING
  // invisível. Aprovar dispara o estorno de verdade no gateway.
  listRefundRequests: (token: string, status?: string) => {
    const query = status ? `?status=${status}` : "";
    return request<AdminRefundRequest[]>(`/v1/admin/refund-requests${query}`, { token });
  },
  approveRefundRequest: (token: string, id: string, amountCents?: number) =>
    requestComConfirmacao(`/v1/admin/refund-requests/${id}/approve`, {
      method: "POST",
      body: amountCents != null ? { amountCents } : {},
      token,
    }),
  rejectRefundRequest: (token: string, id: string, note: string) =>
    request(`/v1/admin/refund-requests/${id}/reject`, { method: "POST", body: { note }, token }),
};

// ---------------------------------------------------------------------------
// Segurança — segundo fator do backoffice (2026-10-12)
// ---------------------------------------------------------------------------

export interface Status2fa {
  ativo: boolean;
  ativoDesde: string | null;
  /** chave gerada e ainda não confirmada com um código */
  ativacaoPendente: boolean;
  /** false = falta TOTP_ENCRYPTION_KEY no servidor: ninguém consegue ativar */
  servidorPronto: boolean;
}

export const segurancaApi = {
  status: (token: string) => request<Status2fa>("/v1/admin/2fa", { token }),

  iniciarAtivacao: (token: string) =>
    request<{ segredo: string; otpauthUrl: string; digitos: number; periodoSegundos: number }>(
      "/v1/admin/2fa/ativacao",
      { method: "POST", token },
    ),

  confirmarAtivacao: (token: string, code: string) =>
    request<{ ativo: boolean; ativoDesde: string; confirmacao: string; expiraEm: string }>(
      "/v1/admin/2fa/ativacao/confirmar",
      { method: "POST", body: { code }, token },
    ),

  confirmarAcao: (token: string, code: string) =>
    request<{ confirmacao: string; expiraEm: string }>("/v1/admin/2fa/confirmar-acao", {
      method: "POST",
      body: { code },
      token,
    }),
};
