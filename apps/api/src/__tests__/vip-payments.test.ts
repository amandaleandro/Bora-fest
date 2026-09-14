import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "@borafest/database";
import { applyVipGatewayStatus } from "@borafest/payments";
import { IdempotencyService } from "../common/idempotency.service";
import { OrgAccessService } from "../common/org-access.service";
import { VipPaymentsService } from "../vip/vip-payments.service";
import { VipService } from "../vip/vip.service";
import { cleanupFixtureEvent, createFixtureEvent } from "./helpers";

let fixture: Awaited<ReturnType<typeof createFixtureEvent>>;
let ownerId = "";
let inventoryId = "";
const createdPaymentIds: string[] = [];
const orgAccess = new OrgAccessService();
const vip = new VipService(orgAccess);
const payments = new VipPaymentsService(new IdempotencyService(), orgAccess);

async function insertPayment(reservationId: string, amountCents: number) {
  const id = randomUUID();
  createdPaymentIds.push(id);
  await prisma.$executeRaw`
    INSERT INTO vip_payments (
      id, vip_reservation_id, provider, method, status, amount_cents,
      external_id, created_at, updated_at
    ) VALUES (
      ${id}::uuid, ${reservationId}::uuid, 'mock', 'PIX'::"PaymentMethod",
      'PENDING'::"PaymentStatus", ${amountCents}, ${`vip_${id}`}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  return id;
}

async function makeConfirmedReservation(email: string) {
  const request = await vip.requestReservation(fixture.event.slug, {
    inventoryId,
    contactName: "Cliente VIP",
    contactEmail: email,
    contactPhone: "34999990099",
    partySize: 4,
    units: 1,
  });
  await vip.confirmReservation(request.id, ownerId, {});
  return request;
}

describe("N8.1 — pagamentos VIP", () => {
  before(async () => {
    fixture = await createFixtureEvent({ lotCapacity: 100, priceCents: 4000, feeCents: 0 });
    const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await prisma.event.update({
      where: { id: fixture.event.id },
      data: {
        status: "PUBLISHED",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 6 * 60 * 60 * 1000),
      },
    });

    const owner = await prisma.user.create({ data: { email: `vip-pay-owner-${Date.now()}@example.com` } });
    ownerId = owner.id;
    await prisma.organizationMember.create({
      data: {
        organizationId: fixture.organization.id,
        userId: owner.id,
        roleId: fixture.ownerRoleId,
        status: "ACTIVE",
      },
    });

    const inventory = await vip.createInventory(fixture.event.id, ownerId, {
      kind: "CAMAROTE",
      name: "Camarote Financeiro",
      unitPriceCents: 50_000,
      quantity: 5,
      capacityPerUnit: 6,
      maxUnitsPerReservation: 1,
    });
    inventoryId = inventory.id;
  });

  after(async () => {
    if (createdPaymentIds.length) {
      await prisma.outboxEvent.deleteMany({
        where: { aggregateType: "vip_payment", aggregateId: { in: createdPaymentIds } },
      });
      await prisma.ledgerEntry.deleteMany({
        where: { referenceType: "vip_payment", referenceId: { in: createdPaymentIds } },
      });
    }
    await cleanupFixtureEvent(fixture.organization.id);
    if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
  });

  it("configura sinal somente dentro do total congelado", async () => {
    const reservation = await makeConfirmedReservation("vip-deposit@example.com");
    const summary = await payments.configureDeposit(reservation.id, ownerId, { depositCents: 25_000 });
    assert.equal(summary.depositCents, 25_000);
    assert.equal(summary.depositRemainingCents, 25_000);

    await assert.rejects(
      () => payments.configureDeposit(reservation.id, ownerId, { depositCents: 60_000 }),
      /superar o valor total/,
    );
  });

  it("PAID credita venda e taxa uma única vez sem emitir ingresso", async () => {
    const reservation = await makeConfirmedReservation("vip-paid@example.com");
    await payments.configureDeposit(reservation.id, ownerId, { depositCents: 20_000 });
    const paymentId = await insertPayment(reservation.id, 20_000);

    const first = await applyVipGatewayStatus(paymentId, "PAID");
    const second = await applyVipGatewayStatus(paymentId, "PAID");
    assert.equal(first.paymentChanged, true);
    assert.equal(first.credited, true);
    assert.equal(second.paymentChanged, false);

    const credits = await prisma.ledgerEntry.findMany({
      where: { referenceType: "vip_payment", referenceId: paymentId, type: "SALE_CREDIT" },
    });
    assert.equal(credits.length, 1);
    assert.equal(credits[0]?.amountCents, 20_000);

    const fees = await prisma.ledgerEntry.findMany({
      where: { referenceType: "vip_payment", referenceId: paymentId, type: "PLATFORM_FEE" },
    });
    assert.equal(fees.length, 1);
    assert.ok((fees[0]?.amountCents ?? 0) < 0);

    const tickets = await prisma.ticket.count({ where: { eventId: fixture.event.id } });
    assert.equal(tickets, 0);
  });

  it("estorno confirmado zera venda e taxa sem duplicar lançamentos", async () => {
    const reservation = await makeConfirmedReservation("vip-refund@example.com");
    await payments.configureDeposit(reservation.id, ownerId, { depositCents: 15_000 });
    const paymentId = await insertPayment(reservation.id, 15_000);
    await applyVipGatewayStatus(paymentId, "PAID");

    const first = await applyVipGatewayStatus(paymentId, "REFUNDED");
    const second = await applyVipGatewayStatus(paymentId, "REFUNDED");
    assert.equal(first.paymentChanged, true);
    assert.equal(second.paymentChanged, false);

    const debits = await prisma.ledgerEntry.findMany({
      where: { referenceType: "vip_payment", referenceId: paymentId, type: "REFUND_DEBIT" },
    });
    assert.equal(debits.length, 1);
    assert.equal(debits[0]?.amountCents, -15_000);

    const feeBalance = await prisma.ledgerEntry.aggregate({
      where: { referenceType: "vip_payment", referenceId: paymentId, type: "PLATFORM_FEE" },
      _sum: { amountCents: true },
    });
    assert.equal(feeBalance._sum.amountCents, 0);
  });

  it("pagamento aprovado para reserva incompatível vira órfão sem crédito", async () => {
    const reservation = await makeConfirmedReservation("vip-orphan@example.com");
    await payments.configureDeposit(reservation.id, ownerId, { depositCents: 10_000 });
    const paymentId = await insertPayment(reservation.id, 10_000);

    await prisma.vipReservation.update({ where: { id: reservation.id }, data: { status: "CANCELED" } });
    const result = await applyVipGatewayStatus(paymentId, "PAID");
    assert.equal(result.orphaned, true);
    assert.equal(result.credited, false);

    const credits = await prisma.ledgerEntry.count({
      where: { referenceType: "vip_payment", referenceId: paymentId, type: "SALE_CREDIT" },
    });
    assert.equal(credits, 0);
    const outbox = await prisma.outboxEvent.findFirst({
      where: { aggregateType: "vip_payment", aggregateId: paymentId, eventType: "vip.payment.orphaned" },
    });
    assert.ok(outbox);
  });
});