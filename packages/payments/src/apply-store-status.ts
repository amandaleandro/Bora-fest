import { Prisma, prisma } from "@borafest/database";
import type { GatewayPaymentStatus } from "./types";
import { computePlatformFeeCents } from "./fees";

export interface ApplyStoreStatusResult {
  paymentChanged: boolean;
  orderPaid: boolean;
  orphaned: boolean;
  stockReturned: boolean;
}

const OPEN = ["PENDING", "AUTHORIZED", "FAILED", "CANCELED", "EXPIRED"] as const;

export async function applyStoreGatewayStatus(
  paymentId: string,
  status: GatewayPaymentStatus,
  occurredAt?: Date,
): Promise<ApplyStoreStatusResult> {
  if (status === "PENDING") {
    return { paymentChanged: false, orderPaid: false, orphaned: false, stockReturned: false };
  }
  if (status === "AUTHORIZED") {
    const changed = await prisma.storePayment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "AUTHORIZED" },
    });
    return { paymentChanged: changed.count > 0, orderPaid: false, orphaned: false, stockReturned: false };
  }
  if (status === "PAID") return applyPaid(paymentId, occurredAt);
  if (status === "REFUNDED" || status === "CHARGEBACK") {
    return applyReversal(paymentId, status);
  }

  const changed = await prisma.storePayment.updateMany({
    where: { id: paymentId, status: { in: ["PENDING", "AUTHORIZED"] } },
    data: { status },
  });
  return { paymentChanged: changed.count > 0, orderPaid: false, orphaned: false, stockReturned: false };
}

