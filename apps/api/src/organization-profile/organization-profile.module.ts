import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { OrganizationProfileController } from "./organization-profile.controller";
import { OrganizationProfileService } from "./organization-profile.service";

@Module({
  imports: [CommonModule],
  controllers: [OrganizationProfileController],
  providers: [OrganizationProfileService],
  exports: [OrganizationProfileService],
})
export class OrganizationProfileModule {}
