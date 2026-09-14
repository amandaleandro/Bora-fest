import { API_BASE_URL } from "./config";

export type LoyaltyLevel = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | null;

export interface CustomerIntelligence {
  email: string;
  name: string | null;
  phone: string | null;
  userId: string | null;
  ltvCents: number;
  ticketGrossCents: number;
  vipGrossCents: number;
  refundCents: number;
  netContributionCents: number;
  avgPurchaseCents: number;
  promoterGrossCents: number;
  promoterSharePct: number;
  primaryPromoterName: string | null;
  eventsCount: number;
  purchaseCount: number;
  lastPurchaseAt: string | null;
  daysSinceLastPurchase: number | null;
  lastEventAt: string | null;
  nextEventAt: string | null;
  ticketsCount: number;
  checkedInTickets: number;
  vipPurchases: number;
  loyalty: {
    enabled: boolean;
    points: number;
    lifetimePoints: number;
    level: LoyaltyLevel;
    rewardsRedeemed: number;
  };
}

export interface CustomerIntelligenceResponse {
  page: number;
  pageSize: number;
  total: number;
  summary: {
    totalCustomers: number;
    totalLtvCents: number;
    avgLtvCents: number;
    vipCustomers: number;
    loyaltyMembers: number;
    promoterCustomers: number;
  };
  customers: CustomerIntelligence[];
}

export async function getCustomerIntelligence(
  token: string,
  organizationId: string,
  input: { q?: string; page?: number; pageSize?: number } = {},
) {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.page) params.set("page", String(input.page));
  if (input.pageSize) params.set("pageSize", String(input.pageSize));
  const response = await fetch(
    `${API_BASE_URL}/v1/organizations/${organizationId}/intelligence/customers?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!response.ok) {
    let message = "Não foi possível carregar o LTV dos clientes";
    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message) ? body.message.join(" · ") : body.message || message;
    } catch {
      // mantém fallback
    }
    throw new Error(message);
  }
  return (await response.json()) as CustomerIntelligenceResponse;
}
