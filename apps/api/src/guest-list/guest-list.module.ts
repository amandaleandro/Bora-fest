import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { InventoryModule } from "../inventory/inventory.module";
import { GuestListController } from "./guest-list.controller";
import { GuestListService } from "./guest-list.service";

@Module({
  imports: [CommonModule, InventoryModule],
  controllers: [GuestListController],
  providers: [GuestListService],
})
export class GuestListModule {}
