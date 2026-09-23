import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { prisma, Prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import type { CreateStoreOrderInput, FulfillStoreOrderInput } from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";

const ORDER_TTL_MS = 15 * 60 * 1000;

function excludedOrgSlugs() {
  return (process.env.PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
}

function pickupCode() {
  return randomBytes(4).toString("hex").toUpperCase();
}

@Injectable()
export class StoreOrdersService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  async createPublic(houseSlug: string, input: CreateStoreOrderInput) {
    const excluded = excludedOrgSlugs();
    const organization = await prisma.organization.findFirst({
      where: {
        slug: excluded.length ? { equals: houseSlug, notIn: excluded } : houseSlug,
        status: { notIn: ["SUSPENDED", "BLOCKED"] },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        displayName: true,
        storePickupEnabled: true,
        storeDeliveryEnabled: true,
        storeFlatShippingCents: true,
      },
    });
    if (!organization) throw new NotFoundException("Casa não encontrada");

    const quantities = new Map<string, number>();
    for (const item of input.items) {
      quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
    }
    const variantIds = [...quantities.keys()];

    const variants = await prisma.storeProductVariant.findMany({
      where: {
        id: { in: variantIds },
        active: true,
        product: {
          organizationId: organization.id,
          status: "ACTIVE",
        },
      },
      include: {
        product: { select: { id: true, name: true, status: true, organizationId: true } },
      },
    });
    if (variants.length !== variantIds.length) {
      throw new BadRequestException("Um ou mais produtos não estão disponíveis para compra");
    }

    const subtotalCents = variants.reduce(
      (sum, variant) => sum + variant.priceCents * (quantities.get(variant.id) ?? 0),
      0,
    );
    if (subtotalCents <= 0) {
      throw new BadRequestException("Pedido da Loja precisa ter valor maior que zero");
    }

    if (input.fulfillmentMethod === "PICKUP" && !organization.storePickupEnabled) {
      throw new BadRequestException("Retirada não está habilitada nesta Loja");
    }
    if (input.fulfillmentMethod === "DELIVERY" && !organization.storeDeliveryEnabled) {
      throw new BadRequestException("Entrega não está habilitada nesta Loja");
    }
    if (input.fulfillmentMethod === "DELIVERY" && !input.shippingAddress) {
      throw new BadRequestException("Informe o endereço de entrega");
    }
    const shippingCents =
      input.fulfillmentMethod === "DELIVERY" ? organization.storeFlatShippingCents : 0;
    const totalCents = subtotalCents + shippingCents;

    const expiresAt = new Date(Date.now() + ORDER_TTL_MS);

    const order = await prisma.$transaction(async (tx) => {
      for (const variant of variants) {
        const qty = quantities.get(variant.id) ?? 0;
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          UPDATE store_product_variants
          SET reserved_count = reserved_count + ${qty},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${variant.id}::uuid
            AND active = true
            AND stock_total - sold_count - reserved_count >= ${qty}
          RETURNING id
        `);
        if (rows.length === 0) {
          throw new BadRequestException(
            `Estoque insuficiente para ${variant.product.name} · ${variant.name}`,
          );
        }
      }

      let code = pickupCode();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const exists = await tx.storeOrder.findUnique({
          where: { pickupCode: code },
          select: { id: true },
        });
        if (!exists) break;
        code = pickupCode();
      }

      return tx.storeOrder.create({
        data: {
          organizationId: organization.id,
          contactName: input.contactName,
          contactEmail: input.contactEmail.toLowerCase(),
          contactPhone: input.contactPhone,
          fulfillmentMethod: input.fulfillmentMethod,
          pickupCode: code,
          subtotalCents,
          shippingCents,
          totalCents,
          shippingAddress: input.fulfillmentMethod === "DELIVERY"
            ? (input.shippingAddress as Prisma.InputJsonValue)
            : undefined,
          expiresAt,
          items: {
            create: variants.map((variant) => ({
              variantId: variant.id,
              productName: variant.product.name,
              variantName: variant.name,
              quantity: quantities.get(variant.id) ?? 0,
              priceCents: variant.priceCents,
            })),
          },
        },
        include: { items: true },
      });
    });

    return {
      id: order.id,
      publicToken: order.publicToken,
      status: order.status,
      house: {
        slug: organization.slug,
        name: organization.displayName ?? organization.name,
      },
      contactName: order.contactName,
      contactEmail: order.contactEmail,
      contactPhone: order.contactPhone,
      fulfillmentMethod: order.fulfillmentMethod,
      subtotalCents: order.subtotalCents,
      shippingCents: order.shippingCents,
      totalCents: order.totalCents,
      shippingAddress: order.shippingAddress,
      expiresAt: order.expiresAt,
      paidAt: order.paidAt,
      pickupCode: null,
      items: order.items,
    };
  }

  async findPublic(publicToken: string) {
    const order = await prisma.storeOrder.findUnique({
      where: { publicToken },
      include: {
        organization: { select: { slug: true, name: true, displayName: true, logoUrl: true } },
        items: true,
        payments: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: {
            id: true,
            method: true,
            status: true,
            amountCents: true,
            pixQrCodeText: true,
            expiresAt: true,
            paidAt: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException("Pedido da Loja não encontrado");

    const showPickupCode =
      order.fulfillmentMethod === "PICKUP" &&
      ["PAID", "READY", "FULFILLED"].includes(order.status);
    return {
      id: order.id,
      publicToken: order.publicToken,
      status: order.status,
      house: {
        slug: order.organization.slug,
        name: order.organization.displayName ?? order.organization.name,
        logoUrl: order.organization.logoUrl,
      },
      contactName: order.contactName,
      contactEmail: order.contactEmail,
      contactPhone: order.contactPhone,
      fulfillmentMethod: order.fulfillmentMethod,
      subtotalCents: order.subtotalCents,
      shippingCents: order.shippingCents,
      totalCents: order.totalCents,
      shippingAddress: order.shippingAddress,
      expiresAt: order.expiresAt,
      paidAt: order.paidAt,
      fulfilledAt: order.fulfilledAt,
      pickupCode: showPickupCode ? order.pickupCode : null,
      items: order.items,
      payments: order.payments,
    };
  }

  async listManage(organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.EVENT_CREATE);
    return prisma.storeOrder.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        items: true,
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { method: true, status: true, amountCents: true, paidAt: true },
        },
      },
    });
  }

  async markReady(orderId: string, userId: string) {
    const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Pedido da Loja não encontrado");
    await this.orgAccess.assertPermission(order.organizationId, userId, PERMISSIONS.EVENT_CREATE);

    const changed = await prisma.storeOrder.updateMany({
      where: { id: order.id, status: "PAID" },
      data: { status: "READY" },
    });
    if (changed.count === 0) {
      throw new BadRequestException("Somente pedido pago e ainda em preparo pode ficar pronto");
    }

    await prisma.notification.create({
      data: {
        channel: "EMAIL",
        recipient: order.contactEmail,
        template: "store_order_ready",
        payload: {
          storeOrderId: order.id,
          pickupCode: order.fulfillmentMethod === "PICKUP" ? order.pickupCode : null,
          fulfillmentMethod: order.fulfillmentMethod,
          orderUrl: (process.env.WEB_BASE_URL ?? "https://borafest.com.br") + "/loja/pedido/" + order.publicToken,
        },
      },
    });

    return { ready: true };
  }

  async fulfill(orderId: string, userId: string, input: FulfillStoreOrderInput) {
    const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Pedido da Loja não encontrado");
    await this.orgAccess.assertPermission(order.organizationId, userId, PERMISSIONS.EVENT_CREATE);

    if (order.status !== "READY") {
      throw new BadRequestException("Marque o pedido como pronto antes de confirmar a retirada");
    }
    if (order.fulfillmentMethod === "PICKUP") {
      if (!input.pickupCode || order.pickupCode.toUpperCase() !== input.pickupCode.toUpperCase()) {
        throw new ForbiddenException("Código de retirada incorreto");
      }
    }

    const updated = await prisma.storeOrder.updateMany({
      where: { id: order.id, status: "READY" },
      data: { status: "FULFILLED", fulfilledAt: new Date() },
    });
    if (updated.count === 0) {
      throw new BadRequestException("Pedido já foi entregue ou mudou de estado");
    }

    return { fulfilled: true };
  }

  async analytics(organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.FINANCE_VIEW);
    const orders = await prisma.storeOrder.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 2000,
      include: { items: true },
    });
    const paidOrders = orders.filter((order) =>
      ["PAID", "READY", "FULFILLED", "REFUNDED", "CHARGEBACK"].includes(order.status),
    );
    const grossCents = paidOrders
      .filter((order) => !["REFUNDED", "CHARGEBACK"].includes(order.status))
      .reduce((sum, order) => sum + order.totalCents, 0);
    const activePaid = paidOrders.filter(
      (order) => !["REFUNDED", "CHARGEBACK"].includes(order.status),
    );
    const customers = new Map<
      string,
      { name: string; email: string; phone: string | null; orders: number; spentCents: number; lastOrderAt: Date }
    >();
    const products = new Map<string, { name: string; quantity: number; revenueCents: number }>();

    for (const order of activePaid) {
      const key = order.contactEmail.toLowerCase();
      const current = customers.get(key);
      customers.set(key, {
        name: order.contactName,
        email: order.contactEmail,
        phone: order.contactPhone,
        orders: (current?.orders ?? 0) + 1,
        spentCents: (current?.spentCents ?? 0) + order.totalCents,
        lastOrderAt:
          !current || order.createdAt > current.lastOrderAt ? order.createdAt : current.lastOrderAt,
      });
      for (const item of order.items) {
        const product = products.get(item.productName);
        products.set(item.productName, {
          name: item.productName,
          quantity: (product?.quantity ?? 0) + item.quantity,
          revenueCents: (product?.revenueCents ?? 0) + item.priceCents * item.quantity,
        });
      }
    }

    return {
      grossCents,
      paidOrders: activePaid.length,
      averageTicketCents:
        activePaid.length > 0 ? Math.round(grossCents / activePaid.length) : 0,
      uniqueCustomers: customers.size,
      pendingPreparation: orders.filter((order) => order.status === "PAID").length,
      ready: orders.filter((order) => order.status === "READY").length,
      pickupOrders: activePaid.filter((order) => order.fulfillmentMethod === "PICKUP").length,
      deliveryOrders: activePaid.filter((order) => order.fulfillmentMethod === "DELIVERY").length,
      topProducts: [...products.values()]
        .sort((a, b) => b.quantity - a.quantity || b.revenueCents - a.revenueCents)
        .slice(0, 10),
      customers: [...customers.values()]
        .sort((a, b) => b.spentCents - a.spentCents)
        .slice(0, 100),
    };
  }

  async expireOpenOrders(limit = 100) {
    const expired = await prisma.storeOrder.findMany({
      where: {
        status: { in: ["CREATED", "PAYMENT_PENDING"] },
        expiresAt: { lte: new Date() },
      },
      orderBy: { expiresAt: "asc" },
      take: limit,
      include: { items: true, payments: { where: { status: "PENDING" } } },
    });

    let released = 0;
    for (const order of expired) {
      // Se o PSP ainda considera a cobrança pendente e ela não expirou,
      // preservamos a reserva até o próprio Pix vencer.
      const livePayment = order.payments.some(
        (p) => p.expiresAt && p.expiresAt.getTime() > Date.now(),
      );
      if (livePayment) continue;

      const changed = await prisma.$transaction(async (tx) => {
        const canceled = await tx.storeOrder.updateMany({
          where: { id: order.id, status: { in: ["CREATED", "PAYMENT_PENDING"] } },
          data: { status: "CANCELED" },
        });
        if (canceled.count === 0) return false;

        for (const item of order.items) {
          const released = await tx.$executeRaw(Prisma.sql`
            UPDATE store_product_variants
            SET reserved_count = reserved_count - ${item.quantity},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${item.variantId}::uuid
              AND reserved_count >= ${item.quantity}
          `);
          if (released === 0) {
            throw new Error(`Reserva de estoque inconsistente na variação ${item.variantId}`);
          }
        }
        return true;
      });
      if (changed) released += 1;
    }

    return { checked: expired.length, released };
  }
}
