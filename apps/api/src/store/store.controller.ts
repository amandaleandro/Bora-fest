import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createStoreProductSchema,
  createStoreVariantSchema,
  updateStoreProductSchema,
  updateStoreVariantSchema,
  updateStoreSettingsSchema,
} from "@borafest/contracts";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { ZodBody } from "../common/zod-body.decorator";
import { StoreService } from "./store.service";

@Controller("v1/organizations/:organizationId/store/settings")
@UseGuards(SessionGuard)
export class StoreSettingsController {
  constructor(private readonly store: StoreService) {}

  @Get()
  get(@Param("organizationId") organizationId: string, @CurrentUserId() userId: string) {
    return this.store.settings(organizationId, userId);
  }

  @Patch()
  update(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(updateStoreSettingsSchema)) body: unknown,
  ) {
    return this.store.updateSettings(organizationId, userId, body as any);
  }
}

@Controller("v1/organizations/:organizationId/store/products")
@UseGuards(SessionGuard)
export class StoreProductsController {
  constructor(private readonly store: StoreService) {}

  @Get()
  list(@Param("organizationId") organizationId: string, @CurrentUserId() userId: string) {
    return this.store.listManage(organizationId, userId);
  }

  @Post()
  create(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(createStoreProductSchema)) body: unknown,
  ) {
    return this.store.createProduct(organizationId, userId, body as any);
  }
}

@Controller("v1/store/products")
@UseGuards(SessionGuard)
export class StoreProductController {
  constructor(private readonly store: StoreService) {}

  @Patch(":productId")
  update(
    @Param("productId") productId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(updateStoreProductSchema)) body: unknown,
  ) {
    return this.store.updateProduct(productId, userId, body as any);
  }

  @Post(":productId/variants")
  createVariant(
    @Param("productId") productId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(createStoreVariantSchema)) body: unknown,
  ) {
    return this.store.createVariant(productId, userId, body as any);
  }
}

@Controller("v1/store/variants")
@UseGuards(SessionGuard)
export class StoreVariantController {
  constructor(private readonly store: StoreService) {}

  @Patch(":variantId")
  update(
    @Param("variantId") variantId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(updateStoreVariantSchema)) body: unknown,
  ) {
    return this.store.updateVariant(variantId, userId, body as any);
  }
}

@Controller("v1/public/casas")
export class PublicStoreController {
  constructor(private readonly store: StoreService) {}

  @Get(":slug/store")
  publicStore(@Param("slug") slug: string) {
    return this.store.listPublicByHouseSlug(slug);
  }
}
