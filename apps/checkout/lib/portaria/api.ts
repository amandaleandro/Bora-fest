import { API_BASE_URL } from "../config";
import { ApiError } from "../api";
import type {
  ManifestResponse,
  RecentCheckin,
  ScanResult,
  Session,
  SummaryResponse,
} from "./types";

/**
 * Cliente da portaria. A distinção que importa aqui é entre **sem rede**
 * (OfflineError → cai na validação local) e **não autorizado** (ApiError 401/403
 * → tela "Acesso bloqueado", nunca offline).
 */
export class OfflineError extends Error {
  constructor(message = "Sem conexão com a internet") {
    super(message);
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; session?: Session | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  // Content-Type só com corpo: o Fastify rejeita (400) JSON declarado e vazio
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.session) {
    headers["x-device-id"] = options.session.deviceId;
    headers["x-device-token"] = options.session.deviceToken;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new OfflineError();
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new ApiError(response.status, data?.message ?? "Erro ao falar com a API");
  }
  return data as T;
}

export interface CheckinResponse {
  result: ScanResult["kind"];
  reason?: ScanResult["reason"];
  ticket?: {
    id: string;
    code: string;
    status: string;
    attendeeName: string | null;
    lotName: string;
    typeName: string;
  };
  checkinId?: string;
  firstCheckin?: { at: string | null; deviceName?: string; gateName?: string | null };
}

export interface SyncResponse {
  batchKey: string;
  received: number;
  confirmed: number;
  conflicts: number;
  invalid: number;
  items: Array<{
    localSeq: number;
    ticketId: string;
    status: "CONFIRMED" | "CONFLICT" | "INVALID";
    checkinId?: string;
  }>;
}

export const portariaApi = {
  listEvents: () =>
    request<{ events: Array<{ id: string; title: string; startsAt: string; venue: { name: string; city: string } | null }> }>(
      "/v1/public/events?pageSize=50",
    ).then((r) => r.events),

  createSession: (eventId: string, pin: string, deviceName: string) =>
    request<Session>("/v1/validator/sessions", {
      method: "POST",
      body: { session: { eventId, pin }, device: { name: deviceName } },
    }),

  manifest: (session: Session, since?: string) =>
    request<ManifestResponse>(
      since
        ? `/v1/validator/events/${session.event.id}/manifest/delta?since=${encodeURIComponent(since)}`
        : `/v1/validator/events/${session.event.id}/manifest`,
      { session },
    ),

  checkin: (
    session: Session,
    body: { qrToken?: string; code?: string; checkinPointId?: string; scannedAt?: string },
  ) => request<CheckinResponse>("/v1/checkins", { method: "POST", body, session }),

  sync: (
    session: Session,
    batchKey: string,
    items: Array<{
      localSeq: number;
      ticketId: string;
      checkinPointId?: string;
      scannedAt: string;
    }>,
  ) => request<SyncResponse>("/v1/checkins/sync", { method: "POST", body: { batchKey, items }, session }),

  summary: (session: Session) =>
    request<SummaryResponse>(`/v1/validator/events/${session.event.id}/summary`, { session }),

  recentCheckins: (session: Session) =>
    request<RecentCheckin[]>(`/v1/validator/events/${session.event.id}/recent-checkins`, { session }),

  reverse: (session: Session, checkinId: string) =>
    request<{ reversed: boolean }>(`/v1/validator/checkins/${checkinId}/reverse`, {
      method: "POST",
      session,
    }),
};
