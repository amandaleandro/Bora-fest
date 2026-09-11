import { Controller, Get, Param, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { HousesService } from "./houses.service";

const PUBLIC_CACHE_HEADER = "public, max-age=30, stale-while-revalidate=120";

@Controller("v1/public/casas")
export class HousesController {
  constructor(private readonly housesService: HousesService) {}

  @Get()
  list(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    return this.housesService.listPublicHouses();
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
