import { Module } from "@nestjs/common";
import { CouponsModule } from "../coupons/coupons.module";
import { CommonModule } from "../common/common.module";
import { OrdersController, PdvController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [CouponsModule, CommonModule],
  controllers: [OrdersController, PdvController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
