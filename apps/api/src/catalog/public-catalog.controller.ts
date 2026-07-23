import { Controller, Get, Param } from "@nestjs/common";
import { CatalogService } from "./catalog.service";

@Controller("v1/public/events")
export class PublicCatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get(":slug")
  getEvent(@Param("slug") slug: string) {
    return this.catalogService.getPublicEvent(slug);
  }

  @Get(":slug/availability")
  getAvailability(@Param("slug") slug: string) {
    return this.catalogService.getPublicAvailability(slug);
  }
}
