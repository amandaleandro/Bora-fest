import { API_BASE_URL } from "./config";

export type VipInventoryKind = "MESA" | "CAMAROTE" | "LOUNGE" | "BISTRO" | "OUTRO";
export type VipReservationStatus = "REQUESTED" | "CONFIRMED" | "REJECTED" | "CANCELED";

export interface VipInventory {
  id: string;
  eventId: string;
  kind: VipInventoryKind;
  name: string;
  description: string | null;
  benefits: string | null;
  unitPriceCents: number;
  quantity: number;
  capacityPerUnit: number;
  maxUnitsPerReservation: number;
  active: boolean;
  confirmedUnits: number;
  availableUnits: number;
}

export interface VipReservation {
  id: string;
  publicToken: string;
  vipInventoryId: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  partySize: number;
  units: number;
  unitPriceCents: number;
  totalCents: number;
  status: VipReservationStatus;
  customerNote: string | null;
  resolutionNote: string | null;
  respondedAt: string | null;
  createdAt: string;
  inventory: { id: string; name: string; kind: VipInventoryKind };
}

export interface VipPaymentSummary {
  depositCents: number | null;
  paymentDueAt: string | null;
  paidCents: number;
  refundPendingCents: number;
  depositRemainingCents: number;
  totalRemainingCents: number;
  latestPayment: {
    id: string;
    method: "PIX" | "CARD";
    status: string;
    amountCents: number;
    pixQrCodeText: string | null;
    failReason: string | null;
    expiresAt: string | null;
    paidAt: string | null;
  } | null;
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = "Não foi possível concluir a operação VIP";
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

export function getVipInventory(token: string, eventId: string) {
  return api<VipInventory[]>(`/v1/events/${eventId}/vip/inventory`, token);
}

export function getVipReservations(token: string, eventId: string) {
  return api<VipReservation[]>(`/v1/events/${eventId}/vip/reservations`, token);
}

export function getVipPaymentSummary(token: string, reservationId: string) {
  return api<VipPaymentSummary>(`/v1/vip/reservations/${reservationId}/payment`, token);
}

export function configureVipDeposit(
  token: string,
  reservationId: string,
  input: { depositCents: number; paymentDueAt?: string | null },
) {
  return api<VipPaymentSummary>(`/v1/vip/reservations/${reservationId}/deposit`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function createVipInventory(
  token: string,
  eventId: string,
  input: {
    kind: VipInventoryKind;
    name: string;
    description?: string;
    benefits?: string;
    unitPriceCents: number;
    quantity: number;
    capacityPerUnit: number;
    maxUnitsPerReservation: number;
  },
) {
  return api<VipInventory>(`/v1/events/${eventId}/vip/inventory`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateVipInventory(token: string, id: string, input: Partial<VipInventory>) {
  const allowed = {
    kind: input.kind,
    name: input.name,
    description: input.description,
    benefits: input.benefits,
    unitPriceCents: input.unitPriceCents,
    quantity: input.quantity,
    capacityPerUnit: input.capacityPerUnit,
    maxUnitsPerReservation: input.maxUnitsPerReservation,
    active: input.active,
  };
  return api<VipInventory>(`/v1/vip/inventory/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(allowed),
  });
}

export function manageVipReservation(
  token: string,
  id: string,
  action: "CONFIRM" | "REJECT" | "CANCEL",
  note?: string,
) {
  return api<VipReservation>(`/v1/vip/reservations/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify({ action, note: note || undefined }),
  });
}
