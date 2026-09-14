import { API_BASE_URL } from "./config";

export interface RevenueIntelligenceResponse {
  summary: {
    grossCents: number;
    ticketGrossCents: number;
    vipGrossCents: number;
    vipRevenueSharePct: number;
    promoterGrossCents: number;
    promoterRevenueSharePct: number;
    directTicketGrossCents: number;
    refundCents: number;
    platformFeeCents: number;
    commissionCents: number;
    netCents: number;
  };
  trend: Array<{
    month: string;
    ticketGrossCents: number;
    vipGrossCents: number;
    refundCents: number;
    netCents: number;
  }>;
  events: Array<{
    eventId: string;
    title: string;
    startsAt: string;
    grossCents: number;
    ticketGrossCents: number;
    vipGrossCents: number;
    vipRevenueSharePct: number;
    promoterGrossCents: number;
    promoterRevenueSharePct: number;
    refundCents: number;
    platformFeeCents: number;
    commissionCents: number;
    netCents: number;
  }>;
}

export async function getRevenueIntelligence(token: string, organizationId: string) {
  const response = await fetch(`${API_BASE_URL}/v1/organizations/${organizationId}/intelligence/revenue`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    let message = "Não foi possível carregar a inteligência de receita";
    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message) ? body.message.join(" · ") : body.message || message;
    } catch {
      // mantém fallback
    }
    throw new Error(message);
  }
  return (await response.json()) as RevenueIntelligenceResponse;
}
