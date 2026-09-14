import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { CustomerSegmentsService } from "./customer-segments.service";

@Controller()
@UseGuards(SessionGuard)
export class CustomerSegmentsController {
  constructor(private readonly customerSegments: CustomerSegmentsService) {}

  @Get("v1/organizations/:organizationId/intelligence/customer-segments")
  list(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Query("segment") segment?: string,
    @Query("q") q?: string,
    @Query("page") pageRaw?: string,
    @Query("pageSize") pageSizeRaw?: string,
  ) {
    const page = pageRaw ? Number(pageRaw) : undefined;
    const pageSize = pageSizeRaw ? Number(pageSizeRaw) : undefined;
    return this.customerSegments.list(organizationId, userId, { segment, q, page, pageSize });
  }
}
