import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "@borafest/database";
import { closeRedisConnection } from "@borafest/queues";
import { applyStoreGatewayStatus } from "@borafest/payments";
import { OrgAccessService } from "../common/org-access.service";
import { IdempotencyService } from "../common/idempotency.service";
import { StoreOrdersService } from "../store/store-orders.service";
import { StoreRefundsService } from "../store/store-refunds.service";
import { StorePaymentsService } from "../store/store-payments.service";
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


test("entrega desabilitada é recusada pelo backend", async () => {
  const fixture = await buildStore();
  try {
    const service = new StoreOrdersService(new OrgAccessService());
    await assert.rejects(
      () =>
        service.createPublic(fixture.organization.slug, {
          items: [{ variantId: fixture.variant.id, quantity: 1 }],
          contactName: "Cliente Delivery Off",
          contactEmail: "delivery-off@example.com",
          fulfillmentMethod: "DELIVERY",
          shippingAddress: {
            postalCode: "38400000",
            street: "Rua Teste",
            number: "100",
            neighborhood: "Centro",
            city: "Uberlândia",
            state: "MG",
          },
        }),
      /entrega não está habilitada/i,
    );
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("frete da entrega vem da configuração da Casa e entra no total", async () => {
  const fixture = await buildStore();
  try {
    await prisma.organization.update({
      where: { id: fixture.organization.id },
      data: {
        storeDeliveryEnabled: true,
        storeFlatShippingCents: 1200,
      },
    });
    const service = new StoreOrdersService(new OrgAccessService());
    const order = await service.createPublic(fixture.organization.slug, {
      items: [{ variantId: fixture.variant.id, quantity: 1 }],
      contactName: "Cliente Delivery",
      contactEmail: "delivery@example.com",
      fulfillmentMethod: "DELIVERY",
      shippingAddress: {
        postalCode: "38400000",
        street: "Rua Teste",
        number: "100",
        complement: "Apto 2",
        neighborhood: "Centro",
        city: "Uberlândia",
        state: "MG",
      },
    });

    assert.equal(order.subtotalCents, 5000);
    assert.equal(order.shippingCents, 1200);
    assert.equal(order.totalCents, 6200);
    assert.equal(order.fulfillmentMethod, "DELIVERY");

    const persisted = await prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(persisted.shippingCents, 1200);
    assert.equal((persisted.shippingAddress as { city?: string } | null)?.city, "Uberlândia");
  } finally {
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("cartão da Loja cobra total com frete e persiste parcelas", async () => {
  const fixture = await buildStore();
  try {
    await prisma.organization.update({
      where: { id: fixture.organization.id },
      data: { storeDeliveryEnabled: true, storeFlatShippingCents: 900 },
    });
    const orders = new StoreOrdersService(new OrgAccessService());
    const payments = new StorePaymentsService(new IdempotencyService());
    const order = await orders.createPublic(fixture.organization.slug, {
      items: [{ variantId: fixture.variant.id, quantity: 1 }],
      contactName: "Cliente Cartão",
      contactEmail: "card-store@example.com",
      contactPhone: "34999999999",
      fulfillmentMethod: "DELIVERY",
      shippingAddress: {
        postalCode: "38400000",
        street: "Avenida Teste",
        number: "55",
        neighborhood: "Centro",
        city: "Uberlândia",
        state: "MG",
      },
    });

    const payment = await payments.createCard(order.publicToken, {
      card: {
        number: "4111111111111111",
        holderName: "CLIENTE TESTE",
        expiryMonth: "12",
        expiryYear: "2030",
        ccv: "123",
        holderCpf: "12345678901",
        postalCode: "38400000",
        addressNumber: "55",
      },
      installments: 3,
      payerDocument: "12345678901",
    });

    assert.equal(payment.status, "PAID");
    assert.equal(payment.amountCents, 5900);

    const persistedPayment = await prisma.storePayment.findFirstOrThrow({
      where: { storeOrderId: order.id, method: "CARD" },
    });
    const persistedOrder = await prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(persistedPayment.installments, 3);
    assert.equal(persistedPayment.amountCents, 5900);
    assert.equal(persistedOrder.status, "PAID");
  } finally {
    await prisma.notification.deleteMany({ where: { recipient: "card-store@example.com" } });
    await cleanupFixtureEvent(fixture.organization.id);
  }
});

test("analytics da Loja separa retirada entrega e CRM", async () => {
  const fixture = await buildStore();
  let userId: string | undefined;
  try {
    const owner = await addOwnerMembership(fixture.organization.id, fixture.ownerRoleId);
    userId = owner.id;
    await prisma.organization.update({
      where: { id: fixture.organization.id },
      data: { storeDeliveryEnabled: true, storeFlatShippingCents: 1000 },
    });

    const orders = new StoreOrdersService(new OrgAccessService());
    const delivery = await orders.createPublic(fixture.organization.slug, {
      items: [{ variantId: fixture.variant.id, quantity: 1 }],
      contactName: "Cliente CRM",
      contactEmail: "crm-store@example.com",
      fulfillmentMethod: "DELIVERY",
      shippingAddress: {
        postalCode: "38400000",
        street: "Rua CRM",
        number: "1",
        neighborhood: "Centro",
        city: "Uberlândia",
        state: "MG",
      },
    });
    const payment = await prisma.storePayment.create({
      data: {
        storeOrderId: delivery.id,
        provider: "mock",
        method: "PIX",
        status: "PENDING",
        amountCents: delivery.totalCents,
        externalId: `analytics-store-${Math.random().toString(36).slice(2, 10)}`,
      },
    });
    await applyStoreGatewayStatus(payment.id, "PAID");

    const analytics = await orders.analytics(fixture.organization.id, owner.id);
    assert.equal(analytics.paidOrders, 1);
    assert.equal(analytics.deliveryOrders, 1);
    assert.equal(analytics.pickupOrders, 0);
    assert.equal(analytics.uniqueCustomers, 1);
    assert.equal(analytics.grossCents, 6000);
    assert.equal(analytics.topProducts[0]?.quantity, 1);
    assert.equal(analytics.customers[0]?.email, "crm-store@example.com");
  } finally {
    await prisma.notification.deleteMany({
      where: { recipient: { in: ["crm-store@example.com"] } },
    });
    await cleanupFixtureEvent(fixture.organization.id);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
});


test("retry de cartão com a mesma chave não cria segunda cobrança", async () => {
  const fixture = await buildStore();
  try {
    const orders = new StoreOrdersService(new OrgAccessService());
    const payments = new StorePaymentsService(new IdempotencyService());
    const order = await orders.createPublic(fixture.organization.slug, {
      items: [{ variantId: fixture.variant.id, quantity: 1 }],
      contactName: "Cliente Retry",
      contactEmail: "retry-card@example.com",
      fulfillmentMethod: "PICKUP",
    });

    const input = {
      card: {
        number: "4111111111111111",
        holderName: "CLIENTE RETRY",
        expiryMonth: "12",
        expiryYear: "2030",
        ccv: "123",
        holderCpf: "12345678901",
        postalCode: "38400000",
        addressNumber: "10",
      },
      installments: 1,
      payerDocument: "12345678901",
    };

    const first = await payments.createCard(
      order.publicToken,
      input,
      "127.0.0.1",
      "store-card-retry-test",
    );
    const second = await payments.createCard(
      order.publicToken,
      input,
      "127.0.0.1",
      "store-card-retry-test",
    );

    assert.equal(second.id, first.id);
    const count = await prisma.storePayment.count({
      where: { storeOrderId: order.id, method: "CARD" },
    });
    assert.equal(count, 1, "mesma Idempotency-Key precisa representar uma única cobrança");
  } finally {
    await prisma.notification.deleteMany({ where: { recipient: "retry-card@example.com" } });
    await prisma.idempotencyKey.deleteMany({
      where: { key: { contains: "store-card-retry-test" } },
    });
    await cleanupFixtureEvent(fixture.organization.id);
  }
});
