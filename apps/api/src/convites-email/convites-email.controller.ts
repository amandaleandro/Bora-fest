import { Body, Controller, Get, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { corrigirConviteEmailSchema, criarConvitesEmailSchema } from "@borafest/contracts";
import { ZodBody } from "../common/zod-body.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { RateLimit } from "../common/rate-limit.decorator";
import { ConvitesEmailService } from "./convites-email.service";

/**
 * Convite por e-mail — painel do produtor (2026-10-12). Permissão: EVENT_CREATE
 * na organização do evento (a mesma de criar e editar lote).
 */
@Controller()
@UseGuards(SessionGuard)
export class ConvitesEmailController {
  constructor(private readonly convites: ConvitesEmailService) {}

  @Get("v1/events/:eventId/convites-email/lotes")
  lotes(@Param("eventId") eventId: string, @CurrentUserId() userId: string) {
    return this.convites.lotesDoEvento(eventId, userId);
  }

  @Get("v1/ticket-lots/:lotId/convites-email")
  listar(@Param("lotId") lotId: string, @CurrentUserId() userId: string) {
    return this.convites.listar(lotId, userId);
  }

  // cada chamada manda até 200 e-mails: o limite por sessão impede que uma
  // conta vire disparador de e-mail em massa pela BoraFest
  @Post("v1/ticket-lots/:lotId/convites-email")
  @RateLimit({ limit: 15, windowSeconds: 600, keyPrefix: "convites-email-criar", by: "session" })
  criar(
    @Param("lotId") lotId: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(criarConvitesEmailSchema)) body: unknown,
  ) {
    return this.convites.criar(lotId, userId, (body as { emails: string[] }).emails);
  }

  @Post("v1/convites-email/:id/reenviar")
  @RateLimit({ limit: 60, windowSeconds: 600, keyPrefix: "convites-email-reenviar", by: "session" })
  reenviar(@Param("id") id: string, @CurrentUserId() userId: string) {
    return this.convites.reenviar(id, userId);
  }

  @Post("v1/convites-email/:id/corrigir")
  @RateLimit({ limit: 60, windowSeconds: 600, keyPrefix: "convites-email-corrigir", by: "session" })
  corrigir(
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Body(ZodBody(corrigirConviteEmailSchema)) body: unknown,
  ) {
    return this.convites.corrigir(id, userId, (body as { email: string }).email);
  }

  @Post("v1/convites-email/:id/revogar")
  revogar(@Param("id") id: string, @CurrentUserId() userId: string) {
    return this.convites.revogar(id, userId);
  }
}

/**
 * Link do e-mail (público). Devolve o e-mail do convite, o evento e o lote só
 * para convite que ainda vale: 404 = código não existe; 410 = usado ou revogado
 * (com a mensagem para mostrar). O código tem 128 bits; o limite por IP é só
 * contra varredura.
 */
@Controller("v1/public/convites")
export class PublicConvitesController {
  constructor(private readonly convites: ConvitesEmailService) {}

  @Get(":token")
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "convite-email-publico" })
  publico(@Param("token") token: string, @Res({ passthrough: true }) reply: FastifyReply) {
    // resposta pessoal (tem o e-mail do convidado): nunca em cache compartilhado
    reply.header("Cache-Control", "private, no-store");
    return this.convites.publico(token?.trim() ?? "");
  }
}
