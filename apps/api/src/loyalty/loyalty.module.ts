import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { LoyaltyController } from "./loyalty.controller";
import { LoyaltyService } from "./loyalty.service";

@Module({
  imports: [CommonModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
})
export class LoyaltyModule {}
