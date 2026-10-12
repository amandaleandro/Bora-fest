import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { AdminEmailsController, ResendWebhookController } from "./webhooks-email.controller";
import { WebhooksEmailService } from "./webhooks-email.service";

/** Entrega de e-mail (2026-10-12): webhook do Resend + consulta do suporte. */
@Module({
  imports: [CommonModule],
  controllers: [ResendWebhookController, AdminEmailsController],
  providers: [WebhooksEmailService],
})
export class WebhooksEmailModule {}
