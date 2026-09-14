import { Controller, Get, Headers, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { LoyaltyRedemptionGuardService } from "./loyalty-redemption-guard.service";
import { LoyaltyRewardsService } from "./loyalty-rewards.service";

const uuidPipe = new ParseUUIDPipe({ version: "4" });

@Controller("v1/me/loyalty")
@UseGuards(SessionGuard)
export class MeLoyaltyController {
  constructor(
    private readonly rewards: LoyaltyRewardsService,
    private readonly guard: LoyaltyRedemptionGuardService,
  ) {}

  @Get()
  mine(@CurrentUserId() userId: string) {
    return this.rewards.myLoyalty(userId);
  }

  @Post(":organizationId/rewards/:rewardId/redeem")
  async redeem(
    @CurrentUserId() userId: string,
    @Param("organizationId", uuidPipe) organizationId: string,
    @Param("rewardId", uuidPipe) rewardId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    await this.guard.assertProgramEnabled(organizationId);
    return this.rewards.redeem(userId, organizationId, rewardId, idempotencyKey);
  }
}
