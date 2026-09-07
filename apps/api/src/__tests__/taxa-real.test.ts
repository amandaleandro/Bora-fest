import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { applyGatewayStatus, computePlatformFeeCents } from "@borafest/payments";
import { closeRedisConnection } from "@borafest/queues";
import { CatalogService } from "../catalog/catalog.service";
import { OrgAccessService } from "../common/org-access.service";
import { ReservationsService } from "../reservations/reservations.service";
import { CouponsService } from "../coupons/coupons.service";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { InventoryService } from "../inventory/inventory.service";
import { WaitingRoomService } from "../waiting-room/waiting-room.service";
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

    // A tabela de taxa muda (piso já foi 249, hoje é 100 — REGISTRO 2026-08-12).
    // Então o teste trava a REGRA, não o número: a taxa é a que a plataforma
    // calcula, e o que o produtor digita é ignorado. Por isso ele digita um
    // valor ABSURDO — se o servidor obedecesse, a asserção quebraria.
    const PRECO = 400;
    const TAXA = computePlatformFeeCents("PIX", PRECO, {} as never);
    assert.ok(TAXA > 0 && TAXA !== 999, "sanidade: a taxa da plataforma não é a digitada");
    const lot = await catalog.createLot(fixture.ticketType.id, member.id, {
      name: "Lote taxa real",
      priceCents: PRECO,
      feeCents: 999,
      capacity: 5,
      maxPerOrder: 4,
    } as any);
    assert.equal(lot.feeCents, TAXA, "taxa vem da plataforma, não do produtor");

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

    // comprador paga PRECO+TAXA; o ledger lança EXATAMENTE a mesma TAXA
    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
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
    assert.equal(order.totalCents, PRECO + TAXA, "pedido cobra preço + taxa da plataforma");
    const payment = await payments.createPix(order.id, {});
    await applyGatewayStatus(payment.id, "PAID");

    const ledgerAccount = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { organizationId: fixture.organization.id },
    });
    const feeEntry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { ledgerAccountId: ledgerAccount.id, type: "PLATFORM_FEE" },
    });
    assert.equal(feeEntry.amountCents, -TAXA, "caixa lança o que foi cobrado do comprador");
    const saleEntry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { ledgerAccountId: ledgerAccount.id, type: "SALE_CREDIT" },
    });
    assert.equal(saleEntry.amountCents, PRECO + TAXA);
    // líquido do produtor = exatamente o preço do ingresso (a taxa é do comprador)
    assert.equal(saleEntry.amountCents + feeEntry.amountCents, PRECO);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("pagamento abaixo do mínimo do provedor é barrado com mensagem clara", async () => {
  const fixture = await createFixtureEvent({ lotCapacity: 5, priceCents: 250, feeCents: 0 });
  try {
    const member = await prisma.user.create({
      data: { email: `min-${Math.random().toString(36).slice(2, 8)}@borafest.dev` },
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
    const lot = await catalog.createLot(fixture.ticketType.id, member.id, {
      name: "Barato demais",
      priceCents: 250,
      feeCents: 0,
      capacity: 5,
      maxPerOrder: 4,
    } as any);
    await catalog.activateLot(lot.id, member.id);

    const reservations = new ReservationsService(new InventoryService(), new WaitingRoomService());
    const orders = new OrdersService(new CouponsService(new OrgAccessService()), new OrgAccessService());
    const payments = new PaymentsService(new IdempotencyService());
    const reservation = await reservations.create(undefined, {
      eventId: fixture.event.id,
      items: [{ ticketLotId: lot.id, quantity: 1 }],
    });
    const order = await orders.createFromReservation(undefined, {
      reservationId: reservation.id,
      contactEmail: "minimo@borafest.dev",
    });
    // preço + taxa fica abaixo do mínimo que o provedor aceita cobrar
    const TAXA_MIN = computePlatformFeeCents("PIX", 250, {} as never);
    assert.equal(order.totalCents, 250 + TAXA_MIN);
    assert.ok(order.totalCents < 500, "o cenário só vale se ficar abaixo do mínimo do provedor");

    await assert.rejects(
      () => payments.createPix(order.id, {}),
      /pagamento mínimo é de R\$\s?5,00/,
    );
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
