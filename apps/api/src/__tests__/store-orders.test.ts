import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { applyStoreGatewayStatus } from "@borafest/payments";
import { OrgAccessService } from "../common/org-access.service";
import { StoreOrdersService } from "../store/store-orders.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

after(async () => {
  await closeRedisConnection();
  await prisma.$disconnect();
});

async function buildStore() {
  const fixture = await createFixtureEvent({ lotCapacity: 1 });
  const product = await prisma.storeProduct.create({
    data: {
      organizationId: fixture.organization.id,
      name: "Camiseta Oficial",
      slug: `camiseta-${Math.random().toString(36).slice(2, 8)}`,
      status: "ACTIVE",
    },
  });
  const variant = await prisma.storeProductVariant.create({
    data: {
      productId: product.id,
      name: "M",
      priceCents: 5000,
      stockTotal: 2,
      active: true,
    },
  });
  return { ...fixture, product, variant };
}

test("pedido da Loja reserva estoque e congela preço", async () => {
  const fixture = await buildStore();
  try {
    const service = new StoreOrdersService(new OrgAccessService());
    const order = await service.createPublic(fixture.organization.slug, {
      items: [{ variantId: fixture.variant.id, quantity: 1 }],
      contactName: "Cliente Loja",
      contactEmail: "cliente-loja@example.com",
      fulfillmentMethod: "PICKUP",
    });

    assert.equal(order.totalCents, 5000);
    assert.equal(order.items[0].priceCents, 5000);

    const variant = await prisma.storeProductVariant.findUniqueOrThrow({
      where: { id: fixture.variant.id },
    });
    assert.equal(variant.reservedCount, 1);
    assert.equal(variant.soldCount, 0);

    await prisma.storeProductVariant.update({
      where: { id: fixture.variant.id },
      data: { priceCents: 9000 },
    });
    const persisted = await prisma.storeOrderItem.findFirstOrThrow({
      where: { orderId: order.id },
    });
    assert.equal(persisted.priceCents, 5000, "pedido mantém o preço do momento da compra");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("Loja não permite reservar acima do estoque disponível", async () => {
  const fixture = await buildStore();
  try {
    const service = new StoreOrdersService(new OrgAccessService());
    await service.createPublic(fixture.organization.slug, {
      items: [{ variantId: fixture.variant.id, quantity: 2 }],
      contactName: "Primeiro Cliente",
      contactEmail: "primeiro@example.com",
      fulfillmentMethod: "PICKUP",
    });

    await assert.rejects(
      () =>
        service.createPublic(fixture.organization.slug, {
          items: [{ variantId: fixture.variant.id, quantity: 1 }],
          contactName: "Segundo Cliente",
          contactEmail: "segundo@example.com",
          fulfillmentMethod: "PICKUP",
        }),
      /estoque insuficiente/i,
    );

    const variant = await prisma.storeProductVariant.findUniqueOrThrow({
      where: { id: fixture.variant.id },
    });
    assert.equal(variant.reservedCount, 2);
    assert.equal(variant.soldCount, 0);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("PAID converte reserva em venda e lança financeiro uma única vez", async () => {
  const fixture = await buildStore();
  try {
    const service = new StoreOrdersService(new OrgAccessService());
    const order = await service.createPublic(fixture.organization.slug, {
      items: [{ variantId: fixture.variant.id, quantity: 1 }],
      contactName: "Cliente Pago",
      contactEmail: "pago@example.com",
      fulfillmentMethod: "PICKUP",
    });
    const payment = await prisma.storePayment.create({
      data: {
        storeOrderId: order.id,
        provider: "mock",
        method: "PIX",
        status: "PENDING",
        amountCents: order.totalCents,
        externalId: `store-pay-${Math.random().toString(36).slice(2, 10)}`,
      },
    });

    const first = await applyStoreGatewayStatus(payment.id, "PAID");
    assert.equal(first.orderPaid, true);

    const second = await applyStoreGatewayStatus(payment.id, "PAID");
    assert.equal(second.orderPaid, false, "webhook repetido deve ser no-op");

    const [variant, paidOrder, creditCount, feeCount] = await Promise.all([
      prisma.storeProductVariant.findUniqueOrThrow({ where: { id: fixture.variant.id } }),
      prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } }),
      prisma.ledgerEntry.count({
        where: { referenceType: "store_payment", referenceId: payment.id, type: "SALE_CREDIT" },
      }),
      prisma.ledgerEntry.count({
        where: { referenceType: "store_payment", referenceId: payment.id, type: "PLATFORM_FEE" },
      }),
    ]);

    assert.equal(variant.reservedCount, 0);
    assert.equal(variant.soldCount, 1);
    assert.equal(paidOrder.status, "PAID");
    assert.ok(paidOrder.pickupCode.length >= 6);
    assert.equal(creditCount, 1);
    assert.equal(feeCount, 1);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("estorno antes da retirada devolve estoque e reverte financeiro", async () => {
  const fixture = await buildStore();
  try {
    const service = new StoreOrdersService(new OrgAccessService());
    const order = await service.createPublic(fixture.organization.slug, {
      items: [{ variantId: fixture.variant.id, quantity: 1 }],
      contactName: "Cliente Estorno",
      contactEmail: "estorno@example.com",
      fulfillmentMethod: "PICKUP",
    });
    const payment = await prisma.storePayment.create({
      data: {
        storeOrderId: order.id,
        provider: "mock",
        method: "PIX",
        status: "PENDING",
        amountCents: order.totalCents,
        externalId: `store-refund-${Math.random().toString(36).slice(2, 10)}`,
      },
    });

    await applyStoreGatewayStatus(payment.id, "PAID");
    const reversed = await applyStoreGatewayStatus(payment.id, "REFUNDED");
    assert.equal(reversed.stockReturned, true);

    const variant = await prisma.storeProductVariant.findUniqueOrThrow({
      where: { id: fixture.variant.id },
    });
    const refunded = await prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(variant.soldCount, 0);
    assert.equal(refunded.status, "REFUNDED");

    const debit = await prisma.ledgerEntry.findFirst({
      where: { referenceType: "store_payment", referenceId: payment.id, type: "REFUND_DEBIT" },
    });
    assert.equal(debit?.amountCents, -order.totalCents);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
