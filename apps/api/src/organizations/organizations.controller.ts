import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { createBankAccountSchema, createOrganizationSchema, createSalesPartnerSchema, inviteMemberSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { OrganizationsService } from "./organizations.service";

@Controller("v1/organizations")
@UseGuards(SessionGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  create(@CurrentUserId() userId: string, @Body(ZodBody(createOrganizationSchema)) body: unknown) {
    return this.organizationsService.create(userId, body as any);
  }

  @Get()
  listForUser(@CurrentUserId() userId: string) {
    return this.organizationsService.listForUser(userId);
  }

  @Post(":id/members")
  inviteMember(
    @Param("id") organizationId: string,
    @CurrentUserId() actorUserId: string,
    @Body(ZodBody(inviteMemberSchema)) body: unknown,
  ) {
    return this.organizationsService.inviteMember(organizationId, actorUserId, body as any);
  }

  @Post(":id/sales-partners")
  createSalesPartner(
    @Param("id") organizationId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(createSalesPartnerSchema)) body: unknown,
  ) {
    return this.organizationsService.createSalesPartner(organizationId, userId, body as any);
  }

  @Get(":id/sales-partners")
  listSalesPartners(@Param("id") organizationId: string, @CurrentUserId() userId: string) {
    return this.organizationsService.listSalesPartners(organizationId, userId);
  }
  @Post(":id/follow")
  follow(@Param("id") organizationId: string, @CurrentUserId() userId: string) {
    return this.organizationsService.follow(organizationId, userId);
  }

  @Delete(":id/follow")
  unfollow(@Param("id") organizationId: string, @CurrentUserId() userId: string) {
    return this.organizationsService.unfollow(organizationId, userId);
  }

  @Get(":id/follow")
  isFollowing(@Param("id") organizationId: string, @CurrentUserId() userId: string) {
    return this.organizationsService.isFollowing(organizationId, userId);
  }

  @Post(":id/bank-accounts")
  addBankAccount(
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(createBankAccountSchema)) body: unknown,
  ) {
    return this.organizationsService.addBankAccount(id, userId, body as any);
  }

  @Get(":id/bank-accounts")
  listBankAccounts(@Param("id") id: string, @CurrentUserId() userId: string) {
    return this.organizationsService.listBankAccounts(id, userId);
  }

}
