import { Module } from "@nestjs/common";
import { OrgAccessService } from "./org-access.service";
import { IdempotencyService } from "./idempotency.service";

@Module({
  providers: [OrgAccessService, IdempotencyService],
  exports: [OrgAccessService, IdempotencyService],
})
export class CommonModule {}
