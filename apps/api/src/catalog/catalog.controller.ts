import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { createTicketLotSchema, createTicketTypeSchema, updateTicketLotSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { IdempotencyService } from "../common/idempotency.service";
import { CatalogService } from "./catalog.service";

@Controller()
@UseGuards(SessionGuard)
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly idempotency: IdempotencyService,
  ) {}

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
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    // Idempotency-Key (revisão 2026-10-13): a resposta que se perde e o
    // "Tentar novamente" do painel não criam um 2º lote já à venda — mesma
    // chave e mesmo corpo devolvem o lote criado (padrão do duplicar evento)
    return this.idempotency.run(idempotencyKey, `lot-create:${ticketTypeId}:${userId}`, body, () =>
      this.catalogService.createLot(ticketTypeId, userId, body as any),
    );
  }

  /** Lotes do evento com tudo o que o painel edita (link de convite, virada, datas). */
  @Get("v1/events/:eventId/ticket-lots")
  listEventLots(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.catalogService.listEventLots(eventId, userId);
  }

  /** Editar lote (2026-10-12): mesmas regras da criação, conferidas no estado final. */
  @Patch("v1/ticket-lots/:lotId")
  updateLot(
    @Param("lotId") lotId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(updateTicketLotSchema)) body: unknown,
  ) {
    return this.catalogService.updateLot(lotId, userId, body as any);
  }

  @Post("v1/ticket-lots/:lotId/invite-link/rotate")
  rotateInviteLink(@Param("lotId") lotId: string, @CurrentUserId() userId: string) {
    return this.catalogService.rotateInviteLink(lotId, userId);
  }

  @Post("v1/ticket-lots/:lotId/activate")
  activateLot(@Param("lotId") lotId: string, @CurrentUserId() userId: string) {
    return this.catalogService.activateLot(lotId, userId);
  }

  @Post("v1/ticket-lots/:lotId/close")
  closeLot(@Param("lotId") lotId: string, @CurrentUserId() userId: string) {
    return this.catalogService.closeLot(lotId, userId);
  }

  @Delete("v1/ticket-lots/:lotId")
  deleteLot(@Param("lotId") lotId: string, @CurrentUserId() userId: string) {
    return this.catalogService.deleteLot(lotId, userId);
  }
}
