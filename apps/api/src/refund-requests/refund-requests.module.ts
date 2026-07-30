import { Module } from "@nestjs/common";
import { OrganizationRefundRequestsController, RefundRequestsController } from "./refund-requests.controller";
import { RefundRequestsService } from "./refund-requests.service";
import { OrgAccessService } from "../common/org-access.service";

@Module({
  controllers: [RefundRequestsController, OrganizationRefundRequestsController],
  providers: [RefundRequestsService, OrgAccessService],
  exports: [RefundRequestsService],
})
export class RefundRequestsModule {}
