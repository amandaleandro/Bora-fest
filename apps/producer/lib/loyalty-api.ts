import { API_BASE_URL } from "./config";

export interface LoyaltyProgram {
  id: string;
  enabled: boolean;
  pointsPerReal: number;
  silverPoints: number;
  goldPoints: number;
  platinumPoints: number;
}

export interface LoyaltyAccount {
  id: string;
  email: string;
  name: string | null;
  userId: string | null;
  points: number;
  lifetimePoints: number;
  level: "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";
  lastActivityAt: string | null;
}

export interface LoyaltyAccountsResponse {
  page: number;
  pageSize: number;
  total: number;
  program: LoyaltyProgram;
  summary: {
    pointsOutstanding: number;
    silver: number;
    gold: number;
    platinum: number;
  };
  accounts: LoyaltyAccount[];
}

export interface LoyaltyReward {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  pointsCost: number;
  quantity: number | null;
  maxPerCustomer: number;
  active: boolean;
  claimed: string | number;
  available: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltyRedemption {
  id: string;
  code: string;
  status: "ISSUED" | "USED";
  pointsCost: number;
  createdAt: string;
  usedAt: string | null;
  rewardName: string;
  customerEmail: string;
  customerName: string | null;
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = "Não foi possível concluir a operação de fidelidade";
    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message) ? body.message.join(" · ") : body.message || message;
    } catch {
      // mantém fallback
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function getLoyaltyProgram(token: string, organizationId: string) {
  return request<LoyaltyProgram>(`/v1/organizations/${organizationId}/loyalty/program`, token);
}

export function updateLoyaltyProgram(token: string, organizationId: string, input: Omit<LoyaltyProgram, "id">) {
  return request<LoyaltyProgram>(`/v1/organizations/${organizationId}/loyalty/program`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getLoyaltyAccounts(
  token: string,
  organizationId: string,
  input: { q?: string; page?: number; pageSize?: number },
) {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.page) params.set("page", String(input.page));
  if (input.pageSize) params.set("pageSize", String(input.pageSize));
  return request<LoyaltyAccountsResponse>(
    `/v1/organizations/${organizationId}/loyalty/accounts?${params.toString()}`,
    token,
  );
}

export function getLoyaltyRewards(token: string, organizationId: string) {
  return request<LoyaltyReward[]>(`/v1/organizations/${organizationId}/loyalty/rewards`, token);
}

export function createLoyaltyReward(
  token: string,
  organizationId: string,
  input: { name: string; description?: string; pointsCost: number; quantity?: number | null; maxPerCustomer: number },
) {
  return request<LoyaltyReward>(`/v1/organizations/${organizationId}/loyalty/rewards`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateLoyaltyReward(
  token: string,
  organizationId: string,
  rewardId: string,
  input: Partial<{ name: string; description: string; pointsCost: number; quantity: number | null; maxPerCustomer: number; active: boolean }>,
) {
  return request<LoyaltyReward>(`/v1/organizations/${organizationId}/loyalty/rewards/${rewardId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getLoyaltyRedemptions(token: string, organizationId: string) {
  return request<LoyaltyRedemption[]>(`/v1/organizations/${organizationId}/loyalty/redemptions`, token);
}

export function useLoyaltyVoucher(token: string, organizationId: string, code: string) {
  return request<LoyaltyRedemption>(`/v1/organizations/${organizationId}/loyalty/redemptions/use`, token, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}
