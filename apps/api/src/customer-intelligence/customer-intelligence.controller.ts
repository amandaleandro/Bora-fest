import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { CustomerIntelligenceService } from "./customer-intelligence.service";

@Controller()
@UseGuards(SessionGuard)
export class CustomerIntelligenceController {
  constructor(private readonly intelligence: CustomerIntelligenceService) {}

  @Get("v1/organizations/:organizationId/intelligence/customers")
  list(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Query("q") q?: string,
    @Query("page") pageRaw?: string,
    @Query("pageSize") pageSizeRaw?: string,
  ) {
    return this.intelligence.list(organizationId, userId, {
      q,
      page: pageRaw ? Number(pageRaw) : undefined,
      pageSize: pageSizeRaw ? Number(pageSizeRaw) : undefined,
    });
  }
}
