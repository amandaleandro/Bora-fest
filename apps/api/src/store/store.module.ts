import { Module } from "@nestjs/common";
import { OrgAccessService } from "../common/org-access.service";
import {
  PublicStoreController,
  StoreProductController,
  StoreProductsController,
  StoreVariantController,
} from "./store.controller";
import { StoreService } from "./store.service";

@Module({
  controllers: [
    StoreProductsController,
    StoreProductController,
    StoreVariantController,
    PublicStoreController,
  ],
  providers: [StoreService, OrgAccessService],
  exports: [StoreService],
})
export class StoreModule {}
