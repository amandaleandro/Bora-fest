import { Module } from "@nestjs/common";
import { CouponsModule } from "../coupons/coupons.module";
import { CommonModule } from "../common/common.module";
import { OrdersController, PdvController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { CancelamentoGratisService } from "./cancelamento-gratis.service";
import { NaoVouMaisController } from "./nao-vou-mais.controller";
import { NaoVouMaisService } from "./nao-vou-mais.service";

@Module({
  imports: [CouponsModule, CommonModule],
  controllers: [OrdersController, PdvController, NaoVouMaisController],
  providers: [OrdersService, CancelamentoGratisService, NaoVouMaisService],
  exports: [OrdersService],
})
export class OrdersModule {}
