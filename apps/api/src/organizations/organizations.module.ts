import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { CustomerCrmController } from "../customer-crm/customer-crm.controller";
import { CustomerCrmService } from "../customer-crm/customer-crm.service";
import { PromoterPerformanceController } from "../promoter-performance/promoter-performance.controller";
import { PromoterPerformanceService } from "../promoter-performance/promoter-performance.service";
import { OrganizationsController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";

@Module({
  imports: [CommonModule],
  controllers: [OrganizationsController, PromoterPerformanceController, CustomerCrmController],
  providers: [OrganizationsService, PromoterPerformanceService, CustomerCrmService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
