import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { createBankAccountSchema, createOrganizationSchema, createSalesPartnerSchema, invitePromoterSchema, inviteSellerSchema, inviteMemberSchema, updateOrganizationSchema } from "@borafest/contracts";
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

  // --- meus convites/vínculos (pessoa) — rotas estáticas ANTES de :id ------
  @Get("promoter-invites/mine")
  myPromoterInvites(@CurrentUserId() userId: string) {
    return this.organizationsService.listMyPromoterInvites(userId);
  }

  @Get("promoter-engagements/mine")
  myPromoterEngagements(@CurrentUserId() userId: string) {
    return this.organizationsService.listMyPromoterEngagements(userId);
  }

  @Get("wallet/mine")
  myWallet(@CurrentUserId() userId: string) {
    return this.organizationsService.getMyWallet(userId);
  }

  @Get("seller-invites/mine")
  mySellerInvites(@CurrentUserId() userId: string) {
    return this.organizationsService.listMySellerInvites(userId);
  }

  @Get("seller-engagements/mine")
  mySellerEngagements(@CurrentUserId() userId: string) {
    return this.organizationsService.listMySellerEngagements(userId);
  }

  @Post("promoter-links/:linkId/accept")
  acceptPromoterInvite(@Param("linkId") linkId: string, @CurrentUserId() userId: string) {
    return this.organizationsService.respondPromoterInvite(linkId, userId, true);
  }

  @Post("promoter-links/:linkId/decline")
  declinePromoterInvite(@Param("linkId") linkId: string, @CurrentUserId() userId: string) {
    return this.organizationsService.respondPromoterInvite(linkId, userId, false);
  }

  /** o PROMOTER convida um vendedor no seu link */
  @Post("promoter-links/:linkId/sellers")
  inviteSeller(
    @Param("linkId") linkId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(inviteSellerSchema)) body: unknown,
  ) {
    return this.organizationsService.inviteSeller(linkId, userId, body as any);
  }

  /** cascata: promoter (ou a casa) vê os vendedores e quanto cada um vendeu */
  @Get("promoter-links/:linkId/sellers")
  listSellers(@Param("linkId") linkId: string, @CurrentUserId() userId: string) {
    return this.organizationsService.listSellersOfPromoter(linkId, userId);
  }

  @Post("promoter-sellers/:sellerId/accept")
  acceptSellerInvite(@Param("sellerId") sellerId: string, @CurrentUserId() userId: string) {
    return this.organizationsService.respondSellerInvite(sellerId, userId, true);
  }

  @Post("promoter-sellers/:sellerId/decline")
  declineSellerInvite(@Param("sellerId") sellerId: string, @CurrentUserId() userId: string) {
    return this.organizationsService.respondSellerInvite(sellerId, userId, false);
  }

  // --- lado da CASA --------------------------------------------------------
  @Post(":id/promoters")
  invitePromoter(
    @Param("id") organizationId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(invitePromoterSchema)) body: unknown,
  ) {
    return this.organizationsService.invitePromoter(organizationId, userId, body as any);
  }

  @Get(":id/promoters")
  listPromoters(@Param("id") organizationId: string, @CurrentUserId() userId: string) {
    return this.organizationsService.listPromoters(organizationId, userId);
  }

  @Patch(":id")
  update(
    @Param("id") organizationId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(updateOrganizationSchema)) body: unknown,
  ) {
    return this.organizationsService.update(organizationId, userId, body as any);
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
