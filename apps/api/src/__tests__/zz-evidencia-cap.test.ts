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

after(async () => { await closeRedisConnection(); await prisma.$disconnect(); });

// SPY: registra CADA centavo que a plataforma manda o gateway devolver.
const enviadoAoGateway: (number | undefined)[] = [];
const SPY = "spy_async_refund";
class SpyGateway implements PaymentGateway {
  readonly provider = SPY;
  async createPixCharge(): Promise<any> { throw new Error("x"); }
  async createCardPayment(): Promise<any> { throw new Error("x"); }
  async refund(input: any): Promise<RefundResult> {
    enviadoAoGateway.push(input.amountCents);
    return { externalId: "spy_ext", status: "PENDING" };
  }
  async getStatus(): Promise<any> { return "PAID"; }
  verifyWebhook(): any { throw new Error("x"); }
}
registerGateway(new SpyGateway());

async function paidOrder(fixture: any) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  const payments = new PaymentsService(new IdempotencyService());
  const reservation = await reservations.create(undefined, {
    eventId: fixture.event.id, items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id, contactEmail: `ev-${Math.random().toString(36).slice(2,8)}@borafest.dev`,
  });
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");
  await prisma.payment.update({ where: { id: payment.id }, data: { provider: SPY, externalId: `ext_${payment.id}` } });
  return { order, payment };
}

async function debito(paymentId: string) {
  const a = await prisma.ledgerEntry.aggregate({
    where: { referenceType: "payment", referenceId: paymentId, type: "REFUND_DEBIT" }, _sum: { amountCents: true },
  });
  return Math.abs(a._sum.amountCents ?? 0);
}

test("EVIDENCIA: o teto e real — dinheiro devolvido nunca passa do pago", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 10000, feeCents: 0 });
  try {
    const { order, payment } = await paidOrder(fixture);
    const pago = (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).amountCents;
    console.log("PAGO (centavos):", pago);

    await executeOrderRefund(order.publicToken, { amountCents: 7000, idempotencyPrefix: "e1" });
    console.log("apos 1o estorno 7000 -> REFUND_DEBIT:", await debito(payment.id));

    // 2o de 7000 (total 14000 > 10000) tem que ser BARRADO
    let msg = "";
    await assert.rejects(
      () => executeOrderRefund(order.publicToken, { amountCents: 7000, idempotencyPrefix: "e2" }),
      (e: any) => { msg = e.message; return true; },
    );
    console.log("MENSAGEM DA RECUSA:", msg);
    console.log("REFUND_DEBIT apos a recusa:", await debito(payment.id));
    console.log("VALORES ENVIADOS AO GATEWAY ate aqui:", JSON.stringify(enviadoAoGateway));
    const pDepois = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    console.log("STATUS do pagamento apos recusa:", pDepois.status);

    assert.equal(await debito(payment.id), 7000, "so o primeiro estorno valeu");
    assert.deepEqual(enviadoAoGateway, [7000], "gateway NAO recebeu a 2a ordem de estorno");
    assert.notEqual(pDepois.status, "REFUND_PENDING", "nao ficou preso");

    // FRONTEIRA: exatamente os R$30 restantes DEVEM passar (teto = valor pago, nem mais nem menos)
    await executeOrderRefund(order.publicToken, { amountCents: 3000, idempotencyPrefix: "e3" });
    const total = await debito(payment.id);
    console.log("apos estorno de 3000 -> REFUND_DEBIT TOTAL:", total);
    console.log("VALORES ENVIADOS AO GATEWAY:", JSON.stringify(enviadoAoGateway));
    assert.equal(total, 10000, "teto = exatamente o valor pago");
    assert.ok(total <= pago, "NUNCA devolveu mais do que o pago");

    // 1 centavo alem do teto: ou recusa, ou no-op idempotente — o que NAO pode e sair dinheiro
    const pAntes = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const oAntes = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    console.log("ANTES do +1c -> payment:", pAntes.status, "| order:", oAntes.status);
    try {
      const r = await executeOrderRefund(order.publicToken, { amountCents: 1, idempotencyPrefix: "e4" });
      console.log("+1 centavo NAO lancou erro; retorno gatewayStatus:", r.gatewayStatus);
    } catch (e: any) {
      console.log("+1 centavo RECUSADO:", e.message);
    }
    console.log("REFUND_DEBIT FINAL:", await debito(payment.id));
    console.log("GATEWAY FINAL (centavos realmente enviados):", JSON.stringify(enviadoAoGateway));
    assert.equal(await debito(payment.id), 10000, "teto seguro no limite — nenhum centavo a mais");
    assert.deepEqual(enviadoAoGateway, [7000, 3000], "gateway nunca recebeu ordem alem do teto");

    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    console.log("STATUS do pedido no fim:", o.status);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
