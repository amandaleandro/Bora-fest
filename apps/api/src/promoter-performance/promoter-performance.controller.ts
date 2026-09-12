import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { PromoterPerformanceService } from "./promoter-performance.service";

@Controller()
@UseGuards(SessionGuard)
export class PromoterPerformanceController {
  constructor(private readonly promoterPerformance: PromoterPerformanceService) {}

  @Get("v1/organizations/:organizationId/events/:eventId/promoters/performance")
  forEvent(
    @Param("organizationId") organizationId: string,
    @Param("eventId") eventId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.promoterPerformance.forEvent(organizationId, eventId, userId);
  }
}
