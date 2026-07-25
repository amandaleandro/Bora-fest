import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { requestPayoutSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
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

  @Get("payouts")
  listPayouts(@Param("organizationId") organizationId: string, @CurrentUserId() userId: string) {
    return this.financeService.listPayouts(organizationId, userId);
  }
  @Post(":organizationId/payout-requests")
  requestPayout(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(requestPayoutSchema)) body: unknown,
  ) {
    return this.financeService.requestPayout(organizationId, userId, (body as { amountCents: number }).amountCents);
  }

  @Get(":organizationId/payout-requests")
  listPayoutRequests(@Param("organizationId") organizationId: string, @CurrentUserId() userId: string) {
    return this.financeService.listPayoutRequests(organizationId, userId);
  }

}
