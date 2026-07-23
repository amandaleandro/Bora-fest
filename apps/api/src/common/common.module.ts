import { Module } from "@nestjs/common";
import { OrgAccessService } from "./org-access.service";

@Module({
  providers: [OrgAccessService],
  exports: [OrgAccessService],
})
export class CommonModule {}
