import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { ValidatorModule } from "../validator/validator.module";
import { CheckinsController } from "./checkins.controller";
import { CheckinsService } from "./checkins.service";

@Module({
  imports: [CommonModule, ValidatorModule],
  controllers: [CheckinsController],
  providers: [CheckinsService],
})
export class CheckinsModule {}
