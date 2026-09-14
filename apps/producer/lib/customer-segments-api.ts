import { API_BASE_URL } from "./config";

export type CustomerFinancialSegment =
  | "ALL"
  | "CHAMPION"
  | "HIGH_VALUE"
  | "NEW_HIGH_VALUE"
  | "LOYAL"
  | "AT_RISK"
  | "LOST_HIGH_VALUE"
  | "VIP_BUYER"
  | "PROMOTER_DRIVEN"
  | "LOYALTY_ENGAGED";

export interface CustomerSegmentSummary {
  key: Exclude<CustomerFinancialSegment, "ALL">;
  label: string;
  description: string;
  customers: number;
  totalLtvCents: number;
  avgLtvCents: number;
}

export interface SegmentedCustomer {
  email: string;
  name: string | null;
  ltvCents: number;
  ticketGrossCents: number;
  vipGrossCents: number;
  netContributionCents: number;
  promoterGrossCents: number;
  promoterSharePct: number;
  primaryPromoterName: string | null;
  eventsCount: number;
  purchaseCount: number;
  lastPurchaseAt: string | null;
  daysSinceLastPurchase: number | null;
  nextEventAt: string | null;
  attendanceRatePct: number;
  lifetimePoints: number;
  rewardsRedeemed: number;
  segments: string[];
}

export interface CustomerSegmentsResponse {
  page: number;
  pageSize: number;
  total: number;
  selectedSegment: CustomerFinancialSegment;
  thresholds: {
    highValueLtvCents: number;
    highValuePercentile: number;
  };
  segments: CustomerSegmentSummary[];
  customers: SegmentedCustomer[];
}

export async function getCustomerSegments(
  token: string,
  organizationId: string,
  input: { segment?: CustomerFinancialSegment; q?: string; page?: number; pageSize?: number } = {},
) {
  const params = new URLSearchParams();
  if (input.segment && input.segment !== "ALL") params.set("segment", input.segment);
  if (input.q) params.set("q", input.q);
  if (input.page) params.set("page", String(input.page));
  if (input.pageSize) params.set("pageSize", String(input.pageSize));

  const response = await fetch(
    `${API_BASE_URL}/v1/organizations/${organizationId}/intelligence/customer-segments?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!response.ok) {
    let message = "Não foi possível carregar os segmentos de clientes";
    try {
      const body = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(body.message) ? body.message.join(" · ") : body.message || message;
    } catch {
      // mantém fallback
    }
    throw new Error(message);
  }
  return (await response.json()) as CustomerSegmentsResponse;
}
