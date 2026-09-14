import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { CrmReactivationController } from "../customer-crm/crm-reactivation.controller";
import { CrmReactivationService } from "../customer-crm/crm-reactivation.service";
import { CustomerCrmController } from "../customer-crm/customer-crm.controller";
import { CustomerCrmService } from "../customer-crm/customer-crm.service";
import { RetentionIntelligenceController } from "../customer-crm/retention-intelligence.controller";
import { RetentionIntelligenceService } from "../customer-crm/retention-intelligence.service";
import { CustomerIntelligenceController } from "../customer-intelligence/customer-intelligence.controller";
import { CustomerIntelligenceService } from "../customer-intelligence/customer-intelligence.service";
import { CustomerSegmentsController } from "../customer-segments/customer-segments.controller";
import { CustomerSegmentsService } from "../customer-segments/customer-segments.service";
import { PromoterPerformanceController } from "../promoter-performance/promoter-performance.controller";
import { PromoterPerformanceService } from "../promoter-performance/promoter-performance.service";
import { RevenueIntelligenceController } from "../revenue-intelligence/revenue-intelligence.controller";
import { RevenueIntelligenceService } from "../revenue-intelligence/revenue-intelligence.service";
import { OrganizationsController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";

@Module({
  imports: [CommonModule],
  controllers: [
    OrganizationsController,
    PromoterPerformanceController,
    CustomerCrmController,
    CrmReactivationController,
    RetentionIntelligenceController,
    RevenueIntelligenceController,
    CustomerIntelligenceController,
    CustomerSegmentsController,
  ],
  providers: [
    OrganizationsService,
    PromoterPerformanceService,
    CustomerCrmService,
    CrmReactivationService,
    RetentionIntelligenceService,
    RevenueIntelligenceService,
    CustomerIntelligenceService,
    CustomerSegmentsService,
  ],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
