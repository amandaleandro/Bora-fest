import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { PromoterPerformanceController } from "../promoter-performance/promoter-performance.controller";
import { PromoterPerformanceService } from "../promoter-performance/promoter-performance.service";
import { OrganizationsController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";

@Module({
  imports: [CommonModule],
  controllers: [OrganizationsController, PromoterPerformanceController],
  providers: [OrganizationsService, PromoterPerformanceService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
