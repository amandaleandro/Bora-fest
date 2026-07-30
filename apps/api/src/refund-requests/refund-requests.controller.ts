import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { createRefundRequestSchema, resolveRefundRequestSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { RefundRequestsService } from "./refund-requests.service";

@Controller("v1/orders")
export class RefundRequestsController {
  constructor(private readonly refundRequestsService: RefundRequestsService) {}

  @Post(":publicToken/refund-requests")
  @HttpCode(201)
  create(
    @Param("publicToken") publicToken: string,
    @Body(ZodBody(createRefundRequestSchema)) body: unknown,
  ) {
    return this.refundRequestsService.create(publicToken, body as any);
  }
}

/** Fila de reembolsos da casa (modo INSTANTÂNEO resolve os próprios). */
@Controller("v1/organizations/:organizationId/refund-requests")
@UseGuards(SessionGuard)
export class OrganizationRefundRequestsController {
  constructor(private readonly refundRequestsService: RefundRequestsService) {}

  @Get()
  list(@Param("organizationId") organizationId: string, @CurrentUserId() userId: string) {
    return this.refundRequestsService.listForOrganization(organizationId, userId);
  }

  @Post(":id/approve")
  approve(
    @Param("organizationId") organizationId: string,
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(resolveRefundRequestSchema)) body: unknown,
  ) {
    return this.refundRequestsService.approveByOrganization(
      id,
      organizationId,
      userId,
      body as any,
    );
  }

  @Post(":id/reject")
  reject(
    @Param("organizationId") organizationId: string,
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(resolveRefundRequestSchema)) body: unknown,
  ) {
    const input = body as { note?: string };
    return this.refundRequestsService.rejectByOrganization(id, organizationId, userId, {
      note: input.note ?? "Recusado pela organização",
    });
  }
}