async function applyPaid(paymentId: string, occurredAt?: Date): Promise<ApplyStoreStatusResult> {
  return prisma.$transaction(async (tx) => {
    const result: ApplyStoreStatusResult = {
      paymentChanged: false,
      orderPaid: false,
      orphaned: false,
      stockReturned: false,
    };
    const payment = await tx.storePayment.findUnique({
      where: { id: paymentId },
      include: {
        order: {
          include: {
            items: true,
            organization: {
              select: {
                id: true,
                name: true,
                displayName: true,
                pixFeeBps: true,
                pixFeeFloorCents: true,
                cardFeeBps: true,
                refundHoldDays: true,
              },
            },
          },
        },
      },
    });
    if (!payment) return result;

    const paidAt = occurredAt ?? new Date();
    const changedPayment = await tx.storePayment.updateMany({
      where: { id: paymentId, status: { in: [...OPEN] } },
      data: { status: "PAID", paidAt },
    });
    if (changedPayment.count === 0) return result;
    result.paymentChanged = true;

    const changedOrder = await tx.storeOrder.updateMany({
      where: {
        id: payment.storeOrderId,
        status: { in: ["CREATED", "PAYMENT_PENDING"] },
      },
      data: { status: "PAID", paidAt },
    });
    if (changedOrder.count === 0) {
      result.orphaned = true;
      await tx.outboxEvent.create({
        data: {
          aggregateType: "store_payment",
          aggregateId: payment.id,
          eventType: "store.payment.orphaned",
          payload: { storePaymentId: payment.id, storeOrderId: payment.storeOrderId },
        },
      });
      return result;
    }

    for (const item of payment.order.items) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE store_product_variants
        SET reserved_count = reserved_count - ${item.quantity},
            sold_count = sold_count + ${item.quantity},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${item.variantId}::uuid
          AND reserved_count >= ${item.quantity}
          AND sold_count + ${item.quantity} <= stock_total
        RETURNING id
      `);
      if (rows.length === 0) {
        throw new Error(`Estoque reservado inconsistente na variação ${item.variantId}`);
      }
    }

    const account = await tx.ledgerAccount.upsert({
      where: { organizationId: payment.order.organizationId },
      update: {},
      create: { organizationId: payment.order.organizationId },
    });
    const feeMethod = payment.method === "CARD" ? "CARD" : "PIX";
    const feeCents = computePlatformFeeCents(
      feeMethod,
      payment.amountCents,
      payment.order.organization,
    );
    const availableAt = new Date(
      paidAt.getTime() + payment.order.organization.refundHoldDays * 24 * 60 * 60 * 1000,
    );

    const existingCredit = await tx.ledgerEntry.findFirst({
      where: {
        referenceType: "store_payment",
        referenceId: payment.id,
        type: "SALE_CREDIT",
      },
      select: { id: true },
    });
    if (!existingCredit) {
      await tx.ledgerEntry.createMany({
        data: [
          {
            ledgerAccountId: account.id,
            type: "SALE_CREDIT",
            amountCents: payment.amountCents,
            referenceType: "store_payment",
            referenceId: payment.id,
            description: "Venda da Loja da Casa",
            availableAt,
          },
          {
            ledgerAccountId: account.id,
            type: "PLATFORM_FEE",
            amountCents: -feeCents,
            referenceType: "store_payment",
            referenceId: payment.id,
            description: "Taxa BoraFest sobre venda da Loja",
            availableAt,
          },
        ],
      });
    }

    await tx.notification.create({
      data: {
        channel: "EMAIL",
        recipient: payment.order.contactEmail,
        template: "store_order_paid",
        payload: {
          storeOrderId: payment.storeOrderId,
          houseName: payment.order.organization.displayName ?? payment.order.organization.name,
          customerName: payment.order.contactName,
          pickupCode: payment.order.pickupCode,
          totalCents: payment.amountCents,
          orderUrl: `${process.env.WEB_BASE_URL ?? "https://borafest.com.br"}/loja/pedido/${payment.order.publicToken}`,
          items: payment.order.items.map((item) => ({
            productName: item.productName,
            variantName: item.variantName,
            quantity: item.quantity,
          })),
        },
      },
    });

    await tx.outboxEvent.create({
      data: {
        aggregateType: "store_order",
        aggregateId: payment.storeOrderId,
        eventType: "store.order.paid",
        payload: { storeOrderId: payment.storeOrderId, storePaymentId: payment.id },
      },
    });

    result.orderPaid = true;
    return result;
  });
}

async function applyReversal(
  paymentId: string,
  status: Extract<GatewayPaymentStatus, "REFUNDED" | "CHARGEBACK">,
): Promise<ApplyStoreStatusResult> {
  return prisma.$transaction(async (tx) => {
    const result: ApplyStoreStatusResult = {
      paymentChanged: false,
      orderPaid: false,
      orphaned: false,
      stockReturned: false,
    };
    const payment = await tx.storePayment.findUnique({
      where: { id: paymentId },
      include: { order: { include: { items: true } } },
    });
    if (!payment || !["PAID", "REFUND_PENDING"].includes(payment.status)) return result;

    const changed = await tx.storePayment.updateMany({
      where: { id: payment.id, status: { in: ["PAID", "REFUND_PENDING"] } },
      data: { status },
    });
    if (changed.count === 0) return result;
    result.paymentChanged = true;

    const wasFulfilled = payment.order.status === "FULFILLED";
    await tx.storeOrder.update({
      where: { id: payment.storeOrderId },
      data: { status: status === "CHARGEBACK" ? "CHARGEBACK" : "REFUNDED" },
    });

    const credit = await tx.ledgerEntry.findFirst({
      where: {
        referenceType: "store_payment",
        referenceId: payment.id,
        type: "SALE_CREDIT",
      },
      select: { ledgerAccountId: true, amountCents: true },
    });
    if (credit) {
      const previousDebit = await tx.ledgerEntry.findFirst({
        where: {
          referenceType: "store_payment",
          referenceId: payment.id,
          type: "REFUND_DEBIT",
        },
        select: { id: true },
      });
      if (!previousDebit) {
        await tx.ledgerEntry.create({
          data: {
            ledgerAccountId: credit.ledgerAccountId,
            type: "REFUND_DEBIT",
            amountCents: -payment.amountCents,
            referenceType: "store_payment",
            referenceId: payment.id,
            description: status === "CHARGEBACK" ? "Chargeback da Loja" : "Estorno da Loja",
          },
        });
      }

      const fee = await tx.ledgerEntry.aggregate({
        where: {
          referenceType: "store_payment",
          referenceId: payment.id,
          type: "PLATFORM_FEE",
        },
        _sum: { amountCents: true },
      });
      const feeBalance = fee._sum.amountCents ?? 0;
      if (feeBalance < 0) {
        await tx.ledgerEntry.create({
          data: {
            ledgerAccountId: credit.ledgerAccountId,
            type: "PLATFORM_FEE",
            amountCents: -feeBalance,
            referenceType: "store_payment",
            referenceId: payment.id,
            description: "Estorno da taxa da Loja",
          },
        });
      }
    }

    // Produto já retirado não volta magicamente ao estoque em chargeback/estorno.
    // Para pedido ainda não entregue, a unidade física continua disponível.
    if (!wasFulfilled) {
      for (const item of payment.order.items) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE store_product_variants
          SET sold_count = GREATEST(sold_count - ${item.quantity}, 0),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${item.variantId}::uuid
        `);
      }
      result.stockReturned = true;
    }

    return result;
  });
}
