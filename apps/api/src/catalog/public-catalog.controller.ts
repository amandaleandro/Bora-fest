import { Controller, Get, Param, Query } from "@nestjs/common";
import { CatalogService } from "./catalog.service";

@Controller("v1/public/events")
export class PublicCatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  listEvents(@Query("page") page: string | undefined, @Query("pageSize") pageSize: string | undefined) {
    return this.catalogService.listPublicEvents({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Math.min(Number(pageSize), 50) : 20,
    });
  }

  @Get(":slug")
  getEvent(@Param("slug") slug: string) {
    return this.catalogService.getPublicEvent(slug);
  }

  @Get(":slug/availability")
  getAvailability(@Param("slug") slug: string) {
    return this.catalogService.getPublicAvailability(slug);
  }
}
