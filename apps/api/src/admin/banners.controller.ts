import { BadRequestException, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { BannersService } from "./banners.service";

/** Site do comprador lê daqui qual banner de divulgação mostrar (sem login). */
@Controller("v1/public/banners")
export class PublicBannersController {
  constructor(private readonly banners: BannersService) {}

  @Get()
  get() {
    return this.banners.getPublic();
  }
}

/** Admin anexa/troca/remove a arte de cada slot (desktop | mobile). */
@Controller("v1/admin/banners")
@UseGuards(SessionGuard)
export class AdminBannersController {
  constructor(private readonly banners: BannersService) {}

  @Post(":slot")
  async upload(
    @Param("slot") slot: string,
    @CurrentUserId() userId: string,
    @Req() req: FastifyRequest,
  ) {
    const file = await (req as any).file();
    if (!file) throw new BadRequestException("Envie o arquivo no campo 'file'");
    return this.banners.upload(slot, userId, file);
  }

  @Delete(":slot")
  remove(@Param("slot") slot: string, @CurrentUserId() userId: string) {
    return this.banners.remove(slot, userId);
  }
}
