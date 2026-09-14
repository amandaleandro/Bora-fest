import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { LoyaltyController } from "./loyalty.controller";
import { LoyaltyRewardsController } from "./loyalty-rewards.controller";
import { LoyaltyRewardsService } from "./loyalty-rewards.service";
import { LoyaltyService } from "./loyalty.service";
import { MeLoyaltyController } from "./me-loyalty.controller";

@Module({
  imports: [CommonModule],
  controllers: [LoyaltyController, LoyaltyRewardsController, MeLoyaltyController],
  providers: [LoyaltyService, LoyaltyRewardsService],
})
export class LoyaltyModule {}
