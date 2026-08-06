import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CatalogService } from "./catalog.service";

/**
 * Cache curto (CDN/proxy/navegador) nas rotas de leitura pública — são as que
 * levam o tranco de refresh em massa antes de uma venda abrir. Disponibilidade
 * de estoque (rota abaixo) fica de fora: precisa refletir venda em tempo real.
 */
const PUBLIC_CACHE_HEADER = "public, max-age=5, stale-while-revalidate=30";

@Controller("v1/public/events")
export class PublicCatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  listEvents(
    @Query("page") page: string | undefined,
    @Query("pageSize") pageSize: string | undefined,
    @Query("city") city: string | undefined,
    @Query("category") category: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
    return this.catalogService.listPublicEvents({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Math.min(Number(pageSize), 50) : 20,
      city: city?.trim() || undefined,
      category: category?.trim() || undefined,
    });
  }

  @Get("cities/list")
  listCities(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return this.catalogService.listPublicCities();
  }

  @Get(":slug")
  getEvent(@Param("slug") slug: string, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("Cache-Control", PUBLIC_CACHE_HEADER);
    return this.catalogService.getPublicEvent(slug);
  }

  @Get(":slug/availability")
  getAvailability(@Param("slug") slug: string) {
    return this.catalogService.getPublicAvailability(slug);
  }
}
