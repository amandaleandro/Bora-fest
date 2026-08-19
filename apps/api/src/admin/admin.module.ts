import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { CommonModule } from "../common/common.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AdminController } from "./admin.controller";
import { AdminBannersController, PublicBannersController } from "./banners.controller";
import { BannersService } from "./banners.service";
import { AdminService } from "./admin.service";

@Module({
  imports: [CommonModule, NotificationsModule, FinanceModule],
  controllers: [AdminController, AdminBannersController, PublicBannersController],
  providers: [AdminService, BannersService],
})
export class AdminModule {}
