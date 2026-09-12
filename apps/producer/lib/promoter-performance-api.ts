export interface PromoterPerformanceRow {
  id: string;
  status: "INVITED" | "ACTIVE";
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
