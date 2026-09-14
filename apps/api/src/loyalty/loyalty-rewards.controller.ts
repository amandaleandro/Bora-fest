import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  createLoyaltyRewardSchema,
  updateLoyaltyRewardSchema,
  useLoyaltyRedemptionSchema,
} from "@borafest/contracts";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { ZodBody } from "../common/zod-body.decorator";
import { LoyaltyRewardsService } from "./loyalty-rewards.service";

@Controller("v1/organizations/:organizationId/loyalty")
@UseGuards(SessionGuard)
export class LoyaltyRewardsController {
  constructor(private readonly rewards: LoyaltyRewardsService) {}

  @Get("rewards")
  listRewards(@Param("organizationId") organizationId: string, @CurrentUserId() userId: string) {
    return this.rewards.listRewards(organizationId, userId);
  }

  @Post("rewards")
  createReward(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(createLoyaltyRewardSchema)) body: unknown,
  ) {
    return this.rewards.createReward(organizationId, userId, body as any);
  }

  @Patch("rewards/:rewardId")
  updateReward(
    @Param("organizationId") organizationId: string,
    @Param("rewardId") rewardId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(updateLoyaltyRewardSchema)) body: unknown,
  ) {
    return this.rewards.updateReward(organizationId, rewardId, userId, body as any);
  }

  @Get("redemptions")
  listRedemptions(@Param("organizationId") organizationId: string, @CurrentUserId() userId: string) {
    return this.rewards.listRedemptions(organizationId, userId);
  }

  @Post("redemptions/use")
  useRedemption(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(useLoyaltyRedemptionSchema)) body: any,
  ) {
    return this.rewards.consumeCode(organizationId, userId, body.code);
  }
}
