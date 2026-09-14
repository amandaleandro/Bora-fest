import { Body, Controller, Headers, Param, Post, UseGuards } from "@nestjs/common";
import {
  crmAudiencePreviewSchema,
  crmReactivationSendSchema,
} from "@borafest/contracts";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { ZodBody } from "../common/zod-body.decorator";
import { CrmReactivationService } from "./crm-reactivation.service";

@Controller()
@UseGuards(SessionGuard)
export class CrmReactivationController {
  constructor(private readonly reactivation: CrmReactivationService) {}

  @Post("v1/organizations/:organizationId/customers/reactivation/preview")
  preview(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(crmAudiencePreviewSchema)) body: unknown,
  ) {
    return this.reactivation.preview(organizationId, userId, body as any);
  }

  @Post("v1/organizations/:organizationId/customers/reactivation/send")
  send(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() userId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(ZodBody(crmReactivationSendSchema)) body: unknown,
  ) {
    return this.reactivation.send(organizationId, userId, idempotencyKey, body as any);
  }
}
