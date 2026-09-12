import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { CustomerCrmController } from "../customer-crm/customer-crm.controller";
import { CustomerCrmService } from "../customer-crm/customer-crm.service";
import { RetentionIntelligenceController } from "../customer-crm/retention-intelligence.controller";
import { RetentionIntelligenceService } from "../customer-crm/retention-intelligence.service";
import { PromoterPerformanceController } from "../promoter-performance/promoter-performance.controller";
import { PromoterPerformanceService } from "../promoter-performance/promoter-performance.service";
import { OrganizationsController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";

@Module({
  imports: [CommonModule],
  controllers: [
    OrganizationsController,
    PromoterPerformanceController,
    CustomerCrmController,
    RetentionIntelligenceController,
  ],
  providers: [
    OrganizationsService,
    PromoterPerformanceService,
    CustomerCrmService,
    RetentionIntelligenceService,
  ],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
