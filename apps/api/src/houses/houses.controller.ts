import { Controller, Get, Param, Query, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentUserId } from "../common/current-user.decorator";
import { SessionGuard } from "../common/session.guard";
import { HousesService } from "./houses.service";

const PUBLIC_CACHE_HEADER = "public, max-age=30, stale-while-revalidate=120";

@Controller("v1/public/casas")
export class HousesController {
  constructor(private readonly housesService: HousesService) {}

  @Get()
  list(
    @Query("page") page: string | undefined,
    @Query("pageSize") pageSize: string | undefined,
    @Query("city") city: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    return this.housesService.listPublicHouses(Number(page) || 1, Number(pageSize) || 50, city?.trim() || undefined);
  }

  /** Resolução leve usada na página do evento para descobrir a URL permanente. */
  @Get("by-id/:id")
  resolveById(@Param("id") id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
    return this.housesService.resolvePublicHouseById(id);
  }

  @Get(":slug")
  get(@Param("slug") slug: string, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
    return this.housesService.getPublicHouse(slug);
  }
}

/**
 * Descoberta personalizada do comprador. Mantemos fora do prefixo /public
 * para não dar a impressão de que a lista de seguidos é cacheável/anonimamente acessível.
 */
@Controller("v1/casas")
@UseGuards(SessionGuard)
export class MyHousesController {
  constructor(private readonly housesService: HousesService) {}

  @Get("following/mine")
  following(
    @CurrentUserId() userId: string,
    @Query("city") city: string | undefined,
  ) {
    return this.housesService.listFollowedHouses(userId, city?.trim() || undefined);
  }
}
