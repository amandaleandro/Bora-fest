import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  imports: [CommonModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
