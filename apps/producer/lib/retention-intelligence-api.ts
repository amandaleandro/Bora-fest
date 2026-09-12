import { API_BASE_URL } from "./config";

export interface RetentionIntelligenceResponse {
  summary: {
    totalCustomers: number;
    repeatCustomers: number;
    repeatRatePct: number;
    frequentCustomers: number;
    lapsed30Customers: number;
    noShowCustomers: number;
    totalRevenueCents: number;
    repeatRevenueCents: number;
    repeatRevenueSharePct: number;
    promoterRevenueCents: number;
    promoterRevenueSharePct: number;
    avgRevenuePerCustomerCents: number;
  };
  trend: Array<{
    month: string;
    uniqueCustomers: number;
    newCustomers: number;
    returningCustomers: number;
    revenueCents: number;
  }>;
  events: Array<{
    eventId: string;
    title: string;
    startsAt: string;
    buyers: number;
    newCustomers: number;
    returningCustomers: number;
    returnRatePct: number;
    revenueCents: number;
    ticketsCount: number;
    checkedInTickets: number;
    attendanceRatePct: number;
  }>;
}

export async function getRetentionIntelligence(token: string, organizationId: string) {
  const response = await fetch(
    `${API_BASE_URL}/v1/organizations/${organizationId}/customers/retention`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    let message = "Não foi possível carregar a inteligência de retenção";
    try {
      const payload = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(payload.message)) message = payload.message.join(" · ");
      else if (payload.message) message = payload.message;
    } catch {
      // mantém fallback
    }
    throw new Error(message);
  }
  return (await response.json()) as RetentionIntelligenceResponse;
}
