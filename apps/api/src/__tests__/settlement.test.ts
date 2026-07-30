import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrgAccessService } from "../common/org-access.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { IdempotencyService } from "../common/idempotency.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";
import {
  computeAnticipationFeeCents,
  getMaturedBalanceCents,
  getPayoutAvailability,
} from "../common/ledger";

after(async () => {
  await closeRedisConnection();
});

/** Fluxo real: reserva → pedido → Pix → webhook PAID (mesmo caminho da produção). */
async function payOrder(eventId: string, lotId: string) {
  const reservations = new ReservationsService(new InventoryService());
  const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
  const payments = new PaymentsService(new IdempotencyService());

  const reservation = await reservations.create(undefined, {
    eventId,
    items: [{ ticketLotId: lotId, quantity: 1 }],
  });
  const order = await orders.createFromReservation(undefined, {
    reservationId: reservation.id,
    contactEmail: `settlement-${Math.random().toString(36).slice(2, 8)}@borafest.dev`,
  });
  const payment = await payments.createPix(order.id, {});
  await applyGatewayStatus(payment.id, "PAID");
  return order;
}

test("PADRÃO: crédito de venda fica em janela de reembolso e fora do saque", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 10, priceCents: 10000, feeCents: 0 });
  try {
    await payOrder(fixture.event.id, fixture.lot.id);

    const availability = await getPayoutAvailability(fixture.organization.id);
    assert.equal(availability.settlementMode, "STANDARD");
    assert.ok(availability.balanceCents > 0, "saldo contábil deve existir");
    assert.equal(availability.heldCents, 10000, "venda inteira dentro da janela");
    assert.equal(
      availability.availableForPayoutCents,
      0,
      "nada sacável antes da janela (débito da comissão não vira saque)",
    );
    assert.equal(availability.anticipationFeeCents, 0);

    // vencendo a janela na mão: o mesmo saldo passa a ser sacável
    const ledgerAccount = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { organizationId: fixture.organization.id },
    });
    await prisma.ledgerEntry.updateMany({
      where: { ledgerAccountId: ledgerAccount.id, type: "SALE_CREDIT" },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    const madura = await getPayoutAvailability(fixture.organization.id);
    assert.equal(madura.heldCents, 0);
    assert.equal(madura.availableForPayoutCents, madura.balanceCents);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("INSTANTÂNEO: saca tudo com taxa de antecipação pró-rata sobre a janela", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 10, priceCents: 10000, feeCents: 0 });
  try {
    await prisma.organization.update({
      where: { id: fixture.organization.id },
      data: { settlementMode: "INSTANT" },
    });
    await payOrder(fixture.event.id, fixture.lot.id);

    const availability = await getPayoutAvailability(fixture.organization.id);
    assert.equal(availability.settlementMode, "INSTANT");
    assert.equal(
      availability.availableForPayoutCents,
      availability.balanceCents,
      "INSTANT libera o saldo inteiro",
    );
    // 1,25% a.m. pró-rata de 7 dias sobre a parcela em janela — positivo e
    // bem abaixo da taxa cheia do mês
    assert.ok(availability.anticipationFeeCents > 0, "antecipação deve ser cobrada");
    const tetoMesCheio = Math.ceil((availability.heldCents * 125) / 10000) + 1;
    assert.ok(availability.anticipationFeeCents <= tetoMesCheio);

    // fora da janela não há o que antecipar
    const ledgerAccount = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { organizationId: fixture.organization.id },
    });
    await prisma.ledgerEntry.updateMany({
      where: { ledgerAccountId: ledgerAccount.id, type: "SALE_CREDIT" },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    const fee = await computeAnticipationFeeCents(
      fixture.organization.id,
      await getMaturedBalanceCents(fixture.organization.id),
    );
    assert.equal(fee, 0, "saldo maduro não paga antecipação");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
