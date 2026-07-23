import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { InventoryModule } from "../inventory/inventory.module";
import { CatalogController } from "./catalog.controller";
import { PublicCatalogController } from "./public-catalog.controller";
import { CatalogService } from "./catalog.service";

@Module({
  imports: [CommonModule, InventoryModule],
  controllers: [CatalogController, PublicCatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
