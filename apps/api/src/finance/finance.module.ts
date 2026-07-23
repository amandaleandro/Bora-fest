import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { FinanceController } from "./finance.controller";
import { FinanceService } from "./finance.service";

@Module({
  imports: [CommonModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
