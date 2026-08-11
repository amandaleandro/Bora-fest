import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { registerGateway, getGatewayForMethod, getFallbackGatewayForMethod } from "@borafest/payments";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
import { IdempotencyService } from "../common/idempotency.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

/** Gateway que sempre falha — simula o provedor recusando/limitando no pico. */
const quebrado = {
  provider: "quebrado",
  async createPixCharge(): Promise<never> {
    throw new Error("provedor fora do ar / recusando por volume");
  },
  async createCardPayment(): Promise<never> {
    throw new Error("indisponível");
  },
  async refund(): Promise<never> {
    throw new Error("indisponível");
  },
  async getStatus(): Promise<never> {
    throw new Error("indisponível");
  },
  verifyWebhook(): never {
    throw new Error("indisponível");
  },
} as never;

test("roteamento por método: Pix e cartão podem ir para provedores diferentes", () => {
  process.env.PAYMENTS_PROVIDER = "mock";
  process.env.PAYMENTS_PROVIDER_PIX = "mercadopago";
  process.env.PAYMENTS_PROVIDER_CARD = "asaas";
  assert.equal(getGatewayForMethod("PIX").provider, "mercadopago");
  assert.equal(getGatewayForMethod("CARD").provider, "asaas");

  // sem as específicas, tudo cai no padrão
  delete process.env.PAYMENTS_PROVIDER_PIX;
  delete process.env.PAYMENTS_PROVIDER_CARD;
  assert.equal(getGatewayForMethod("PIX").provider, "mock");

  // reserva só conta se for diferente do primário
  process.env.PAYMENTS_FALLBACK_PIX = "mock";
  assert.equal(getFallbackGatewayForMethod("PIX"), null, "reserva igual ao primário é ignorada");
  process.env.PAYMENTS_FALLBACK_PIX = "asaas";
  assert.equal(getFallbackGatewayForMethod("PIX")?.provider, "asaas");
  delete process.env.PAYMENTS_FALLBACK_PIX;
});

test("FAILOVER: provedor primário caindo no pico não derruba a venda", async () => {
  registerGateway(quebrado);
  const f = await createFixtureEvent({ lotCapacity: 10, priceCents: 5_000, feeCents: 0 });
  try {
    // primário quebrado, reserva saudável (mock)
    process.env.PAYMENTS_PROVIDER = "mock";
    process.env.PAYMENTS_PROVIDER_PIX = "quebrado";
    process.env.PAYMENTS_FALLBACK_PIX = "mock";

    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    const payments = new PaymentsService(new IdempotencyService());
    const reservation = await reservations.create(undefined, {
      eventId: f.event.id,
      items: [{ ticketLotId: f.lot.id, quantity: 1 }],
    });
    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: `fo-${Math.random().toString(36).slice(2, 8)}@borafest.dev`,
    } as never);

    const pagamento = await payments.createPix(order.id, {});
    assert.ok(pagamento.pixQrCodeText, "QR gerado mesmo com o primário fora");

    const salvo = await prisma.payment.findUniqueOrThrow({ where: { id: pagamento.id } });
    assert.equal(salvo.provider, "mock", "pagamento registrado no provedor que REALMENTE cobrou");

    // sem reserva configurado, o erro sobe (não engole falha em silêncio)
    delete process.env.PAYMENTS_FALLBACK_PIX;
    const r2 = await reservations.create(undefined, {
      eventId: f.event.id,
      items: [{ ticketLotId: f.lot.id, quantity: 1 }],
    });
    const o2 = await orders.createFromReservation(undefined, {
      reservationId: r2.id,
      contactEmail: `fo2-${Math.random().toString(36).slice(2, 8)}@borafest.dev`,
    } as never);
    await assert.rejects(() => payments.createPix(o2.id, {}));
  } finally {
    delete process.env.PAYMENTS_PROVIDER_PIX;
    delete process.env.PAYMENTS_FALLBACK_PIX;
    process.env.PAYMENTS_PROVIDER = "mock";
    await cleanupFixtureEvent(f.organization.id);
  }
});
