import { Controller, Get, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../common/session.guard";
import { CurrentUserId } from "../common/current-user.decorator";
import { AdminConfigService } from "./admin-config.service";

/**
 * Configuração efetiva da API (2026-10-12), só leitura: provedores, mínimo da
 * cobrança, taxa padrão, repasse automático, e-mail e presença das chaves —
 * nunca o valor de um segredo.
 */
@Controller("v1/admin/config")
@UseGuards(SessionGuard)
export class AdminConfigController {
  constructor(private readonly config: AdminConfigService) {}

  @Get()
  get(@CurrentUserId() userId: string) {
    return this.config.configuracaoEfetiva(userId);
  }
}
