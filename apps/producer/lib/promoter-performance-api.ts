import { API_BASE_URL } from "./config";

export interface PromoterPerformanceRow {
  id: string;
  status: "INVITED" | "ACTIVE" | "REMOVED";
  promoterName: string;
  promoterUserId: string;
  slug: string;
  code: string | null;
  scope: "EVENT" | "HOUSE";
  activeSellers: number;
  paidOrders: number;
  ticketsSold: number;
  directTickets: number;
  sellerTickets: number;
  grossCents: number;
  commissionCents: number;
  commissionType: "NONE" | "PERCENT" | "FIXED";
  commissionBps: number;
  commissionFixedCents: number;
  rank: number | null;
}

export interface PromoterPerformanceResponse {
  event: {
    id: string;
    title: string;
    slug: string;
    startsAt: string;
    endsAt: string;
    status: string;
  };
  summary: {
    activePromoters: number;
    invitedPromoters: number;
    ticketsSold: number;
    paidOrders: number;
    grossCents: number;
    commissionCents: number;
  };
  promoters: PromoterPerformanceRow[];
}

export async function getPromoterPerformance(token: string, organizationId: string, eventId: string) {
  const response = await fetch(
    `${API_BASE_URL}/v1/organizations/${organizationId}/events/${eventId}/promoters/performance`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    let message = "Não foi possível carregar o desempenho dos promoters";
    try {
      const payload = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(payload.message)) message = payload.message.join(" · ");
      else if (payload.message) message = payload.message;
    } catch {
      // mantém fallback
    }
    throw new Error(message);
  }
  return (await response.json()) as PromoterPerformanceResponse;
}
