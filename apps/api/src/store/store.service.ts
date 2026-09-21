import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma, Prisma } from "@borafest/database";
import { PERMISSIONS } from "@borafest/auth";
import type {
  CreateStoreProductInput,
  CreateStoreVariantInput,
  UpdateStoreProductInput,
  UpdateStoreVariantInput,
} from "@borafest/contracts";
import { OrgAccessService } from "../common/org-access.service";

function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "produto";
}

function excludedOrgSlugs() {
  return (process.env.PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
}

@Injectable()
export class StoreService {
  constructor(private readonly orgAccess: OrgAccessService) {}

  private async assertManage(organizationId: string, userId: string) {
    await this.orgAccess.assertPermission(organizationId, userId, PERMISSIONS.EVENT_CREATE);
  }

  private async uniqueSlug(organizationId: string, name: string, ignoreId?: string) {
    const base = slugify(name);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const exists = await prisma.storeProduct.findFirst({
        where: {
          organizationId,
          slug,
          ...(ignoreId ? { id: { not: ignoreId } } : {}),
        },
        select: { id: true },
      });
      if (!exists) return slug;
    }
    throw new BadRequestException("Não foi possível gerar um identificador único para o produto");
  }

  async listManage(organizationId: string, userId: string) {
    await this.assertManage(organizationId, userId);
    return prisma.storeProduct.findMany({
      where: { organizationId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { variants: { orderBy: { createdAt: "asc" } } },
    });
  }

  async createProduct(organizationId: string, userId: string, input: CreateStoreProductInput) {
    await this.assertManage(organizationId, userId);

    // uniqueSlug faz a escolha amigável, mas duas requisições simultâneas
    // ainda podem escolher o mesmo slug antes do INSERT. A constraint do banco
    // é a autoridade; em P2002 tentamos o próximo slug em vez de devolver 500.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const base = slugify(input.name);
      const slug = attempt === 0
        ? await this.uniqueSlug(organizationId, input.name)
        : `${base}-${Date.now().toString(36)}-${attempt + 1}`;
      try {
        return await prisma.storeProduct.create({
          data: {
            organizationId,
            name: input.name,
            slug,
            description: input.description,
            imageUrl: input.imageUrl,
          },
          include: { variants: true },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
      }
    }

    throw new BadRequestException("Não foi possível gerar um identificador único para o produto");
  }

  async updateProduct(productId: string, userId: string, input: UpdateStoreProductInput) {
    const product = await prisma.storeProduct.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException("Produto não encontrado");
    await this.assertManage(product.organizationId, userId);

    const slug =
      input.name && input.name !== product.name
        ? await this.uniqueSlug(product.organizationId, input.name, product.id)
        : undefined;

    if (input.status === "ACTIVE") {
      const variants = await prisma.storeProductVariant.count({
        where: { productId: product.id, active: true },
      });
      if (variants === 0) {
        throw new BadRequestException("Adicione pelo menos uma variação ativa antes de publicar o produto");
      }
    }

    try {
      return await prisma.storeProduct.update({
        where: { id: productId },
        data: {
          name: input.name,
          slug,
          description: input.description,
          imageUrl: input.imageUrl,
          status: input.status,
        },
        include: { variants: { orderBy: { createdAt: "asc" } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && input.name) {
        // corrida de rename: gera outro slug e preserva a alteração solicitada.
        const retrySlug = `${slugify(input.name)}-${Date.now().toString(36)}`;
        return prisma.storeProduct.update({
          where: { id: productId },
          data: {
            name: input.name,
            slug: retrySlug,
            description: input.description,
            imageUrl: input.imageUrl,
            status: input.status,
          },
          include: { variants: { orderBy: { createdAt: "asc" } } },
        });
      }
      throw error;
    }
  }

  async createVariant(productId: string, userId: string, input: CreateStoreVariantInput) {
    const product = await prisma.storeProduct.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException("Produto não encontrado");
    await this.assertManage(product.organizationId, userId);

    try {
      return await prisma.storeProductVariant.create({
        data: {
          productId,
          name: input.name,
          sku: input.sku,
          priceCents: input.priceCents,
          stockTotal: input.stockTotal,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Já existe uma variação com este nome ou SKU neste produto");
      }
      throw error;
    }
  }

  async updateVariant(variantId: string, userId: string, input: UpdateStoreVariantInput) {
    const variant = await prisma.storeProductVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { organizationId: true, status: true } } },
    });
    if (!variant) throw new NotFoundException("Variação não encontrada");
    await this.assertManage(variant.product.organizationId, userId);

    if (input.active === false && variant.active && variant.product.status === "ACTIVE") {
      const otherActive = await prisma.storeProductVariant.count({
        where: { productId: variant.productId, active: true, id: { not: variant.id } },
      });
      if (otherActive === 0) {
        throw new BadRequestException(
          "Produto publicado precisa manter pelo menos uma variação ativa; pause ou arquive o produto primeiro",
        );
      }
    }

    // estoque físico total nunca pode ficar menor do que o que já saiu/está reservado.
    if (
      input.stockTotal !== undefined &&
      input.stockTotal < variant.soldCount + variant.reservedCount
    ) {
      throw new BadRequestException(
        "O estoque total não pode ficar abaixo do que já foi vendido ou reservado",
      );
    }

    try {
      return await prisma.storeProductVariant.update({
        where: { id: variantId },
        data: {
          name: input.name,
          sku: input.sku,
          priceCents: input.priceCents,
          stockTotal: input.stockTotal,
          active: input.active,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Já existe uma variação com este nome ou SKU neste produto");
      }
      throw error;
    }
  }

  async listPublicByHouseSlug(slug: string) {
    const excluded = excludedOrgSlugs();
    const organization = await prisma.organization.findFirst({
      where: {
        slug: excluded.length ? { equals: slug, notIn: excluded } : slug,
        status: { notIn: ["SUSPENDED", "BLOCKED"] },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        displayName: true,
        logoUrl: true,
      },
    });
    if (!organization) throw new NotFoundException("Casa não encontrada");

    const products = await prisma.storeProduct.findMany({
      where: { organizationId: organization.id, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        imageUrl: true,
        variants: {
          where: { active: true },
          orderBy: { priceCents: "asc" },
          select: {
            id: true,
            name: true,
            sku: true,
            priceCents: true,
            stockTotal: true,
            reservedCount: true,
            soldCount: true,
          },
        },
      },
    });

    return {
      organization: {
        ...organization,
        name: organization.displayName ?? organization.name,
      },
      products: products
        .map((product) => ({
          ...product,
          variants: product.variants.map((variant) => ({
            id: variant.id,
            name: variant.name,
            sku: variant.sku,
            priceCents: variant.priceCents,
            available: Math.max(
              variant.stockTotal - variant.reservedCount - variant.soldCount,
              0,
            ),
          })),
        }))
        .filter((product) => product.variants.length > 0),
    };
  }
}
