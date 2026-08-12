import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { registerGateway } from "@borafest/payments";
import type {
  GatewayPaymentStatus,
  PaymentGateway,
  VerifiedWebhookEvent,
  WebhookHeaders,
} from "@borafest/payments";
import { ReservationsService } from "../../../api/src/reservations/reservations.service";
import { CouponsService } from "../../../api/src/coupons/coupons.service";
import { OrgAccessService } from "../../../api/src/common/org-access.service";
import { OrdersService } from "../../../api/src/orders/orders.service";
import { InventoryService } from "../../../api/src/inventory/inventory.service";
import { WaitingRoomService } from "../../../api/src/waiting-room/waiting-room.service";
import { createFixtureEvent, cleanupFixtureEvent } from "../../../api/src/__tests__/helpers";
import { processPaymentWebhookJob } from "../process-payment-webhook";

after(async () => {
  await closeRedisConnection();
  await prisma.$disconnect();
});

/**
 * Gateway falso no estilo Mercado Pago: o webhook só traz o id (status é
 * placeholder + resolveViaGetStatus), e o status REAL vem de getStatus — que
 * o teste controla via `nextStatus`.
 */
const FAKE = "fake_mp_webhook";
class FakeMpGateway implements PaymentGateway {
  readonly provider = FAKE;
  nextStatus: GatewayPaymentStatus = "PENDING";
  async createPixCharge(): Promise<any> {
    throw new Error("n/d");
  }
  async createCardPayment(): Promise<any> {
    throw new Error("n/d");
  }
  async refund(): Promise<any> {
    throw new Error("n/d");
  }
  async getStatus(): Promise<GatewayPaymentStatus> {
    return this.nextStatus;
  }
  verifyWebhook(_headers: WebhookHeaders, rawBody: string): VerifiedWebhookEvent {
    const body = JSON.parse(rawBody);
    return {
      externalEventId: body.eventId,
      externalPaymentId: body.paymentExternalId,
      type: "payment",
      status: "PENDING",
      resolveViaGetStatus: true,
      raw: body,
    };
  }
}
const fake = new FakeMpGateway();
registerGateway(fake);

async function pendingPayment(fixture: Awaited<ReturnType<typeof createFixtureEvent>>, externalId: string) {
  const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  const reservation = await reservations.create(undefined, {
    eventId: fixture.event.id,
    items: [{ ticketLotId: fixture.lot.id, quantity: 1 }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: `c-${Math.random().toString(36).slice(2, 8)}@borafest.dev`,
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: FAKE,
      method: "PIX",
      amountCents: order.totalCents,
      status: "PENDING",
      externalId,
    },
  });
  return { order, payment };
}

function webhook(eventId: string, paymentExternalId: string) {
  return { provider: FAKE, headers: {}, rawBody: JSON.stringify({ eventId, paymentExternalId }) };
}

test("MP: webhook sem status resolve via getStatus e aplica o real (PAID)", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 0 });
  try {
    const { order, payment } = await pendingPayment(fixture, "ext-paid");
    fake.nextStatus = "PAID";
    await processPaymentWebhookJob(webhook("evt-paid", "ext-paid"));

    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(p.status, "PAID", "getStatus=PAID tem que confirmar o pagamento");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(o.status, "PAID", "pedido confirmado");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("MP: estorno fora de banda (getStatus=REFUNDED sobre PAID) reverte", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 0 });
  try {
    const { order, payment } = await pendingPayment(fixture, "ext-ref");
    fake.nextStatus = "PAID";
    await processPaymentWebhookJob(webhook("evt-p", "ext-ref"));

    // agora o comprador pede MED / a casa estorna no painel do MP → webhook novo
    fake.nextStatus = "REFUNDED";
    await processPaymentWebhookJob(webhook("evt-r", "ext-ref"));

    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(p.status, "REFUNDED", "estorno do MP tem que chegar ao sistema");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(o.status, "REFUNDED", "pedido revertido");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("fora de ordem: REFUNDED antes do PAID RELANÇA (retry), depois reverte certo", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 0 });
  try {
    const { order, payment } = await pendingPayment(fixture, "ext-ooo");

    // 1) chega o REFUNDED com o pagamento ainda PENDING (o PAID não processou)
    fake.nextStatus = "REFUNDED";
    await assert.rejects(
      () => processPaymentWebhookJob(webhook("evt-rev", "ext-ooo")),
      /antes do PAID|retry/i,
      "reversão fora de ordem tem que relançar para retry, não virar no-op",
    );
    let p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(p.status, "PENDING", "pagamento não pode ter virado terminal ainda");

    // 2) o PAID processa (evento diferente)
    fake.nextStatus = "PAID";
    await processPaymentWebhookJob(webhook("evt-paid2", "ext-ooo"));
    p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(p.status, "PAID");

    // 3) RETRY da reversão (MESMO eventId — antes visto mas não processado) reaplica
    fake.nextStatus = "REFUNDED";
    await processPaymentWebhookJob(webhook("evt-rev", "ext-ooo"));
    p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(p.status, "REFUNDED", "no retry a reversão aplica sobre o PAID");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(o.status, "REFUNDED");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("idempotência por EFEITO: evento visto mas não processado reaplica no retry", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 5000, feeCents: 0 });
  try {
    const { order, payment } = await pendingPayment(fixture, "ext-idem");

    // grava o paymentEvent SEM processar (simula tentativa anterior que falhou no efeito)
    await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        provider: FAKE,
        externalEventId: "evt-idem",
        type: "payment",
        payload: {},
      },
    });

    fake.nextStatus = "PAID";
    // reprocessa o MESMO evento: não pode ser tratado como duplicado — tem que aplicar
    await processPaymentWebhookJob(webhook("evt-idem", "ext-idem"));

    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(p.status, "PAID", "evento visto-mas-não-processado tem que reaplicar");
    const ev = await prisma.paymentEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider: FAKE, externalEventId: "evt-idem" } },
    });
    assert.ok(ev.processedAt, "agora sim marcado como processado");
    void order;
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
