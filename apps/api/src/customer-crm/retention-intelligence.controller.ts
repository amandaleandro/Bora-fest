import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { RetentionIntelligenceService } from "./retention-intelligence.service";

@Controller()
@UseGuards(SessionGuard)
export class RetentionIntelligenceController {
  constructor(private readonly retention: RetentionIntelligenceService) {}

  @Get("v1/organizations/:organizationId/customers/retention")
  get(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.retention.get(organizationId, userId);
  }
}
