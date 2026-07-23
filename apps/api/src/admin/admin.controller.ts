import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { blockReasonSchema, refundOrderSchema, setOrganizationFeeSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { AdminService } from "./admin.service";

@Controller("v1/admin")
@UseGuards(SessionGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("organizations")
  listOrganizations(@CurrentUserId() userId: string) {
    return this.adminService.listOrganizations(userId);
  }

  @Get("organizations/:id")
  getOrganization(@Param("id") id: string, @CurrentUserId() userId: string) {
    return this.adminService.getOrganization(id, userId);
  }

  @Post("organizations/:id/fee")
  setOrganizationFee(
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(setOrganizationFeeSchema)) body: unknown,
  ) {
    return this.adminService.setOrganizationFee(id, userId, body as any);
  }

  @Post("organizations/:id/block")
  blockOrganization(
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(blockReasonSchema)) body: unknown,
  ) {
    return this.adminService.blockOrganization(id, userId, body as any);
  }

  @Post("organizations/:id/unblock")
  unblockOrganization(@Param("id") id: string, @CurrentUserId() userId: string) {
    return this.adminService.unblockOrganization(id, userId);
  }

  @Get("events")
  listEvents(
    @CurrentUserId() userId: string,
    @Query("organizationId") organizationId: string | undefined,
    @Query("status") status: string | undefined,
  ) {
    return this.adminService.listEvents(userId, { organizationId, status });
  }

  @Post("events/:id/block")
  blockEvent(
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(blockReasonSchema)) body: unknown,
  ) {
    return this.adminService.blockEvent(id, userId, body as any);
  }

  @Get("orders")
  searchOrders(
    @CurrentUserId() userId: string,
    @Query("publicToken") publicToken: string | undefined,
    @Query("email") email: string | undefined,
    @Query("eventId") eventId: string | undefined,
  ) {
    return this.adminService.searchOrders(userId, { publicToken, email, eventId });
  }

  @Post("orders/:publicToken/resend")
  @HttpCode(202)
  resendOrder(@Param("publicToken") publicToken: string, @CurrentUserId() userId: string) {
    return this.adminService.resendOrderTickets(publicToken, userId);
  }

  @Post("orders/:publicToken/refund")
  refundOrder(
    @Param("publicToken") publicToken: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(refundOrderSchema)) body: unknown,
  ) {
    return this.adminService.refundOrder(publicToken, userId, body as any);
  }

  @Get("webhooks")
  listWebhooks(
    @CurrentUserId() userId: string,
    @Query("provider") provider: string | undefined,
    @Query("status") status: string | undefined,
  ) {
    return this.adminService.listWebhooks(userId, { provider, status });
  }

  @Get("queues")
  getQueuesHealth(@CurrentUserId() userId: string) {
    return this.adminService.getQueuesHealth(userId);
  }

  @Post("tickets/:id/block")
  blockTicket(
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(blockReasonSchema)) body: unknown,
  ) {
    return this.adminService.blockTicket(id, userId, body as any);
  }

  @Get("audit-logs")
  listAuditLogs(
    @CurrentUserId() userId: string,
    @Query("entityType") entityType: string | undefined,
    @Query("entityId") entityId: string | undefined,
    @Query("organizationId") organizationId: string | undefined,
  ) {
    return this.adminService.listAuditLogs(userId, { entityType, entityId, organizationId });
  }
}
