import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { RevenueIntelligenceService } from "./revenue-intelligence.service";

@Controller("v1/organizations/:organizationId/intelligence")
@UseGuards(SessionGuard)
export class RevenueIntelligenceController {
  constructor(private readonly revenue: RevenueIntelligenceService) {}

  @Get("revenue")
  getRevenue(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.revenue.get(organizationId, userId);
  }
}
