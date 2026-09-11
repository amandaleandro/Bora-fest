import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { updateOrganizationPublicProfileSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { OrganizationProfileService } from "./organization-profile.service";

@Controller("v1/organizations")
@UseGuards(SessionGuard)
export class OrganizationProfileController {
  constructor(private readonly profile: OrganizationProfileService) {}

  @Get(":id/public-profile")
  getProfile(@Param("id") organizationId: string, @CurrentUserId() userId: string) {
    return this.profile.getProfile(organizationId, userId);
  }

  @Patch(":id/public-profile")
  updateProfile(
    @Param("id") organizationId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(updateOrganizationPublicProfileSchema)) body: unknown,
  ) {
    return this.profile.updateProfile(organizationId, userId, body as any);
  }

  @Post(":id/public-profile/image/:kind")
  async uploadImage(
    @Param("id") organizationId: string,
    @Param("kind") kind: string,
    @CurrentUserId() userId: string,
    @Req() req: FastifyRequest,
  ) {
    const file = await (req as any).file();
    if (!file) throw new BadRequestException("Envie o arquivo no campo 'file'");
    return this.profile.uploadImage(organizationId, userId, kind, file);
  }
}
