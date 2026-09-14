import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { updateLoyaltyProgramSchema } from "@borafest/contracts";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { ZodBody } from "../common/zod-body.decorator";
import { LoyaltyService } from "./loyalty.service";

@Controller("v1/organizations/:organizationId/loyalty")
@UseGuards(SessionGuard)
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get("program")
  program(@Param("organizationId") organizationId: string, @CurrentUserId() userId: string) {
    return this.loyalty.getProgram(organizationId, userId);
  }

  @Patch("program")
  updateProgram(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(updateLoyaltyProgramSchema)) body: unknown,
  ) {
    return this.loyalty.updateProgram(organizationId, userId, body as any);
  }

  @Get("accounts")
  accounts(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Query("q") q?: string,
    @Query("page") pageRaw?: string,
    @Query("pageSize") pageSizeRaw?: string,
  ) {
    return this.loyalty.listAccounts(organizationId, userId, {
      q,
      page: pageRaw ? Number(pageRaw) : undefined,
      pageSize: pageSizeRaw ? Number(pageSizeRaw) : undefined,
    });
  }
}
