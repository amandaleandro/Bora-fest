import { Controller, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { WebhooksService } from "./webhooks.service";

@Controller("v1/webhooks")
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post("payments/:provider")
  @HttpCode(200)
  handlePayment(@Param("provider") provider: string, @Req() req: RawBodyRequest<FastifyRequest>) {
    const rawBody = req.rawBody?.toString("utf8") ?? JSON.stringify(req.body ?? {});
    return this.webhooksService.handlePaymentWebhook(
      provider,
      req.headers as Record<string, string | string[] | undefined>,
      rawBody,
    );
  }
}
