export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface EventSummary {
  id: string;
  title: string;
  slug: string;
  bannerUrl: string | null;
  startsAt: string;
  timezone: string;
  venue: { name: string; city: string; state: string } | null;
  fromPriceCents: number | null;
}

export interface EventListResponse {
  total: number;
  page: number;
  pageSize: number;
  events: EventSummary[];
}

export interface PublicTicketLot {
  id: string;
  name: string;
  priceCents: number;
  feeCents: number;
  capacity: number;
  soldCount: number;
  reservedCount: number;
  status: string;
}

export interface PublicTicketType {
  id: string;
  name: string;
  description: string | null;
  lots: PublicTicketLot[];
}

export interface PublicEvent {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  bannerUrl: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venue: { name: string; address: string; city: string; state: string } | null;
  ticketTypes: PublicTicketType[];
}

export interface AvailabilityItem {
  ticketTypeId: string;
  ticketTypeName: string;
  lotId: string;
  lotName: string;
  priceCents: number;
  feeCents: number;
  available: number;
}

export interface Reservation {
  id: string;
  eventId: string;
  status: string;
  expiresAt: string;
  items: Array<{ ticketLotId: string; quantity: number; priceCents: number; feeCents: number }>;
}

export interface Order {
  id: string;
  publicToken: string;
  eventId: string;
  contactEmail: string;
  contactName: string | null;
  status: string;
  totalCents: number;
  createdAt: string;
  paidAt: string | null;
  items: Array<{ ticketLotId: string; quantity: number; priceCents: number; feeCents: number }>;
}

export interface PixPayment {
  id: string;
  status: string;
  pixQrCodeText: string | null;
  expiresAt: string | null;
}

export interface OrderTicket {
  id: string;
  code: string;
  qrToken: string;
  status: string;
  seq: number;
  attendeeName: string | null;
  issuedAt: string;
  lotName: string;
  typeName: string;
}

export interface OrderTicketsResponse {
  orderId: string;
  orderStatus: string;
  event: { title: string; slug: string; startsAt: string; endsAt: string };
  tickets: OrderTicket[];
}

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
}

export interface MyTicket {
  id: string;
  code: string;
  qrToken: string;
  status: string;
  seq: number;
  attendeeName: string | null;
  issuedAt: string;
  lotName: string;
  typeName: string;
  event: { title: string; slug: string; startsAt: string; endsAt: string };
}
