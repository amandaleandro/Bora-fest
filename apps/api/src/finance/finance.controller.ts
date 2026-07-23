import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { FinanceService } from "./finance.service";

@Controller("v1/organizations/:organizationId")
@UseGuards(SessionGuard)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get("balance")
  getBalance(@Param("organizationId") organizationId: string, @CurrentUserId() userId: string) {
    return this.financeService.getBalance(organizationId, userId);
  }

  @Get("ledger")
  listEntries(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Query("limit") limit: string | undefined,
  ) {
    return this.financeService.listEntries(organizationId, userId, limit ? Number(limit) : 50);
  }
}
