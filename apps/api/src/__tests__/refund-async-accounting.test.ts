import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { applyGatewayStatus, registerGateway } from "@borafest/payments";
import type { PaymentGateway, RefundResult } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { IdempotencyService } from "../common/idempotency.service";
import { executeOrderRefund } from "../common/execute-refund";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
  await prisma.$disconnect();
});

/**
 * Gateway que ACEITA o estorno mas responde "PENDING" (assíncrono) — é o
 * comportamento real do Asaas em cartão e Pix. Registrado como provedor
 * próprio para o teste bater exatamente nesse caminho.
 */
const ASYNC_PROVIDER = "fake_async_refund";
class FakeAsyncGateway implements PaymentGateway {
  readonly provider = ASYNC_PROVIDER;
  async createPixCharge(): Promise<any> {
    throw new Error("não usado no teste");
  }
  async createCardPayment(): Promise<any> {
    throw new Error("não usado no teste");
  }
  async refund(): Promise<RefundResult> {
    return { externalId: "fake_ext", status: "PENDING" };
  }
  async getStatus(): Promise<any> {
    return "PAID";
  }
  verifyWebhook(): any {
    throw new Error("não usado no teste");
  }
}
registerGateway(new FakeAsyncGateway());

async function paidOrder(fixture: Awaited<ReturnType<typeof createFixtureEvent>>, provider: string) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  const payments = new PaymentsService(new IdempotencyService());

  const reservation = await reservations.create(undefined, {
    eventId: fixture.event.id,
    items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: `casa-${Math.random().toString(36).slice(2, 8)}@borafest.dev`,
  });
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");
  // força o provedor do pagamento e um externalId (execute-refund exige)
  await prisma.payment.update({
    where: { id: payment.id },
    data: { provider, externalId: `ext_${payment.id}` },
  });
  return { order, payment };
}

async function refundDebitTotal(paymentId: string): Promise<number> {
  const agg = await prisma.ledgerEntry.aggregate({
    where: { referenceType: "payment", referenceId: paymentId, type: "REFUND_DEBIT" },
    _sum: { amountCents: true },
  });
  return Math.abs(agg._sum.amountCents ?? 0);
}

test("estorno ASSÍNCRONO (gateway PENDING) aplica a contabilidade na hora — não trava em REFUND_PENDING", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 10000, feeCents: 0 });
  try {
    const { order, payment } = await paidOrder(fixture, ASYNC_PROVIDER);

    // estorno PARCIAL de R$ 30 de um pagamento de R$ 100
    await executeOrderRefund(order.publicToken, {
      amountCents: 3000,
      idempotencyPrefix: "test-async",
    });

    // ANTES do fix: applyGatewayStatus("PENDING") era no-op → nada disso valia
    assert.equal(await refundDebitTotal(payment.id), 3000, "REFUND_DEBIT de R$30 lançado");

    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.notEqual(p.status, "REFUND_PENDING", "pagamento não pode ficar preso em REFUND_PENDING");

    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(o.status, "PARTIALLY_REFUNDED", "pedido reflete o estorno parcial");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("estorno ASSÍNCRONO respeita o teto acumulado (dois parciais não passam do total)", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 10000, feeCents: 0 });
  try {
    const { order, payment } = await paidOrder(fixture, ASYNC_PROVIDER);

    await executeOrderRefund(order.publicToken, { amountCents: 7000, idempotencyPrefix: "t1" });
    // segundo estorno de R$ 70 somaria R$ 140 > R$ 100 — o cap tem que barrar
    await assert.rejects(
      () => executeOrderRefund(order.publicToken, { amountCents: 7000, idempotencyPrefix: "t2" }),
      /excede|cap|limite|maior/i,
    );

    assert.equal(await refundDebitTotal(payment.id), 7000, "só o primeiro estorno valeu");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
