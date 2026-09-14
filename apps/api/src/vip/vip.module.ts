import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { EventVipController } from "./event-vip.controller";
import { PublicVipController } from "./public-vip.controller";
import { PublicVipReservationController } from "./public-vip-reservation.controller";
import { PublicVipStatusService } from "./public-vip-status.service";
import { VipManagementController } from "./vip-management.controller";
import { VipPaymentsService } from "./vip-payments.service";
import { VipService } from "./vip.service";

@Module({
  imports: [CommonModule],
  controllers: [PublicVipController, PublicVipReservationController, EventVipController, VipManagementController],
  providers: [VipService, VipPaymentsService, PublicVipStatusService],
})
export class VipModule {}
