import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { ValidatorModule } from "../validator/validator.module";
import { CheckinsController } from "./checkins.controller";
import { CheckinsService } from "./checkins.service";
import { FaceCheckinController } from "./face-checkin.controller";
import { FaceCheckinService } from "./face-checkin.service";

@Module({
  imports: [CommonModule, ValidatorModule],
  controllers: [CheckinsController, FaceCheckinController],
  providers: [CheckinsService, FaceCheckinService],
})
export class CheckinsModule {}
