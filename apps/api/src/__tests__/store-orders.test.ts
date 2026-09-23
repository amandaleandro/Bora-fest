import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { applyStoreGatewayStatus } from "@borafest/payments";
import { OrgAccessService } from "../common/org-access.service";
import { StoreOrdersService } from "../store/store-orders.service";
import { StoreRefundsService } from "../store/store-refunds.service";
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


test("pedido expirado devolve a reserva de estoque", async () => {
  const fixture = await buildStore();
  try {
    const service = new StoreOrdersService(new OrgAccessService());
    const order = await service.createPublic(fixture.organization.slug, {
      items: [{ variantId: fixture.variant.id, quantity: 1 }],
      contactName: "Cliente Expirado",
      contactEmail: "expirado@example.com",
      fulfillmentMethod: "PICKUP",
    });

    await prisma.storeOrder.update({
      where: { id: order.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const result = await service.expireOpenOrders();
    assert.ok(result.released >= 1);

    const [expired, variant] = await Promise.all([
      prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } }),
      prisma.storeProductVariant.findUniqueOrThrow({ where: { id: fixture.variant.id } }),
    ]);
    assert.equal(expired.status, "CANCELED");
    assert.equal(variant.reservedCount, 0);
    assert.equal(variant.soldCount, 0);
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});


async function addOwnerMembership(organizationId: string, ownerRoleId: string) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const user = await prisma.user.create({
    data: {
      email: `store-owner-${suffix}@example.com`,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.organizationMember.create({
    data: {
      organizationId,
      userId: user.id,
      roleId: ownerRoleId,
      status: "ACTIVE",
      joinedAt: new Date(),
    },
  });
  return user;
}

test("pedido pago pode virar READY e continua elegível à retirada", async () => {
  const fixture = await buildStore();
  let userId: string | undefined;
  try {
    const owner = await addOwnerMembership(fixture.organization.id, fixture.ownerRoleId);
    userId = owner.id;
    const service = new StoreOrdersService(new OrgAccessService());
    const order = await service.createPublic(fixture.organization.slug, {
      items: [{ variantId: fixture.variant.id, quantity: 1 }],
      contactName: "Cliente Pronto",
      contactEmail: "pronto@example.com",
      fulfillmentMethod: "PICKUP",
    });
    const payment = await prisma.storePayment.create({
      data: {
        storeOrderId: order.id,
        provider: "mock",
        method: "PIX",
        status: "PENDING",
        amountCents: order.totalCents,
        externalId: `store-ready-${Math.random().toString(36).slice(2, 10)}`,
      },
    });
    await applyStoreGatewayStatus(payment.id, "PAID");

    await service.markReady(order.id, owner.id);
    const ready = await prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(ready.status, "READY");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
});

test("devolução física repõe estoque uma vez e estorno não repõe de novo", async () => {
  const fixture = await buildStore();
  let userId: string | undefined;
  try {
    const owner = await addOwnerMembership(fixture.organization.id, fixture.ownerRoleId);
    userId = owner.id;
    const orders = new StoreOrdersService(new OrgAccessService());
    const refunds = new StoreRefundsService(new OrgAccessService());
    const order = await orders.createPublic(fixture.organization.slug, {
      items: [{ variantId: fixture.variant.id, quantity: 1 }],
      contactName: "Cliente Devolução",
      contactEmail: "devolucao@example.com",
      fulfillmentMethod: "PICKUP",
    });
    const payment = await prisma.storePayment.create({
      data: {
        storeOrderId: order.id,
        provider: "mock",
        method: "PIX",
        status: "PENDING",
        amountCents: order.totalCents,
        externalId: `store-return-${Math.random().toString(36).slice(2, 10)}`,
      },
    });
    await applyStoreGatewayStatus(payment.id, "PAID");
    await prisma.storeOrder.update({
      where: { id: order.id },
      data: { status: "FULFILLED", fulfilledAt: new Date() },
    });
    const request = await prisma.storeRefundRequest.create({
      data: {
        storeOrderId: order.id,
        reason: "Produto devolvido",
        status: "AWAITING_RETURN",
      },
    });

    await refunds.markReturned(request.id, fixture.organization.id, owner.id);
    const afterReturn = await prisma.storeProductVariant.findUniqueOrThrow({
      where: { id: fixture.variant.id },
    });
    assert.equal(afterReturn.soldCount, 0);

    await applyStoreGatewayStatus(payment.id, "REFUNDED");
    const afterRefund = await prisma.storeProductVariant.findUniqueOrThrow({
      where: { id: fixture.variant.id },
    });
    assert.equal(afterRefund.soldCount, 0, "estorno não pode repor novamente item já devolvido");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
});

test("webhook REFUNDED conclui pagamento que estava REFUND_PENDING", async () => {
  const fixture = await buildStore();
  try {
    const service = new StoreOrdersService(new OrgAccessService());
    const order = await service.createPublic(fixture.organization.slug, {
      items: [{ variantId: fixture.variant.id, quantity: 1 }],
      contactName: "Cliente Pending",
      contactEmail: "pending@example.com",
      fulfillmentMethod: "PICKUP",
    });
    const payment = await prisma.storePayment.create({
      data: {
        storeOrderId: order.id,
        provider: "mock",
        method: "PIX",
        status: "PENDING",
        amountCents: order.totalCents,
        externalId: `store-pending-${Math.random().toString(36).slice(2, 10)}`,
      },
    });
    await applyStoreGatewayStatus(payment.id, "PAID");
    await prisma.storePayment.update({
      where: { id: payment.id },
      data: { status: "REFUND_PENDING" },
    });

    const result = await applyStoreGatewayStatus(payment.id, "REFUNDED");
    assert.equal(result.paymentChanged, true);
    const finalPayment = await prisma.storePayment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(finalPayment.status, "REFUNDED");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
