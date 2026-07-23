import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { ValidatorConfigController, ValidatorController } from "./validator.controller";
import { ValidatorDeviceGuard } from "./validator-device.guard";
import { ValidatorService } from "./validator.service";

@Module({
  imports: [CommonModule],
  controllers: [ValidatorConfigController, ValidatorController],
  providers: [ValidatorService, ValidatorDeviceGuard],
  exports: [ValidatorDeviceGuard],
})
export class ValidatorModule {}
