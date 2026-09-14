const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

export type BuyerReward = {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
  available: number | null;
  canRedeem: boolean;
  redeemedByMe: number;
  maxPerCustomer: number;
};

export type BuyerVoucher = {
  id: string;
  code: string;
  status: "ISSUED" | "USED";
  pointsCost: number;
  createdAt: string;
  usedAt: string | null;
  rewardName: string;
};

export type BuyerLoyaltyCasa = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  enabled: boolean;
  pointsPerReal: number;
  points: number;
  lifetimePoints: number;
  level: "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";
  rewards: BuyerReward[];
  vouchers: BuyerVoucher[];
};

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
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

export function getMyLoyalty(token: string) {
  return request<BuyerLoyaltyCasa[]>("/v1/me/loyalty", token);
}

export function redeemReward(token: string, organizationId: string, rewardId: string, idempotencyKey: string) {
  return request<{ id: string; code: string; status: "ISSUED"; rewardName: string; pointsCost: number }>(
    `/v1/me/loyalty/${organizationId}/rewards/${rewardId}/redeem`,
    token,
    { method: "POST", headers: { "Idempotency-Key": idempotencyKey } },
  );
}
