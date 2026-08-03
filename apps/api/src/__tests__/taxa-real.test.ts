import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { applyGatewayStatus } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../catalog/catalog.service";
import { OrgAccessService } from "../common/org-access.service";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { IdempotencyService } from "../common/idempotency.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
});

test("taxa real ponta a ponta: servidor calcula a taxa do lote e o ledger lança o cobrado", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 10, priceCents: 400, feeCents: 0 });
  try {
    const member = await prisma.user.create({
      data: { email: `taxa-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
    });
    await prisma.organizationMember.create({
      data: {
        organizationId: fixture.organization.id,
        userId: member.id,
        roleId: fixture.ownerRoleId,
        status: "ACTIVE",
      },
    });

    const catalog = new CatalogService(new OrgAccessService(), new InventoryService());

    // produtor tenta digitar taxa de R$ 1,00 num ingresso de R$ 4,00 —
    // o servidor ignora e aplica a taxa da plataforma (piso R$ 2,49)
    const lot = await catalog.createLot(fixture.ticketType.id, member.id, {
      name: "Lote taxa real",
      priceCents: 400,
      feeCents: 100,
      capacity: 5,
      maxPerOrder: 4,
    } as any);
    assert.equal(lot.feeCents, 249, "taxa vem da plataforma (piso), não do produtor");

    // ingresso grátis não paga piso
    const gratis = await catalog.createLot(fixture.ticketType.id, member.id, {
      name: "Lote grátis",
      priceCents: 0,
      feeCents: 500,
      capacity: 5,
      maxPerOrder: 4,
    } as any);
    assert.equal(gratis.feeCents, 0, "grátis = taxa zero");

    await catalog.activateLot(lot.id, member.id);

    // compra do lote pago: comprador paga 400+249; ledger lança EXATAMENTE 249
    const reservations = new ReservationsService(new InventoryService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    const payments = new PaymentsService(new IdempotencyService());
    const reservation = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: lot.id, quantity: 1 }],
    });
    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: "taxa-real@borafest.dev",
    });
    assert.equal(order.totalCents, 649);
    const payment = await payments.createPix(order.id, {});
    await applyGatewayStatus(payment.id, "PAID");

    const ledgerAccount = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { organizationId: fixture.organization.id },
    });
    const feeEntry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { ledgerAccountId: ledgerAccount.id, type: "PLATFORM_FEE" },
    });
    assert.equal(feeEntry.amountCents, -249, "caixa lança o que foi cobrado do comprador");
    const saleEntry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { ledgerAccountId: ledgerAccount.id, type: "SALE_CREDIT" },
    });
    assert.equal(saleEntry.amountCents, 649);
    // líquido do produtor: 649 - 249 = 400 = exatamente o preço do ingresso
    assert.equal(saleEntry.amountCents + feeEntry.amountCents, 400);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
