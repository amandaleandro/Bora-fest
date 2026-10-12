import { Controller, Get, HttpCode, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { RateLimit } from "../common/rate-limit.decorator";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { WebhooksEmailService } from "./webhooks-email.service";

/**
 * Webhook PÚBLICO do Resend (2026-10-12): entregue, devolvido, reclamação de
 * spam. Cadastre no painel do Resend a URL https://api.borafest.com.br/v1/webhooks/resend
 * e copie o "Signing secret" para RESEND_WEBHOOK_SECRET.
 */
@Controller("v1/webhooks")
export class ResendWebhookController {
  constructor(private readonly service: WebhooksEmailService) {}

  @Post("resend")
  @HttpCode(200)
  // um envio em massa gera 2–3 eventos por e-mail vindos dos mesmos IPs do
  // Resend; o limite padrão (120/min) devolveria 429 em rajada
  @RateLimit({ limit: 1200, windowSeconds: 60, keyPrefix: "webhook-resend", by: "ip" })
  receber(@Req() req: RawBodyRequest<FastifyRequest>) {
    return this.service.receberResend(
      req.headers as Record<string, string | string[] | undefined>,
      req.rawBody,
    );
  }
}

/** Consulta do suporte no backoffice: e-mails com o estado real de entrega. */
@Controller("v1/admin/emails")
@UseGuards(SessionGuard)
export class AdminEmailsController {
  constructor(private readonly service: WebhooksEmailService) {}

  @Get()
  listar(
    @CurrentUserId() userId: string,
    @Query("destinatario") destinatario: string | undefined,
    @Query("situacao") situacao: string | undefined,
  ) {
    return this.service.listarParaSuporte(userId, { destinatario, situacao });
  }
}
