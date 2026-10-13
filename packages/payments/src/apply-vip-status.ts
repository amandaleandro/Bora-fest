import { Prisma, prisma, type VipPaymentRow } from "@borafest/database";
import type { GatewayPaymentStatus } from "./types";
import { addBusinessDays, lookupGatewayPaidAmountCents } from "./apply-status";
import { computePlatformFeeCents } from "./fees";

export interface ApplyVipStatusResult {
  paymentChanged: boolean;
  credited: boolean;
  orphaned: boolean;
  /** o gateway informou valor pago MENOR que o cobrado — nada foi faturado (2026-10-12) */
  amountMismatch?: boolean;
}

export interface ApplyVipStatusOptions {
  /** mesma semântica de ApplyStatusOptions.paidAmountCents (número / null / ausente) */
  paidAmountCents?: number | null;
}

type VipContext = {
  reservationId: string;
  reservationStatus: string;
  organizationId: string;
  eventEndsAt: Date;
};

const NON_MONETARY = ["PENDING", "AUTHORIZED", "EXPIRED", "FAILED", "CANCELED"] as const;

async function paymentForUpdate(tx: Prisma.TransactionClient, id: string): Promise<VipPaymentRow | null> {
  const rows = await tx.$queryRaw<VipPaymentRow[]>`
    SELECT
      id,
      vip_reservation_id AS "vipReservationId",
      provider,
      method,
      status,
      amount_cents AS "amountCents",
      external_id AS "externalId",
      pix_qr_code_text AS "pixQrCodeText",
      fail_reason AS "failReason",
      expires_at AS "expiresAt",
      paid_at AS "paidAt",
      metadata,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM vip_payments
    WHERE id = ${id}::uuid
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function reservationContext(tx: Prisma.TransactionClient, reservationId: string): Promise<VipContext | null> {
  const rows = await tx.$queryRaw<VipContext[]>`
    SELECT
      vr.id AS "reservationId",
      vr.status::text AS "reservationStatus",
      e.organization_id AS "organizationId",
      e.ends_at AS "eventEndsAt"
    FROM vip_reservations vr
    JOIN vip_inventory vi ON vi.id = vr.vip_inventory_id
    JOIN events e ON e.id = vi.event_id
    WHERE vr.id = ${reservationId}::uuid
  `;
  return rows[0] ?? null;
}

export async function applyVipGatewayStatus(
  paymentId: string,
  status: GatewayPaymentStatus,
  occurredAt?: Date,
  options?: ApplyVipStatusOptions,
): Promise<ApplyVipStatusResult> {
  if (status === "PENDING") return { paymentChanged: false, credited: false, orphaned: false };

  if (status === "AUTHORIZED") {
    const changed = await prisma.$executeRaw`
      UPDATE vip_payments
      SET status = 'AUTHORIZED'::"PaymentStatus", updated_at = CURRENT_TIMESTAMP
      WHERE id = ${paymentId}::uuid AND status = 'PENDING'::"PaymentStatus"
    `;
    return { paymentChanged: changed > 0, credited: false, orphaned: false };
  }

  if (status === "FAILED" || status === "CANCELED" || status === "EXPIRED") {
    const changed = await prisma.$executeRaw`
      UPDATE vip_payments
      SET status = ${status}::"PaymentStatus", updated_at = CURRENT_TIMESTAMP
      WHERE id = ${paymentId}::uuid
        AND status IN ('PENDING'::"PaymentStatus", 'AUTHORIZED'::"PaymentStatus")
    `;
    return { paymentChanged: changed > 0, credited: false, orphaned: false };
  }

  if (status === "PAID") {
    // a consulta ao gateway (quando o chamador não trouxe o valor) fica FORA
    // da transação — nunca segurar a trava da linha esperando a rede
    const informado = options?.paidAmountCents;
    const paidAmountCents =
      informado === null
        ? undefined
        : informado !== undefined
          ? informado
          : await resolveVipPaidAmountCents(paymentId);
    return applyPaid(paymentId, occurredAt, paidAmountCents);
  }
  if (status === "REFUNDED" || status === "CHARGEBACK") return applyReversal(paymentId, status);

  return { paymentChanged: false, credited: false, orphaned: false };
}

/** Valor pago segundo o gateway, só se o PAID ainda vai mudar algo (2026-10-12). */
async function resolveVipPaidAmountCents(paymentId: string): Promise<number | undefined> {
  const rows = await prisma.$queryRaw<Array<{ provider: string; externalId: string | null; status: string }>>`
    SELECT provider, external_id AS "externalId", status::text AS status
    FROM vip_payments
    WHERE id = ${paymentId}::uuid
    LIMIT 1
  `;
  const payment = rows[0];
  if (!payment?.externalId) return undefined;
  if (!NON_MONETARY.includes(payment.status as (typeof NON_MONETARY)[number])) return undefined;
  return lookupGatewayPaidAmountCents(payment.provider, payment.externalId, paymentId);
}

/**
 * VIP pago a MENOR (2026-10-12): mesma regra do ingresso — não fatura, a
 * reserva não é confirmada por este pagamento e o backoffice é alertado
 * (auditoria + outbox `vip.payment.amount_mismatch`). Idempotente pela
 * auditoria, sob a trava da linha (paymentForUpdate); não grava nada na
 * tabela vip_payments.
 */
async function registerVipAmountMismatch(
  tx: Prisma.TransactionClient,
  payment: VipPaymentRow,
  paidAmountCents: number,
): Promise<void> {
  const anteriores = await tx.auditLog.findMany({
    where: { action: "vip_payment.amount_mismatch", entityType: "vip_payment", entityId: payment.id },
    select: { metadata: true },
  });
  const jaAlertado = anteriores.some((linha) => {
    const meta = linha.metadata;
    return (
      !!meta &&
      typeof meta === "object" &&
      !Array.isArray(meta) &&
      (meta as Prisma.JsonObject).paidCents === paidAmountCents
    );
  });
  if (jaAlertado) return;

  const context = await reservationContext(tx, payment.vipReservationId);
  await tx.auditLog.create({
    data: {
      action: "vip_payment.amount_mismatch",
      entityType: "vip_payment",
      entityId: payment.id,
      organizationId: context?.organizationId ?? null,
      metadata: {
        vipPaymentId: payment.id,
        reservationId: payment.vipReservationId,
        provider: payment.provider,
        externalId: payment.externalId,
        expectedCents: payment.amountCents,
        paidCents: paidAmountCents,
        diferencaCents: payment.amountCents - paidAmountCents,
        resumo:
          "O gateway informou um valor pago menor que o cobrado. A reserva VIP NÃO foi confirmada por este pagamento: cobre a diferença ou devolva o valor recebido.",
      },
    },
  });
  await tx.outboxEvent.create({
    data: {
      aggregateType: "vip_payment",
      aggregateId: payment.id,
      eventType: "vip.payment.amount_mismatch",
      payload: {
        vipPaymentId: payment.id,
        reservationId: payment.vipReservationId,
        expectedCents: payment.amountCents,
        paidCents: paidAmountCents,
      },
    },
  });
  console.warn(
    `[payments] VIP pago a menor — reserva ${payment.vipReservationId} NÃO confirmada (pagamento ${payment.id}: cobrado ${payment.amountCents}, pago ${paidAmountCents} centavos)`,
  );
}

async function applyPaid(
  paymentId: string,
  occurredAt?: Date,
  paidAmountCents?: number,
): Promise<ApplyVipStatusResult> {
  return prisma.$transaction(async (tx) => {
    const result: ApplyVipStatusResult = { paymentChanged: false, credited: false, orphaned: false };
    const payment = await paymentForUpdate(tx, paymentId);
    if (!payment) return result;
    if (!NON_MONETARY.includes(payment.status as (typeof NON_MONETARY)[number])) return result;

    // conferência de valor (2026-10-12) — ver applyPaid do ingresso
    if (
      paidAmountCents !== undefined &&
      Number.isFinite(paidAmountCents) &&
      paidAmountCents < payment.amountCents
    ) {
      result.amountMismatch = true;
      await registerVipAmountMismatch(tx, payment, paidAmountCents);
      return result;
    }

    const paidAt = occurredAt ?? new Date();
    const changed = await tx.$executeRaw`
      UPDATE vip_payments
      SET status = 'PAID'::"PaymentStatus", paid_at = (${paidAt}::timestamptz AT TIME ZONE 'UTC'), updated_at = CURRENT_TIMESTAMP
      WHERE id = ${paymentId}::uuid
        AND status IN (
          'PENDING'::"PaymentStatus", 'AUTHORIZED'::"PaymentStatus", 'EXPIRED'::"PaymentStatus",
          'FAILED'::"PaymentStatus", 'CANCELED'::"PaymentStatus"
        )
    `;
    if (changed === 0) return result;
    result.paymentChanged = true;

    const context = await reservationContext(tx, payment.vipReservationId);
    if (!context || context.reservationStatus !== "CONFIRMED") {
      result.orphaned = true;
      await tx.outboxEvent.create({
        data: {
          aggregateType: "vip_payment",
          aggregateId: paymentId,
          eventType: "vip.payment.orphaned",
          payload: { vipPaymentId: paymentId, reservationId: payment.vipReservationId },
        },
      });
      return result;
    }

    const account = await tx.ledgerAccount.upsert({
      where: { organizationId: context.organizationId },
      update: {},
      create: { organizationId: context.organizationId },
    });
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: context.organizationId },
      select: { pixFeeBps: true, pixFeeFloorCents: true, cardFeeBps: true },
    });
    const platformFeeCents = computePlatformFeeCents(payment.method, payment.amountCents, organization);
    const availableAt = addBusinessDays(
      context.eventEndsAt,
      Number(process.env.RELEASE_BUSINESS_DAYS_AFTER_EVENT ?? 2),
    );

    const alreadyCredited = await tx.ledgerEntry.findFirst({
      where: { referenceType: "vip_payment", referenceId: paymentId, type: "SALE_CREDIT" },
      select: { id: true },
    });
    if (!alreadyCredited) {
      await tx.ledgerEntry.createMany({
        data: [
          {
            ledgerAccountId: account.id,
            type: "SALE_CREDIT",
            amountCents: payment.amountCents,
            referenceType: "vip_payment",
            referenceId: paymentId,
            description: "Pagamento de reserva VIP",
            availableAt,
          },
          {
            ledgerAccountId: account.id,
            type: "PLATFORM_FEE",
            amountCents: -platformFeeCents,
            referenceType: "vip_payment",
            referenceId: paymentId,
            description: "Taxa BoraFest sobre reserva VIP",
            availableAt,
          },
        ],
      });
      result.credited = true;
    }

    await tx.outboxEvent.create({
      data: {
        aggregateType: "vip_payment",
        aggregateId: paymentId,
        eventType: "vip.payment.paid",
        payload: { vipPaymentId: paymentId, reservationId: payment.vipReservationId },
      },
    });
    return result;
  });
}

async function applyReversal(
  paymentId: string,
  status: Extract<GatewayPaymentStatus, "REFUNDED" | "CHARGEBACK">,
): Promise<ApplyVipStatusResult> {
  return prisma.$transaction(async (tx) => {
    const result: ApplyVipStatusResult = { paymentChanged: false, credited: false, orphaned: false };
    const payment = await paymentForUpdate(tx, paymentId);
    if (!payment) return result;
    if (payment.status !== "PAID" && payment.status !== "REFUND_PENDING") return result;

    const changed = await tx.$executeRaw`
      UPDATE vip_payments
      SET status = ${status}::"PaymentStatus", updated_at = CURRENT_TIMESTAMP
      WHERE id = ${paymentId}::uuid
        AND status IN ('PAID'::"PaymentStatus", 'REFUND_PENDING'::"PaymentStatus")
    `;
    if (changed === 0) return result;
    result.paymentChanged = true;

    const credit = await tx.ledgerEntry.findFirst({
      where: { referenceType: "vip_payment", referenceId: paymentId, type: "SALE_CREDIT" },
      select: { ledgerAccountId: true },
    });
    if (!credit) return result;

    const previousDebit = await tx.ledgerEntry.findFirst({
      where: { referenceType: "vip_payment", referenceId: paymentId, type: "REFUND_DEBIT" },
      select: { id: true },
    });
    if (!previousDebit) {
      await tx.ledgerEntry.create({
        data: {
          ledgerAccountId: credit.ledgerAccountId,
          type: "REFUND_DEBIT",
          amountCents: -payment.amountCents,
          referenceType: "vip_payment",
          referenceId: paymentId,
          description: status === "CHARGEBACK" ? "Chargeback de reserva VIP" : "Estorno de reserva VIP",
        },
      });
    }

    const feeBalance = await tx.ledgerEntry.aggregate({
      where: { referenceType: "vip_payment", referenceId: paymentId, type: "PLATFORM_FEE" },
      _sum: { amountCents: true },
    });
    const feeCents = feeBalance._sum.amountCents ?? 0;
    if (feeCents < 0) {
      await tx.ledgerEntry.create({
        data: {
          ledgerAccountId: credit.ledgerAccountId,
          type: "PLATFORM_FEE",
          amountCents: -feeCents,
          referenceType: "vip_payment",
          referenceId: paymentId,
          description: "Estorno da taxa BoraFest da reserva VIP",
        },
      });
    }
    return result;
  });
}
