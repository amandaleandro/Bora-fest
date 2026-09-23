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
      select: { id: true, slug: true, name: true, displayName: true },
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

    const totalCents = variants.reduce(
      (sum, variant) => sum + variant.priceCents * (quantities.get(variant.id) ?? 0),
      0,
    );
    if (totalCents <= 0) {
      throw new BadRequestException("Pedido da Loja precisa ter valor maior que zero");
    }

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
          fulfillmentMethod: "PICKUP",
          pickupCode: code,
          totalCents,
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
      totalCents: order.totalCents,
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

    const showPickupCode = ["PAID", "READY", "FULFILLED"].includes(order.status);
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
      totalCents: order.totalCents,
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

  async fulfill(orderId: string, userId: string, input: FulfillStoreOrderInput) {
    const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Pedido da Loja não encontrado");
    await this.orgAccess.assertPermission(order.organizationId, userId, PERMISSIONS.EVENT_CREATE);

    if (!["PAID", "READY"].includes(order.status)) {
      throw new BadRequestException("Somente pedido pago pode ser entregue");
    }
    if (order.pickupCode.toUpperCase() !== input.pickupCode.toUpperCase()) {
      throw new ForbiddenException("Código de retirada incorreto");
    }

    const updated = await prisma.storeOrder.updateMany({
      where: { id: order.id, status: { in: ["PAID", "READY"] } },
      data: { status: "FULFILLED", fulfilledAt: new Date() },
    });
    if (updated.count === 0) {
      throw new BadRequestException("Pedido já foi entregue ou mudou de estado");
    }

    return { fulfilled: true };
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
          await tx.$executeRaw(Prisma.sql`
            UPDATE store_product_variants
            SET reserved_count = GREATEST(reserved_count - ${item.quantity}, 0),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${item.variantId}::uuid
          `);
        }
        return true;
      });
      if (changed) released += 1;
    }

    return { checked: expired.length, released };
  }
}
