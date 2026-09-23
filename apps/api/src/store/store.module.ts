import { Module } from "@nestjs/common";
import { OrgAccessService } from "../common/org-access.service";
import {
  PublicStoreController,
  StoreProductController,
  StoreProductsController,
  StoreVariantController,
} from "./store.controller";
import { StoreService } from "./store.service";
import { StoreOrdersService } from "./store-orders.service";
import { StorePaymentsService } from "./store-payments.service";
import { StoreRefundsService } from "./store-refunds.service";
import {
  PublicStoreOrderController,
  PublicStoreOrdersController,
  StoreOrderManageController,
  StoreOrdersManageController,
  StoreRefundRequestsController,
} from "./store-orders.controller";

@Module({
  controllers: [
    StoreProductsController,
    StoreProductController,
    StoreVariantController,
    PublicStoreController,
    PublicStoreOrdersController,
    PublicStoreOrderController,
    StoreOrdersManageController,
    StoreOrderManageController,
    StoreRefundRequestsController,
  ],
  providers: [StoreService, StoreOrdersService, StorePaymentsService, StoreRefundsService, OrgAccessService],
  exports: [StoreService, StoreOrdersService],
})
export class StoreModule {}
