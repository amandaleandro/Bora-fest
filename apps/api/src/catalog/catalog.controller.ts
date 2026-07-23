import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { createTicketLotSchema, createTicketTypeSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { CatalogService } from "./catalog.service";

@Controller()
@UseGuards(SessionGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post("v1/events/:eventId/ticket-types")
  createTicketType(
    @Param("eventId") eventId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(createTicketTypeSchema)) body: unknown,
  ) {
    return this.catalogService.createTicketType(eventId, userId, body as any);
  }

  @Post("v1/ticket-types/:ticketTypeId/lots")
  createLot(
    @Param("ticketTypeId") ticketTypeId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(createTicketLotSchema)) body: unknown,
  ) {
    return this.catalogService.createLot(ticketTypeId, userId, body as any);
  }

  @Post("v1/ticket-lots/:lotId/activate")
  activateLot(@Param("lotId") lotId: string, @CurrentUserId() userId: string) {
    return this.catalogService.activateLot(lotId, userId);
  }
}
