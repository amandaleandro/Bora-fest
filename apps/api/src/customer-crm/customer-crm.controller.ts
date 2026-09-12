import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { CustomerCrmService } from "./customer-crm.service";

@Controller()
@UseGuards(SessionGuard)
export class CustomerCrmController {
  constructor(private readonly customerCrm: CustomerCrmService) {}

  @Get("v1/organizations/:organizationId/customers")
  list(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Query("q") q?: string,
    @Query("segment") segment?: string,
    @Query("page") pageRaw?: string,
    @Query("pageSize") pageSizeRaw?: string,
  ) {
    const page = pageRaw ? Number(pageRaw) : undefined;
    const pageSize = pageSizeRaw ? Number(pageSizeRaw) : undefined;
    return this.customerCrm.list(organizationId, userId, { q, segment, page, pageSize });
  }
}
