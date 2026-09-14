import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { EventVipController } from "./event-vip.controller";
import { PublicVipController } from "./public-vip.controller";
import { VipManagementController } from "./vip-management.controller";
import { VipService } from "./vip.service";

@Module({
  imports: [CommonModule],
  controllers: [PublicVipController, EventVipController, VipManagementController],
  providers: [VipService],
})
export class VipModule {}
