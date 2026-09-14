import type { PaymentMethod, PaymentStatus } from "@prisma/client";

/**
 * N8.1 usa tabelas de pagamento VIP isoladas do `Payment` de ingressos.
 * Enquanto o domínio não vira model Prisma, estes tipos mantêm API/worker
 * alinhados com a migration e evitam `any` espalhado nas queries raw.
 */
export interface VipPaymentRow {
  id: string;
  vipReservationId: string;
  provider: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  externalId: string | null;
  pixQrCodeText: string | null;
  failReason: string | null;
  expiresAt: Date | null;
  paidAt: Date | null;
  metadata: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VipPaymentEventRow {
  id: string;
  vipPaymentId: string;
  provider: string;
  externalEventId: string;
  type: string;
  payload: unknown;
  processedAt: Date | null;
  createdAt: Date;
}
