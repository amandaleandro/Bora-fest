import { API_BASE_URL } from "./config";

export type CustomerSegment =
  | "ALL"
  | "FIRST_TIME"
  | "RECURRING"
  | "FREQUENT"
  | "LAPSED_30"
  | "NO_SHOW"
  | "FOLLOWER"
  | "EMAIL_OPT_IN";

export interface CrmCustomer {
  email: string;
  name: string | null;
  phone: string | null;
  userId: string | null;
  paidOrders: number;
  eventsCount: number;
  spentCents: number;
  firstPurchaseAt: string | null;
  lastPurchaseAt: string;
  lastEventAt: string | null;
  nextEventAt: string | null;
  ticketsCount: number;
  checkedInTickets: number;
  attendedEvents: number;
  followsHouse: boolean;
  emailOffersOptIn: boolean;
  lastPromoterName: string | null;
  tags: string[];
}

export interface CustomerCrmResponse {
  page: number;
  pageSize: number;
  total: number;
  summary: {
    recurring: number;
    frequent: number;
    lapsed30: number;
    noShow: number;
    followers: number;
    emailOptIn: number;
  };
  customers: CrmCustomer[];
}

export async function getCasaCustomers(
  token: string,
  organizationId: string,
  input: { q?: string; segment?: CustomerSegment; page?: number; pageSize?: number },
) {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.segment && input.segment !== "ALL") params.set("segment", input.segment);
  if (input.page) params.set("page", String(input.page));
  if (input.pageSize) params.set("pageSize", String(input.pageSize));

  const response = await fetch(`${API_BASE_URL}/v1/organizations/${organizationId}/customers?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    let message = "Não foi possível carregar os clientes";
    try {
      const payload = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(payload.message)) message = payload.message.join(" · ");
      else if (payload.message) message = payload.message;
    } catch {
      // mantém fallback
    }
    throw new Error(message);
  }
  return (await response.json()) as CustomerCrmResponse;
}
