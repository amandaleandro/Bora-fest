import { Module } from "@nestjs/common";
import { OrgAccessService } from "./org-access.service";
import { IdempotencyService } from "./idempotency.service";
import { PlatformAccessService } from "./platform-access.service";

@Module({
  providers: [OrgAccessService, IdempotencyService, PlatformAccessService],
  exports: [OrgAccessService, IdempotencyService, PlatformAccessService],
})
export class CommonModule {}
